import {
  baseline,
  validate,
  rotation,
  mv,
  trace,
  angle,
  norm,
  sub,
  add,
  mul,
  fromPython,
  toPython,
} from "./physics.js";
import { anglesToDirection } from "./lut.js";
import { materials, indexFor } from "./materials.js";
import {
  setupLibrary,
  syncMedia,
  librarySettings,
  importMaterials,
  populateMaterials,
  restoreMedia,
} from "./material-library.js";
import { csvText, xyzPCD } from "./cloud.js";
import { defaultObjects, validateObjects } from "./scene.js";
import * as charts from "./plots.js";

const $ = (id) => document.getElementById(id),
  val = (id) => Number($(id).value),
  fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const ANALYTICAL_RANGE_MODEL = "optical_path";
let active = "designer",
  config = baseline(),
  pinned = null,
  ray = null,
  curveRows = [],
  atlasData = null,
  cloudResult = null,
  cloudRun = null,
  cloudLoaded = false,
  cloudName = "",
  sceneResult = null,
  sceneRun = null,
  objects = defaultObjects(),
  renderTimer,
  sceneTimer,
  cloudBusy = false,
  currentLUT = null,
  lutStale = false,
  lutBusy = false,
  lutCheckGeneration = 0;
const numericIds = [
  "radius",
  "thickness",
  "cx",
  "cy",
  "cz",
  "ox",
  "oy",
  "oz",
  "roll",
  "pitch",
  "yaw",
  "ninside",
  "nwall",
  "noutside",
];
numericIds.forEach((id) => ($(id).step = "any"));
$("toggle-controls").onclick = () => {
  const collapsed = document
    .querySelector(".shell")
    .classList.toggle("controls-collapsed");
  $("toggle-controls").textContent = collapsed
    ? "Show optical parameters ▾"
    : "Hide optical parameters ▴";
};
let stationIndex = 0,
  stations = [
    {
      name: "LiDAR 1",
      config: toPython(baseline()),
      pose: { position: [0, 0, 0], rpy: [0, 0, 0] },
    },
  ];
function error(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function notice(message) {
  $("notice").textContent = message;
  $("notice").hidden = !message;
}
function stats(id, items) {
  $(id).replaceChildren(
    ...items.map(([label, value, unit, note]) => {
      const d = document.createElement("div");
      d.className = "stat";
      const a = document.createElement("small");
      a.textContent = label;
      const b = document.createElement("strong");
      b.textContent = value;
      const u = document.createElement("span");
      u.textContent = unit || "";
      b.append(u);
      d.append(a, b);
      if (note) {
        const p = document.createElement("p");
        p.textContent = note;
        d.append(p);
      }
      return d;
    }),
  );
}
function download(text, name, type = "text/plain") {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const jsonDownload = (data, name) =>
  download(JSON.stringify(data, null, 2), name, "application/json");
function readConfig() {
  for (const id of numericIds)
    if ($(id).value.trim() === "" || !Number.isFinite(val(id)))
      throw Error(`Check ${$(id).closest("label").textContent.trim()}.`);
  return validate({
    radius: val("radius") / 1000,
    thickness: val("thickness") / 1000,
    center: ["cx", "cy", "cz"].map((id) => val(id) / 1000),
    origin: ["ox", "oy", "oz"].map((id) => val(id) / 1000),
    rotation: rotation(val("roll"), val("pitch"), val("yaw")),
    nInside: val("ninside"),
    nWall: val("nwall"),
    nOutside: val("noutside"),
    upperOnly: $("aperture").value === "upper",
  });
}
function applyConfig(c) {
  validate(c);
  $("radius").value = c.radius * 1000;
  $("thickness").value = c.thickness * 1000;
  ["cx", "cy", "cz"].forEach((id, i) => ($(id).value = c.center[i] * 1000));
  ["ox", "oy", "oz"].forEach((id, i) => ($(id).value = c.origin[i] * 1000));
  $("ninside").value = c.nInside;
  $("nwall").value = c.nWall;
  $("noutside").value = c.nOutside;
  $("aperture").value = c.upperOnly ? "upper" : "full";
  const q = c.rotation,
    pitch = Math.asin(Math.max(-1, Math.min(1, -q[2][0]))),
    singular = Math.abs(Math.cos(pitch)) < 1e-8;
  $("pitch").value = (pitch * 180) / Math.PI;
  $("roll").value =
    ((singular ? 0 : Math.atan2(q[2][1], q[2][2])) * 180) / Math.PI;
  $("yaw").value =
    ((singular ? Math.atan2(-q[0][1], q[1][1]) : Math.atan2(q[1][0], q[0][0])) *
      180) /
    Math.PI;
  $("material").value = "custom";
  syncMedia();
  materialNote();
  config = c;
}
function materialNote() {
  const key = $("material").value,
    m = materials[key];
  $("material-note").textContent = m.note;
  if (m.url) {
    const a = document.createElement("a");
    a.href = m.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = " Source ↗";
    $("material-note").append(a);
  }
  $("nwall").readOnly = key !== "custom";
  $("wavelength").disabled = ![
    key,
    $("inside-material").value,
    $("outside-material").value,
  ].includes("bk7");
}
function materialSettings() {
  return {
    preset: $("material").value,
    wavelength_nm: val("wavelength"),
    ...librarySettings(),
  };
}
function restoreMaterial(settings) {
  if (!settings) return;
  importMaterials(settings.library);
  populateMaterials();
  if (
    !Object.hasOwn(materials, settings.preset) ||
    !Number.isFinite(settings.wavelength_nm)
  )
    throw Error("Invalid material settings in scene.");
  $("material").value = settings.preset;
  $("wavelength").value = settings.wavelength_nm;
  restoreMedia(settings);
  materialNote();
}
function updateMaterial() {
  try {
    if ($("material").value === "__add__") return;
    const n = indexFor($("material").value, val("wavelength"));
    if (n !== undefined) $("nwall").value = n.toFixed(9);
    materialNote();
    changed();
  } catch (e) {
    error(e.message);
  }
}
function rayNow() {
  const direction = anglesToDirection(
    val("beam-xz-angle"),
    val("beam-yz-angle"),
  );
  if (!direction) throw Error("Selected XZ/YZ beam angles are invalid.");
  return trace(mv(config.rotation, direction), config);
}
function enableCloudExport(enabled) {
  for (const id of ["export-pcd", "export-csv", "export-report"])
    $(id).disabled = !enabled;
}
function markStale() {
  if (cloudResult) {
    $("cloud-status").textContent =
      "Parameters changed. Apply correction again before exporting.";
    enableCloudExport(false);
  }
  if (sceneResult) {
    $("scene-status").textContent =
      "Parameters changed. Re-simulate for current results.";
    for (const id of ["scene-pcd", "scene-csv", "scene-report"])
      $(id).disabled = true;
  }
}
function changed() {
  markStale();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    try {
      config = readConfig();
      error("");
      render();
      checkLUTCompatibility(config).catch((e) => error(e.message));
      if (active === "scene" && $("scene-auto").checked) queueScene();
    } catch (e) {
      error(e.message);
      $("live-state").textContent = "CHECK";
    }
  }, 140);
}
async function render() {
  try {
    config = readConfig();
    ray = rayNow();
    $("live-state").textContent = "LIVE";
    $("beam-xz-out").value = `${val("beam-xz-angle")}°`;
    $("beam-yz-out").value = `${val("beam-yz-angle")}°`;
    const length = val("raylength") / 1000;
    if (!Number.isFinite(length) || length <= 0)
      throw Error("Display ray length must be positive.");
    const a = $("plane-a").value,
      b = $("plane-b").value;
    if (active === "designer") {
      const coordinates = (p) => p.map((v) => fmt(v * 1000, 2)).join(", ");
      $("coordinate-summary").textContent =
        `Dome centre: (${coordinates(config.center)}) mm. LiDAR source: (${coordinates(config.origin)}) mm. Arrows show the rotated sensor axes; the grid uses enclosure coordinates.`;
      stats("designer-stats", [
        [
          "Inner / outer radius",
          `${fmt(config.radius * 1000, 1)} / ${fmt((config.radius + config.thickness) * 1000, 1)}`,
          "mm",
        ],
        [
          "Source offset",
          fmt(norm(sub(config.origin, config.center)) * 1000, 2),
          "mm",
        ],
        [
          "Selected ray",
          ray.valid ? fmt(ray.deflection, 4) : "Blocked",
          "deg",
          ray.valid ? "Net angular deviation" : ray.status.replaceAll("_", " "),
        ],
        ["Wall index", fmt(config.nWall, 6), "n"],
        [
          "Inner incidence",
          ray.inner ? fmt(angle(ray.incident, ray.innerNormal), 3) : "—",
          "deg",
        ],
        [
          "Outer incidence",
          ray.outer ? fmt(angle(ray.wall, ray.outerNormal), 3) : "—",
          "deg",
        ],
        ["Wall travel", fmt(ray.lWall * 1000, 4), "mm"],
      ]);
      $("designer-section-title").textContent = `${a} ray path`;
      $("designer-section-b-title").textContent = `${b} ray path`;
      await Promise.all([
        charts.geometry("geometry", config, ray, length, false),
        charts.beam2d("designer-section", config, ray, length, a),
        charts.beam2d("designer-section-b", config, ray, length, b),
      ]);
      const range = Number($("sweep-range").value),
        frame = $("sweep-frame").value;
      curveRows = [
        charts.sweep(config, a, range, frame),
        charts.sweep(config, b, range, frame),
      ];
      $("curve-a-title").textContent = `${a} total deflection`;
      $("curve-b-title").textContent = `${b} total deflection`;
      await Promise.all([
        charts.curves(
          "curve-a",
          curveRows[0],
          pinned ? charts.sweep(pinned, a, range, frame) : null,
          a,
        ),
        charts.curves(
          "curve-b",
          curveRows[1],
          pinned ? charts.sweep(pinned, b, range, frame) : null,
          b,
        ),
      ]);
    } else if (active === "atlas") {
      atlasData = charts.atlas(config);
      const v = atlasData.values,
        max = v.length
          ? v.reduce((maximum, value) => Math.max(maximum, value), -Infinity)
          : NaN,
        mean = v.length ? v.reduce((s, a) => s + a, 0) / v.length : NaN;
      stats("atlas-stats", [
        ["Maximum deviation", fmt(max, 4), "deg"],
        [
          "Mean sampled deviation",
          fmt(mean, 4),
          "deg",
          "Uniform angle grid; not solid-angle weighted",
        ],
        ["Valid samples", v.length, "rays"],
        ["Rejected samples", atlasData.rows.length - v.length, "rays"],
      ]);
      await charts.drawAtlas(atlasData);
    } else if (active === "scene") drawScene();
    error("");
  } catch (e) {
    error(e.message);
  }
}
$("open-model").onclick = () => $("model-dialog").showModal();
$("close-model").onclick = () => $("model-dialog").close();
document
  .querySelectorAll("[data-open-lut-info]")
  .forEach(
    (button) => (button.onclick = () => $("lut-info-dialog").showModal()),
  );
$("close-lut-info").onclick = () => $("lut-info-dialog").close();
async function tab(name) {
  if (!$(name) || !["designer", "atlas", "cloud", "scene"].includes(name))
    name = "designer";
  active = name;
  document
    .querySelectorAll("[role=tabpanel]")
    .forEach((el) => (el.hidden = el.id !== name));
  document.querySelectorAll("[role=tab]").forEach((el) => {
    const selected = el.dataset.tab === name;
    el.setAttribute("aria-selected", selected);
    el.tabIndex = selected ? 0 : -1;
  });
  history.replaceState(null, "", `#${name}`);
  notice("");
  await render();
  if (name === "cloud" && cloudResult) drawCloud();
  if (name === "cloud" && currentLUT && !lutStale) {
    $("lut-views").hidden = false;
    await charts.drawLUT(currentLUT);
  }
  if (name === "scene" && !sceneResult) queueScene();
}
document
  .querySelectorAll("[data-tab]")
  .forEach((button) =>
    button.addEventListener("click", () => tab(button.dataset.tab)),
  );
document.querySelector(".tabs").addEventListener("keydown", (e) => {
  if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const tabs = [...document.querySelectorAll("[role=tab]")],
    i = tabs.indexOf(document.activeElement),
    next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? tabs.length - 1
          : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  tab(tabs[next].dataset.tab);
});
document
  .querySelectorAll(".controls input:not([type=file]),.controls select")
  .forEach((el) => {
    if (
      ![
        "material",
        "wavelength",
        "inside-material",
        "outside-material",
      ].includes(el.id)
    )
      el.addEventListener("input", changed);
  });
for (const id of ["beam-xz-angle", "beam-yz-angle", "raylength"])
  $(id).addEventListener("input", changed);
["plane-a", "plane-b", "sweep-range", "sweep-frame"].forEach((id) =>
  $(id).addEventListener("change", () => render()),
);
$("material").addEventListener("change", updateMaterial);
$("wavelength").addEventListener("input", updateMaterial);
$("reset").onclick = () => {
  applyConfig(baseline());
  changed();
};
$("pin").onclick = () => {
  if (pinned) {
    pinned = null;
    $("pin").textContent = "Pin a comparison";
  } else {
    pinned = structuredClone(config);
    $("pin").textContent = "Clear pinned comparison";
  }
  render();
};
$("save-config").onclick = () => {
  try {
    jsonDownload(
      { ...toPython(readConfig()), lut: readLUTSettings() },
      "enclosure-config.json",
    );
  } catch (e) {
    error(e.message);
  }
};
$("load-config").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 1000000) throw Error("Configuration too large.");
    const saved = JSON.parse(await f.text());
    applyConfig(fromPython(saved));
    if (saved.lut) {
      const ids = ["resolution", "xz-min", "xz-max", "yz-min", "yz-max"];
      const keys = [
        "resolution_deg",
        "xz_min_deg",
        "xz_max_deg",
        "yz_min_deg",
        "yz_max_deg",
      ];
      ids.forEach((id, i) => ($(`lut-${id}`).value = saved.lut[keys[i]]));
    }
    changed();
    notice("Configuration imported. Rotation is shown as roll, pitch and yaw.");
  } catch (ex) {
    error(ex.message);
  }
  e.target.value = "";
};
$("export-curves").onclick = () => {
  const c = readConfig(),
    range = Number($("sweep-range").value),
    frame = $("sweep-frame").value;
  const rows = [$("plane-a").value, $("plane-b").value].flatMap((plane) =>
    charts
      .sweep(c, plane, range, frame)
      .map((r) => [plane, frame, r.angle, r.value ?? "", r.status]),
  );
  download(
    csvText([
      ["plane", "frame", "input_deg", "total_deflection_deg", "status"],
      ...rows,
    ]),
    "deflection-curves.csv",
    "text/csv",
  );
};
$("export-atlas").onclick = () => {
  if (atlasData)
    download(
      csvText([
        ["azimuth_deg", "polar_deg", "total_deflection_deg", "status"],
        ...atlasData.rows,
      ]),
      "deflection-atlas.csv",
      "text/csv",
    );
};
document.querySelectorAll("[data-camera]").forEach((b) => {
  b.onclick = () => charts.camera(b.dataset.view, b.dataset.camera);
});
document
  .querySelectorAll("[data-focus]")
  .forEach(
    (b) =>
      (b.onclick = () =>
        charts.focusPlot(
          b.dataset.focus,
          b.dataset.hit,
          config,
          ray,
          b.dataset.focus === "designer-section"
            ? $("plane-a").value
            : $("plane-b").value,
          val("raylength") / 1000,
        )),
  );
let expanded = null,
  placeholder = null;
document.querySelectorAll("[data-expand]").forEach(
  (b) =>
    (b.onclick = () => {
      const plot = $(b.dataset.expand);
      placeholder = document.createComment("expanded plot");
      plot.before(placeholder);
      expanded = plot;
      $("dialog-content").append(plot);
      $("plot-dialog").showModal();
      charts.resize(plot);
    }),
);
function closeExpanded() {
  if (expanded) {
    placeholder.replaceWith(expanded);
    charts.resize(expanded);
    expanded = null;
  }
}
$("close-dialog").onclick = () => $("plot-dialog").close();
$("plot-dialog").addEventListener("close", closeExpanded);

function workerClient() {
  const worker = new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
  let next = 0;
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    if (data.progress !== undefined) {
      p.progress?.(data.progress);
      return;
    }
    pending.delete(data.id);
    data.error ? p.reject(Error(data.error)) : p.resolve(data);
  };
  worker.onerror = (e) => {
    pending.forEach((p) => p.reject(Error(e.message)));
    pending.clear();
  };
  return {
    run: (data, progress) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject, progress });
        worker.postMessage({ ...data, id });
      }),
    stop: () => {
      worker.terminate();
      pending.forEach((p) => p.reject(Error("Cancelled.")));
      pending.clear();
    },
  };
}
let cloudWorker = workerClient(),
  sceneWorker = workerClient(),
  lutWorker = workerClient();

function readLUTSettings() {
  return {
    resolution_deg: val("lut-resolution"),
    xz_min_deg: val("lut-xz-min"),
    xz_max_deg: val("lut-xz-max"),
    yz_min_deg: val("lut-yz-min"),
    yz_max_deg: val("lut-yz-max"),
    interpolation: "bilinear",
  };
}
function updateLUTDomainLabel() {
  const settings = readLUTSettings(),
    full =
      settings.xz_min_deg === 0 &&
      settings.xz_max_deg === 180 &&
      settings.yz_min_deg === 0 &&
      settings.yz_max_deg === 180;
  $("lut-domain-value").textContent = full
    ? "Full XZ and YZ range · 0–180°"
    : `Custom · XZ ${settings.xz_min_deg}–${settings.xz_max_deg}° · YZ ${settings.yz_min_deg}–${settings.yz_max_deg}°`;
}
function lutState(text, kind = "") {
  for (const id of ["lut-status", "scene-lut-status"]) {
    $(id).textContent = text;
    $(id).dataset.state = kind;
  }
}
function setLUTExportEnabled(enabled) {
  for (const id of ["export-lut", "scene-export-lut"])
    $(id).disabled = !enabled;
}
function setLUTProgress(value) {
  const progress = Math.max(0, Math.min(1, Number(value) || 0)),
    percent = `${Math.round(progress * 100)}%`;
  for (const id of ["lut-progress", "scene-lut-progress"])
    $(id).value = progress;
  for (const id of ["lut-progress-output", "scene-lut-progress-output"])
    $(id).value = percent;
  lutState(`Generating LUT · ${percent}`, "busy");
}
function setLUTBusy(busy) {
  for (const id of ["generate-lut", "scene-generate-lut"])
    $(id).disabled = busy;
  for (const id of ["cancel-lut", "scene-cancel-lut"]) $(id).hidden = !busy;
  for (const id of ["lut-progress-wrap", "scene-lut-progress-wrap"])
    $(id).hidden = !busy;
  if (busy) {
    setLUTExportEnabled(false);
    setLUTProgress(0);
  }
}
async function checkLUTCompatibility(c = readConfig()) {
  const generation = ++lutCheckGeneration;
  if (!currentLUT) {
    lutStale = false;
    lutState("LUT not generated", "empty");
    setLUTExportEnabled(false);
    return false;
  }
  const signature = await lutWorker.run({
    type: "lut_signature",
    config: c,
    settings: readLUTSettings(),
  });
  if (generation !== lutCheckGeneration) return false;
  lutStale = signature.lutHash !== currentLUT.lutHash;
  lutState(
    lutStale ? "LUT stale — regenerate" : "LUT ready",
    lutStale ? "stale" : "ready",
  );
  setLUTExportEnabled(!lutStale);
  return !lutStale;
}
function lutValidationStats() {
  if (!currentLUT?.validation) return;
  const v = currentLUT.validation;
  stats("lut-stats", [
    ["Resolution", fmt(v.resolution_deg, 3), "deg"],
    ["Grid nodes", v.cells.toLocaleString(), ""],
    [
      "Valid / invalid",
      `${v.valid_cells.toLocaleString()} / ${v.invalid_cells.toLocaleString()}`,
      "",
    ],
    ["Generation", fmt(v.generation_time_s, 3), "s"],
    ["Memory", fmt(v.memory_bytes / 1048576, 2), "MB"],
    ["Validation RMS", fmt(v.rms_angular_error_deg, 6), "deg"],
    ["Validation P95", fmt(v.p95_angular_error_deg, 6), "deg"],
    ["Validation maximum", fmt(v.max_angular_error_deg, 6), "deg"],
    [
      "Equivalent RMS at 1 / 5 / 10 m",
      `${fmt(v.equivalent_rms_position_error_mm_at_1m, 3)} / ${fmt(v.equivalent_rms_position_error_mm_at_5m, 3)} / ${fmt(v.equivalent_rms_position_error_mm_at_10m, 3)}`,
      "mm",
    ],
  ]);
}
async function generateCurrentLUT() {
  if (lutBusy) return;
  lutBusy = true;
  setLUTBusy(true);
  try {
    const response = await lutWorker.run(
      {
        type: "generate_lut",
        config: readConfig(),
        settings: readLUTSettings(),
      },
      setLUTProgress,
    );
    setLUTProgress(1);
    currentLUT = response.lut;
    lutStale = false;
    lutState(response.reused ? "LUT ready · cached" : "LUT ready", "ready");
    setLUTExportEnabled(true);
    $("lut-views").hidden = false;
    lutValidationStats();
    await charts.drawLUT(currentLUT);
    if (active === "scene" && $("scene-auto").checked) queueScene();
  } catch (e) {
    lutState(
      currentLUT ? "LUT stale — regenerate" : "LUT not generated",
      currentLUT ? "stale" : "empty",
    );
    error(e.message);
  } finally {
    lutBusy = false;
    setLUTBusy(false);
    setLUTExportEnabled(Boolean(currentLUT && !lutStale));
  }
}
$("generate-lut").onclick = generateCurrentLUT;
$("scene-generate-lut").onclick = async () => {
  $("scene-correction-method").value = "compare";
  await generateCurrentLUT();
  clearTimeout(sceneTimer);
  if (currentLUT && !lutStale) await runScene();
};
function cancelLUTGeneration() {
  lutWorker.stop();
  lutWorker = workerClient();
  lutBusy = false;
  setLUTBusy(false);
  lutState(
    currentLUT ? "LUT stale — regenerate" : "LUT not generated",
    currentLUT ? "stale" : "empty",
  );
  setLUTExportEnabled(false);
}
$("cancel-lut").onclick = cancelLUTGeneration;
$("scene-cancel-lut").onclick = cancelLUTGeneration;
for (const id of [
  "lut-resolution",
  "lut-xz-min",
  "lut-xz-max",
  "lut-yz-min",
  "lut-yz-max",
])
  $(id).addEventListener("input", () => {
    updateLUTDomainLabel();
    checkLUTCompatibility().catch((e) => error(e.message));
  });
async function exportCurrentLUT() {
  try {
    if (!currentLUT || !(await checkLUTCompatibility()))
      throw Error("Generate a compatible LUT before exporting.");
    const response = await lutWorker.run({
      type: "export_lut",
      lut: currentLUT,
    });
    jsonDownload(response.data, "enclosure-angular-lut.json");
  } catch (e) {
    error(e.message);
  }
}
$("export-lut").onclick = exportCurrentLUT;
$("scene-export-lut").onclick = exportCurrentLUT;
async function importLUTFile(file) {
  if (!file) return false;
  if (file.size > 120 * 1024 * 1024) throw Error("LUT JSON exceeds 120 MB.");
  const response = await lutWorker.run({
    type: "import_lut",
    text: await file.text(),
    config: readConfig(),
  });
  currentLUT = response.lut;
  const s = currentLUT.settings;
  $("lut-resolution").value = String(s.resolution_deg);
  $("lut-xz-min").value = s.xz_min_deg;
  $("lut-xz-max").value = s.xz_max_deg;
  $("lut-yz-min").value = s.yz_min_deg;
  $("lut-yz-max").value = s.yz_max_deg;
  updateLUTDomainLabel();
  lutStale = false;
  lutState("LUT ready · imported", "ready");
  setLUTExportEnabled(true);
  $("lut-views").hidden = false;
  lutValidationStats();
  await charts.drawLUT(currentLUT);
  error("");
  return true;
}
async function handleLUTImport(event) {
  try {
    const file = event.target.files[0];
    if (!(await importLUTFile(file))) return;
    if (active === "scene") {
      $("scene-correction-method").value = "compare";
      clearTimeout(sceneTimer);
      await runScene();
    }
  } catch (e) {
    error(e.message);
  }
  event.target.value = "";
}
$("import-lut").onchange = handleLUTImport;
$("scene-import-lut").onchange = handleLUTImport;
async function loadCloud(text, name) {
  if (cloudBusy)
    throw Error(
      "Wait for correction to finish or cancel it before loading another cloud.",
    );
  enableCloudExport(false);
  cloudResult = null;
  cloudRun = null;
  cloudLoaded = false;
  $("correct-cloud").disabled = true;
  for (const id of [
    "cloud3d",
    "cloud3d-b",
    "cloud-hist",
    "cloud-correction-range",
    "cloud-method-range",
    "cloud-angular-error",
  ]) {
    await charts.purge(id);
    $(id).replaceChildren();
  }
  $("cloud-stats").replaceChildren();
  const result = await cloudWorker.run({ type: "load", text, name });
  cloudLoaded = true;
  cloudName = name;
  $("cloud-info").textContent =
    `${name} · ${result.count.toLocaleString()} points · ${result.fields.join(", ")}`;
  $("cloud-status").textContent =
    "Loaded. Confirm the input units, then apply correction.";
  $("correct-cloud").disabled = false;
}
$("cloud-file").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 80 * 1024 * 1024)
      throw Error(
        "File exceeds the 80 MB browser limit. Use the Python package.",
      );
    await loadCloud(await f.text(), f.name);
    error("");
  } catch (ex) {
    error(ex.message);
  }
  e.target.value = "";
};
function rangeNote() {
  const method = $("cloud-method").value;
  $("lut-panel").hidden = method === "analytical";
  $("range-note").textContent =
    method === "lut"
      ? "LUT correction preserves each point's measured radius and applies bilinearly interpolated angular correction."
      : "Analytical correction uses the complete two-interface trace and optical-path reconstruction. The configured inside index is the range reference.";
}
["cloud-unit", "cloud-method"].forEach((id) =>
  $(id).addEventListener("input", () => {
    markStale();
    rangeNote();
  }),
);
$("correct-cloud").onclick = async () => {
  try {
    const c = readConfig(),
      method = $("cloud-method").value,
      mode = ANALYTICAL_RANGE_MODEL,
      reference = c.nInside,
      factor = val("cloud-unit");
    if (method !== "analytical" && !(await checkLUTCompatibility(c)))
      throw Error("Generate a compatible LUT for the current enclosure first.");
    cloudBusy = true;
    enableCloudExport(false);
    $("correct-cloud").disabled = true;
    $("cancel-cloud").hidden = false;
    $("cloud-progress").hidden = false;
    $("cloud-status").textContent = "Correcting locally…";
    const snapshot = JSON.stringify({
      c,
      method,
      mode,
      reference,
      factor,
      lutHash: currentLUT?.lutHash,
    });
    const r = await cloudWorker.run(
      {
        type: "correct",
        config: c,
        method,
        mode,
        reference,
        factor,
        lut: method === "analytical" ? null : currentLUT,
      },
      (p) => ($("cloud-progress").value = p),
    );
    cloudResult = r;
    cloudRun = {
      config: toPython(c),
      material: materialSettings(),
      range_model: mode,
      correction_method: method,
      lut_hash: method === "analytical" ? null : currentLUT.lutHash,
      range_reference_index: mode === "optical_path" ? reference : null,
      input_unit: factor === 1 ? "m" : factor === 0.01 ? "cm" : "mm",
      file: cloudName,
    };
    drawCloud();
    const current = JSON.stringify({
      c: readConfig(),
      method: $("cloud-method").value,
      mode: ANALYTICAL_RANGE_MODEL,
      reference: readConfig().nInside,
      factor: val("cloud-unit"),
      lutHash: currentLUT?.lutHash,
    });
    if (snapshot === current) {
      enableCloudExport(true);
      $("cloud-status").textContent =
        `Correction complete. ${r.analyticalValid.toLocaleString()} analytical and ${r.lutValid.toLocaleString()} LUT points are valid.`;
    } else markStale();
    error("");
  } catch (e) {
    error(e.message);
    $("cloud-status").textContent = e.message;
  } finally {
    cloudBusy = false;
    $("correct-cloud").disabled = !cloudLoaded;
    $("cancel-cloud").hidden = true;
    $("cloud-progress").hidden = true;
  }
};
$("cancel-cloud").onclick = () => {
  cloudWorker.stop();
  cloudWorker = workerClient();
  cloudLoaded = false;
  cloudResult = null;
  $("cloud-info").textContent = "Cancelled. Reload your cloud to continue.";
  enableCloudExport(false);
};
function drawCloud() {
  if (!cloudResult) return;
  const r = cloudResult,
    view = $("cloud-view").value,
    finite = (points) => points.filter((p) => p.every(Number.isFinite)),
    raw = charts.points3(finite(r.raw), "Raw", "#86969c", 3),
    analytical = charts.points3(
      finite(r.analytical),
      "Analytical correction",
      "#117f8a",
      4,
    ),
    lut = charts.points3(finite(r.lut), "LUT correction", "#e56b54", 4),
    layout = {
      scene: charts.sceneLayout("m"),
      margin: { l: 0, r: 0, t: 0, b: 0 },
      legend: { orientation: "h", x: 0, y: 1 },
    };
  raw.marker.style = "ring";
  raw.marker.opacity = 0.55;
  analytical.marker.overlay = true;
  lut.marker.overlay = true;
  $("cloud3d-b").hidden = view !== "side";
  if (view === "side") {
    Promise.all([
      charts.plot("cloud3d", [raw, analytical], layout),
      charts.plot("cloud3d-b", [raw, lut], layout),
    ]).then(() => charts.linkCameras("cloud3d", "cloud3d-b"));
  } else {
    let data =
      view === "raw"
        ? [raw]
        : view === "analytical"
          ? [analytical]
          : view === "lut"
            ? [lut]
            : view === "all"
              ? [raw, analytical, lut]
              : [analytical, lut];
    if (view === "difference") {
      const paired = [],
        colors = [];
      r.analytical.forEach((p, i) => {
        if (p.every(Number.isFinite) && r.lut[i]?.every(Number.isFinite)) {
          paired.push(r.lut[i]);
          colors.push(Math.hypot(...p.map((v, j) => v - r.lut[i][j])) * 1000);
        }
      });
      data = [
        charts.points3(
          paired,
          "Analytical vs LUT",
          colors,
          5,
          "Method difference (mm)",
        ),
      ];
    }
    charts.plot("cloud3d", data, layout);
  }
  charts.seriesPlot(
    "cloud-correction-range",
    r.ranges,
    [
      {
        name: "Analytical",
        values: r.rangeAnalyticalMagnitude,
        color: charts.colors.teal,
      },
      { name: "LUT", values: r.rangeLUTMagnitude, color: charts.colors.coral },
    ],
    "Point range (m)",
    "Correction magnitude (mm)",
  );
  charts.seriesPlot(
    "cloud-method-range",
    r.ranges,
    [
      {
        name: "Method difference",
        values: r.rangeMethodDifference,
        color: "#7d63a7",
      },
    ],
    "Point range (m)",
    "Analytical vs LUT (mm)",
  );
  charts.seriesPlot(
    "cloud-angular-error",
    r.ranges,
    [
      {
        name: "LUT interpolation error",
        values: r.rangeLUTInterpolationAngular,
        color: "#b88412",
      },
    ],
    "Point range (m)",
    "Angular difference (deg)",
  );
  charts.histogram("cloud-hist", r.histogram, "Correction magnitude (mm)");
  const m = r.metrics.method_difference_mm,
    a = r.metrics.method_angular_difference_deg,
    analyticalShift = r.metrics.analytical_correction_magnitude_mm,
    lutShift = r.metrics.lut_correction_magnitude_mm,
    rt = r.runtime,
    counts = (values) =>
      Object.entries(values)
        .map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`)
        .join(" · ") || "—";
  stats("cloud-stats", [
    ["Input points", r.total.toLocaleString(), ""],
    ["Valid analytical", r.analyticalValid.toLocaleString(), ""],
    ["Valid LUT", r.lutValid.toLocaleString(), ""],
    [
      "Rejected analytical / LUT",
      `${r.total - r.analyticalValid} / ${r.total - r.lutValid}`,
      "",
    ],
    ["Analytical statuses", counts(r.analyticalCounts), ""],
    ["LUT statuses", counts(r.lutCounts), ""],
    [
      "Analytical correction magnitude",
      `${fmt(analyticalShift.mean, 3)} mean · ${fmt(analyticalShift.rms, 3)} RMS`,
      "mm",
    ],
    [
      "LUT correction magnitude",
      `${fmt(lutShift.mean, 3)} mean · ${fmt(lutShift.rms, 3)} RMS`,
      "mm",
    ],
    [
      "Mean method difference",
      fmt(m.mean, 3),
      "mm",
      "Method comparison, not ground-truth error",
    ],
    ["RMS method difference", fmt(m.rms, 3), "mm"],
    ["Median / P95", `${fmt(m.median, 3)} / ${fmt(m.p95, 3)}`, "mm"],
    ["Maximum method difference", fmt(m.max, 3), "mm"],
    ["Mean angular difference", fmt(a.mean, 6), "deg"],
    ["Analytical runtime", fmt(rt.analytical_ms, 2), "ms"],
    ["LUT runtime", fmt(rt.lut_ms, 2), "ms"],
    [
      "Analytical throughput",
      fmt(rt.analytical_points_per_second, 0),
      "points/s",
    ],
    ["LUT throughput", fmt(rt.lut_points_per_second, 0), "points/s"],
    ["LUT speed-up", fmt(rt.lut_speedup, 2), "×", "Measured in this browser"],
  ]);
}
$("cloud-view").onchange = drawCloud;
for (const format of ["pcd", "csv"])
  $("export-" + format).onclick = async () => {
    try {
      const layer = $("cloud-export-layer").value;
      const r = await cloudWorker.run({ type: "export", format, layer });
      download(
        r.text,
        `${r.layer}-corrected.${format}`,
        format === "csv" ? "text/csv" : "text/plain",
      );
    } catch (e) {
      error(e.message);
    }
  };
$("export-report").onclick = () =>
  jsonDownload(
    {
      ...cloudRun,
      total: cloudResult.total,
      valid: cloudResult.valid,
      status_counts: cloudResult.counts,
      row_status: cloudResult.statuses,
      analytical_status_counts: cloudResult.analyticalCounts,
      lut_status_counts: cloudResult.lutCounts,
      method_comparison_metrics: cloudResult.metrics,
      runtime: cloudResult.runtime,
    },
    "correction-report.json",
  );
$("demo-cloud").onclick = async () => {
  try {
    const c = readConfig();
    const r = await sceneWorker.run({
      type: "scene",
      config: c,
      objects: defaultObjects(),
      pose: { position: [0, 0, 0], rpy: [0, 0, 0] },
      resolution: 45,
      fov: 60,
      mode: "optical_path",
    });
    await loadCloud(
      csvText([["x", "y", "z"], ...r.result.rawLocal]),
      "synthetic-raw.csv",
    );
    $("cloud-unit").value = "1";
    rangeNote();
    notice(
      "Synthetic optical ranges loaded using the current geometry. Apply correction to reconstruct them.",
    );
  } catch (e) {
    error(e.message);
  }
};

const objectFields = [
  "object-x",
  "object-y",
  "object-z",
  "object-sx",
  "object-sy",
  "object-sz",
  "object-roll",
  "object-pitch",
  "object-yaw",
];
function objectEditor() {
  const i = Number($("object-list").value) || 0;
  $("object-list").replaceChildren(
    ...objects.map((o, j) => new Option(`${j + 1}. ${o.name} · ${o.type}`, j)),
  );
  $("object-list").value = Math.min(i, objects.length - 1);
  const o = objects[Number($("object-list").value)];
  $("object-name").value = o.name;
  objectFields.forEach(
    (id, j) => ($(id).value = [...o.position, ...o.size, ...o.rpy][j]),
  );
}
function sceneEdited() {
  markStale();
  try {
    readObjects();
    drawScene();
    if ($("scene-auto").checked) queueScene();
    error("");
  } catch (e) {
    error(e.message);
  }
}
function readObjects() {
  const o = objects[Number($("object-list").value)];
  o.name = $("object-name").value;
  o.position = objectFields.slice(0, 3).map(val);
  o.size = objectFields.slice(3, 6).map(val);
  o.rpy = objectFields.slice(6, 9).map(val);
  return validateObjects(objects);
}
function worldPose() {
  return {
    position: ["world-x", "world-y", "world-z"].map(val),
    rpy: ["world-roll", "world-pitch", "world-yaw"].map(val),
  };
}
function sceneSnapshot() {
  return {
    config: toPython(readConfig()),
    lut: readLUTSettings(),
    material: materialSettings(),
    objects: structuredClone(readObjects()),
    pose: worldPose(),
    resolution: val("resolution"),
    fov: val("fov"),
    mode: ANALYTICAL_RANGE_MODEL,
    correction_method: $("scene-correction-method").value,
  };
}
function storeStation() {
  stations[stationIndex] = {
    name: stations[stationIndex].name,
    config: toPython(readConfig()),
    material: materialSettings(),
    pose: worldPose(),
  };
}
function stationMenu() {
  const select = $("station-list");
  select.replaceChildren(...stations.map((s, i) => new Option(s.name, i)));
  select.value = stationIndex;
}
function selectStation(index) {
  stationIndex = index;
  const station = stations[index];
  applyConfig(fromPython(station.config));
  restoreMaterial(station.material);
  ["world-x", "world-y", "world-z"].forEach(
    (id, i) => ($(id).value = station.pose.position[i]),
  );
  ["world-roll", "world-pitch", "world-yaw"].forEach(
    (id, i) => ($(id).value = station.pose.rpy[i]),
  );
  sceneGeneration++;
  sceneResult = null;
  markStale();
  for (const id of ["scene-pcd", "scene-csv", "scene-report"])
    $(id).disabled = true;
  stationMenu();
  sceneEdited();
}
$("station-list").onchange = () => {
  try {
    const index = Number($("station-list").value);
    storeStation();
    selectStation(index);
  } catch (e) {
    error(e.message);
  }
};
$("add-station").onclick = () => {
  try {
    if (stations.length >= 8) throw Error("Maximum eight sensor stations.");
    storeStation();
    const station = structuredClone(stations[stationIndex]);
    station.name = `LiDAR ${Math.max(...stations.map((s) => Number(s.name.replace("LiDAR ", "")) || 0)) + 1}`;
    station.pose.position[0] += 0.5;
    stations.push(station);
    selectStation(stations.length - 1);
  } catch (e) {
    error(e.message);
  }
};
$("remove-station").onclick = () => {
  if (stations.length === 1) {
    error("Keep at least one sensor station.");
    return;
  }
  stations.splice(stationIndex, 1);
  selectStation(Math.min(stationIndex, stations.length - 1));
};
$("object-list").onchange = objectEditor;
[
  ...objectFields,
  "object-name",
  "world-x",
  "world-y",
  "world-z",
  "world-roll",
  "world-pitch",
  "world-yaw",
  "resolution",
  "fov",
  "scene-correction-method",
].forEach((id) => $(id).addEventListener("input", sceneEdited));
$("add-object").onclick = () => {
  if (objects.length >= 30) {
    error("Maximum 30 objects.");
    return;
  }
  const type = $("new-object").value;
  objects.push({
    name: `Target ${objects.length + 1}`,
    type,
    position: [0, 0, 3],
    size: type === "sphere" ? [0.3, 0.3, 0.3] : [1, 1, 1],
    rpy: [0, 0, 0],
  });
  objectEditor();
  $("object-list").value = objects.length - 1;
  objectEditor();
  sceneEdited();
};
$("remove-object").onclick = () => {
  if (objects.length <= 1) {
    error("Keep at least one target.");
    return;
  }
  objects.splice(Number($("object-list").value), 1);
  objectEditor();
  sceneEdited();
};
function queueScene() {
  clearTimeout(sceneTimer);
  sceneTimer = setTimeout(runScene, 350);
}
let sceneGeneration = 0;
async function runScene() {
  const generation = ++sceneGeneration;
  try {
    const snapshot = sceneSnapshot();
    const needsLUT = snapshot.correction_method !== "analytical";
    if (needsLUT && !(await checkLUTCompatibility(readConfig())))
      throw Error(
        "Generate a compatible LUT for the current enclosure before running LUT correction.",
      );
    $("scene-status").textContent = "Tracing rays in the scene…";
    const r = await sceneWorker.run({
      type: "scene",
      config: fromPython(snapshot.config),
      objects: snapshot.objects,
      pose: snapshot.pose,
      resolution: snapshot.resolution,
      fov: snapshot.fov,
      mode: snapshot.mode,
      lut: needsLUT ? currentLUT : null,
    });
    if (generation !== sceneGeneration) return;
    sceneResult = r.result;
    sceneRun = snapshot;
    drawScene();
    const matched =
      JSON.stringify(snapshot) === JSON.stringify(sceneSnapshot());
    $("scene-status").textContent = matched
      ? `${sceneResult.truth.length.toLocaleString()} returns · ${sceneResult.rejected} rejected rays · ${sceneResult.missed} misses. Metrics use synthetic refracted-hit truth.`
      : "Settings changed; updating simulation…";
    for (const id of ["scene-pcd", "scene-csv", "scene-report"])
      $(id).disabled = !matched;
    error("");
  } catch (e) {
    error(e.message);
    $("scene-status").textContent = e.message;
  }
}
$("simulate").onclick = runScene;
$("scene-auto").onchange = () => {
  if ($("scene-auto").checked) queueScene();
};
const rmse = (values) =>
  values.length
    ? Math.sqrt(values.reduce((s, x) => s + x * x, 0) / values.length)
    : NaN;
function drawScene() {
  const data = objects.map(charts.objectMesh),
    pose = worldPose(),
    q = rotation(...pose.rpy),
    origin = add(pose.position, mv(q, config.origin));
  const hasLUTResult = Boolean(sceneResult?.lut?.length);
  document
    .querySelectorAll(".scene-layer-picker [data-needs-lut]")
    .forEach((label) => {
      label.classList.toggle("is-unavailable", !hasLUTResult);
      const input = label.querySelector("input");
      input.disabled = !hasLUTResult;
      label.title = hasLUTResult
        ? ""
        : "Generate a LUT and run comparison to enable this layer.";
    });
  stations.forEach((s, i) => {
    if (i === stationIndex) return;
    const c = fromPython(s.config),
      q = rotation(...s.pose.rpy),
      p = add(s.pose.position, mv(q, c.origin));
    data.push({
      ...charts.points3([p], s.name, "#889da5", 5),
      mode: "markers+text",
      text: [s.name],
      textposition: "top center",
    });
    data.push(
      charts.line3(
        [p, add(p, mul(mv(q, mv(c.rotation, [0, 0, 1])), 0.5))],
        `${s.name} forward`,
        "#a4b6be",
        3,
      ),
    );
  });
  data.push({
    ...charts.points3([origin], "LiDAR station", "#123d50", 7),
    mode: "markers+text",
    text: ["LiDAR"],
    textposition: "top center",
  });
  data.push(
    charts.line3(
      [origin, add(origin, mul(mv(q, mv(config.rotation, [0, 0, 1])), 0.7))],
      "Sensor +Z forward",
      charts.colors.teal,
      6,
    ),
  );
  if (sceneResult) {
    const r = sceneResult,
      layers = new Set(
        [
          ...document.querySelectorAll(
            '[name="scene-layer"]:checked:not(:disabled)',
          ),
        ].map((input) => input.value),
      );
    const addLayer = (points, name, color, size, bar, ring = false) => {
      if (!points?.length) return;
      const cloud = charts.points3(points, name, color, size, bar);
      cloud.marker.opacity = ring ? 0.58 : 0.92;
      cloud.marker.overlay = true;
      if (ring) cloud.marker.style = "ring";
      data.push(cloud);
    };
    if (layers.has("bare")) addLayer(r.bare, "No enclosure", "#4d73bd", 4);
    if (layers.has("raw"))
      addLayer(r.raw, "Raw · no correction", "#9ba8ad", 6, null, true);
    if (layers.has("truth"))
      addLayer(r.truth, "Refracted-hit truth", "#87969b", 4);
    if (layers.has("analytical"))
      addLayer(r.analytical, "Analytical correction", charts.colors.teal, 5);
    if (layers.has("lut"))
      addLayer(r.lut, "LUT correction", charts.colors.coral, 5);
    if (layers.has("analytical-error"))
      addLayer(
        r.analytical,
        "Analytical ground-truth error",
        r.error,
        5,
        "Error (mm)",
      );
    if (layers.has("lut-error"))
      addLayer(r.lut, "LUT ground-truth error", r.lutError, 5, "Error (mm)");
    if (layers.has("method-difference"))
      addLayer(
        r.lut,
        "LUT vs Analytical",
        r.methodDifference,
        5,
        "Method difference (mm)",
      );
    const raw = r.metrics.raw,
      analyticalMetric = r.metrics.analytical,
      lutMetric = r.metrics.lut,
      methodMetric = r.metrics.method_difference;
    stats("scene-stats", [
      ["Raw 3D RMSE", fmt(raw.rms, 4), "mm", "Synthetic ground-truth error"],
      [
        "Analytical 3D RMSE",
        fmt(analyticalMetric.rms, 6),
        "mm",
        "Exact-model consistency result",
      ],
      [
        "LUT 3D RMSE",
        fmt(lutMetric.rms, 4),
        "mm",
        "Synthetic ground-truth error",
      ],
      [
        "Raw / analytical / LUT mean",
        `${fmt(raw.mean, 3)} / ${fmt(analyticalMetric.mean, 3)} / ${fmt(lutMetric.mean, 3)}`,
        "mm",
      ],
      [
        "Raw / analytical / LUT P95",
        `${fmt(raw.p95, 3)} / ${fmt(analyticalMetric.p95, 3)} / ${fmt(lutMetric.p95, 3)}`,
        "mm",
      ],
      [
        "Raw / analytical / LUT maximum",
        `${fmt(raw.max, 3)} / ${fmt(analyticalMetric.max, 3)} / ${fmt(lutMetric.max, 3)}`,
        "mm",
      ],
      [
        "LUT vs Analytical RMS",
        fmt(methodMetric.rms, 4),
        "mm",
        "Method difference",
      ],
      [
        "LUT angular interpolation RMS",
        fmt(r.metrics.lut_angular_interpolation.rms, 6),
        "deg",
      ],
      [
        "Raw / analytical / LUT angular RMS",
        `${fmt(r.metrics.raw_angular.rms, 5)} / ${fmt(r.metrics.analytical_angular.rms, 5)} / ${fmt(r.metrics.lut_angular.rms, 5)}`,
        "deg",
        "Angular error against synthetic truth",
      ],
      [
        "Analytical / LUT runtime",
        `${fmt(r.analyticalTimeMs, 2)} / ${fmt(r.lutTimeMs, 2)}`,
        "ms",
      ],
      [
        "Measured LUT speed-up",
        fmt(r.lutTimeMs > 0 ? r.analyticalTimeMs / r.lutTimeMs : NaN, 2),
        "×",
      ],
      [
        "Returns / misses / ray rejected",
        `${r.truth.length} / ${r.missed} / ${r.rejected}`,
        "",
      ],
      ["LUT rejected", r.lutRejected ?? "—", "points"],
    ]);
    charts.plot(
      "scene-error-summary",
      [
        {
          type: "bar",
          x: ["Raw", "Analytical", "LUT"],
          y: [raw.rms, analyticalMetric.rms, lutMetric.rms],
          marker: {
            color: ["#9ba8ad", charts.colors.teal, charts.colors.coral],
          },
        },
      ],
      {
        xaxis: { title: { text: "Reconstruction" } },
        yaxis: {
          title: { text: "3D endpoint RMSE (mm)" },
          rangemode: "tozero",
        },
        margin: { l: 60, r: 20, t: 20, b: 55 },
      },
    );
    charts.seriesPlot(
      "scene-errors",
      r.ranges,
      [
        { name: "Raw", values: r.rawError, color: "#9ba8ad" },
        { name: "Analytical", values: r.error, color: charts.colors.teal },
        {
          name: "LUT",
          x: r.lutRanges,
          values: r.lutError,
          color: charts.colors.coral,
        },
      ],
      "Measured range (m)",
      "Ground-truth error (mm)",
    );
    charts.seriesPlot(
      "scene-angle-errors",
      r.incidentAngles,
      [
        { name: "Raw", values: r.rawError, color: "#9ba8ad" },
        { name: "Analytical", values: r.error, color: charts.colors.teal },
        {
          name: "LUT",
          x: r.lutIncidentAngles,
          values: r.lutError,
          color: charts.colors.coral,
        },
      ],
      "Incident angle from sensor +Z (deg)",
      "Ground-truth error (mm)",
    );
    charts.seriesPlot(
      "scene-angular-errors",
      r.incidentAngles,
      [
        { name: "Raw", values: r.rawAngularError, color: "#9ba8ad" },
        {
          name: "Analytical",
          values: r.analyticalAngularError,
          color: charts.colors.teal,
        },
        {
          name: "LUT",
          x: r.lutIncidentAngles,
          values: r.lutTruthAngularError,
          color: charts.colors.coral,
        },
      ],
      "Incident angle from sensor +Z (deg)",
      "Angular error vs truth (deg)",
    );
    $("scene-method-empty").hidden = hasLUTResult;
    $("scene-angular-empty").hidden = hasLUTResult;
    $("scene-method-difference").hidden = !hasLUTResult;
    $("scene-lut-angular").hidden = !hasLUTResult;
    charts.seriesPlot(
      "scene-method-difference",
      r.lutRanges,
      [
        {
          name: "Method difference",
          values: r.methodDifference,
          color: "#7d63a7",
        },
      ],
      "Measured range (m)",
      "LUT vs Analytical (mm)",
    );
    charts.seriesPlot(
      "scene-lut-angular",
      r.lutIncidentAngles,
      [
        {
          name: "LUT interpolation error",
          values: r.lutAngularError,
          color: "#b88412",
        },
      ],
      "Incident angle from sensor +Z (deg)",
      "Angular difference (deg)",
    );
  }
  charts
    .plot("scene3d", data, {
      scene: charts.sceneLayout("m"),
      margin: { l: 0, r: 0, t: 10, b: 0 },
      showlegend: false,
    })
    .then(() => {
      charts.onPick("scene3d", (event) => {
        const p = event.points[0],
          mode = $("scene-click").value;
        if (mode === "inspect") return;
        const values = [p.x, p.y, p.z];
        if (!values.every(Number.isFinite)) return;
        if (mode === "sensor")
          ["world-x", "world-y", "world-z"].forEach(
            (id, i) => ($(id).value = values[i].toFixed(4)),
          );
        else {
          objects[Number($("object-list").value)].position = values;
          objectEditor();
        }
        sceneEdited();
      });
    });
}
document
  .querySelectorAll('[name="scene-layer"]')
  .forEach((input) => input.addEventListener("change", drawScene));
$("save-scene").onclick = () => {
  try {
    storeStation();
    jsonDownload(
      {
        schema_version: 1,
        ...sceneSnapshot(),
        stations,
        active_station: stationIndex,
      },
      "enclosure-scene.json",
    );
  } catch (e) {
    error(e.message);
  }
};
$("load-scene").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 2000000) throw Error("Scene JSON exceeds 2 MB.");
    const data = JSON.parse(await f.text());
    // Multi-station scenes use the active station as the source of truth.
    // Top-level fields remain a compatibility snapshot for older single-station files.
    if (data.stations !== undefined) {
      if (
        !Array.isArray(data.stations) ||
        data.stations.length < 1 ||
        data.stations.length > 8 ||
        !Number.isInteger(data.active_station) ||
        data.active_station < 0 ||
        data.active_station >= data.stations.length
      )
        throw Error("Invalid stations.");
      const activeStation = data.stations[data.active_station];
      if (!activeStation || typeof activeStation !== "object")
        throw Error("Invalid active station.");
      data.config = activeStation.config;
      data.pose = activeStation.pose;
      data.material = activeStation.material;
    }
    validateObjects(data.objects);
    const c = fromPython(data.config);
    if (
      !data.pose?.position?.every(Number.isFinite) ||
      data.pose.position.length !== 3 ||
      !data.pose.rpy?.every(Number.isFinite) ||
      data.pose.rpy.length !== 3
    )
      throw Error("Invalid scene pose.");
    if (
      !Number.isInteger(data.resolution) ||
      data.resolution < 5 ||
      data.resolution > 151 ||
      !Number.isFinite(data.fov) ||
      data.fov < 1 ||
      data.fov >= 170 ||
      !["optical_path", "geometric_path", "direction_only"].includes(data.mode)
    )
      throw Error("Invalid scan settings.");
    if (data.stations) {
      if (
        !Array.isArray(data.stations) ||
        data.stations.length < 1 ||
        data.stations.length > 8 ||
        !Number.isInteger(data.active_station) ||
        data.active_station < 0 ||
        data.active_station >= data.stations.length
      )
        throw Error("Invalid stations.");
      for (const st of data.stations) {
        fromPython(st.config);
        if (
          typeof st.name !== "string" ||
          st.name.length > 100 ||
          !st.pose?.position?.every(Number.isFinite) ||
          st.pose.position.length !== 3 ||
          !st.pose.rpy?.every(Number.isFinite) ||
          st.pose.rpy.length !== 3
        )
          throw Error("Invalid station pose.");
      }
      stations = data.stations;
      stationIndex = data.active_station;
    } else {
      stations = [{ name: "LiDAR 1", config: data.config, pose: data.pose }];
      stationIndex = 0;
    }
    stationMenu();
    applyConfig(c);
    restoreMaterial(data.material);
    objects = data.objects;
    ["world-x", "world-y", "world-z"].forEach(
      (id, i) => ($(id).value = data.pose.position[i]),
    );
    ["world-roll", "world-pitch", "world-yaw"].forEach(
      (id, i) => ($(id).value = data.pose.rpy[i]),
    );
    $("resolution").value = data.resolution;
    $("fov").value = data.fov;
    $("scene-correction-method").value = data.correction_method || "compare";
    if (data.lut) {
      $("lut-resolution").value = data.lut.resolution_deg;
      $("lut-xz-min").value = data.lut.xz_min_deg;
      $("lut-xz-max").value = data.lut.xz_max_deg;
      $("lut-yz-min").value = data.lut.yz_min_deg;
      $("lut-yz-max").value = data.lut.yz_max_deg;
      updateLUTDomainLabel();
    }
    objectEditor();
    sceneEdited();
  } catch (ex) {
    error(ex.message);
  }
  e.target.value = "";
};
for (const format of ["pcd", "csv"])
  $("scene-" + format).onclick = () => {
    const layer = $("scene-export-layer").value,
      points = sceneResult[layer];
    download(
      format === "pcd" ? xyzPCD(points) : csvText([["x", "y", "z"], ...points]),
      `scene-${layer}-metres.${format}`,
    );
  };
$("scene-report").onclick = () =>
  jsonDownload(
    {
      ...sceneRun,
      synthetic_ground_truth_metrics: sceneResult.metrics,
      runtime: {
        analytical_ms: sceneResult.analyticalTimeMs,
        lut_ms: sceneResult.lutTimeMs,
        lut_speedup:
          sceneResult.lutTimeMs > 0
            ? sceneResult.analyticalTimeMs / sceneResult.lutTimeMs
            : null,
      },
      returns: sceneResult.truth.length,
      rejected: sceneResult.rejected,
      missed: sceneResult.missed,
      correction_input: "raw_sensor_frame_cloud",
      ground_truth_role: "synthetic_evaluation_only",
      interpretation:
        "Synthetic exact-model consistency; no real-world accuracy claim.",
    },
    "scene-report.json",
  );

function materialTable() {
  const table = document.createElement("table");
  const head = document.createElement("tr");
  for (const name of ["Material", "Index / model", "Source"]) {
    const th = document.createElement("th");
    th.textContent = name;
    head.append(th);
  }
  table.append(head);
  for (const [key, m] of Object.entries(materials)) {
    if (key === "custom") continue;
    const tr = document.createElement("tr"),
      a = document.createElement("td"),
      b = document.createElement("td"),
      c = document.createElement("td"),
      link = document.createElement("a");
    a.textContent = m.name;
    b.textContent = m.note;
    link.textContent = "Manufacturer data ↗";
    if (m.url) link.href = m.url;
    link.target = "_blank";
    link.rel = "noopener";
    if (m.url) {
      link.textContent = "Source";
      c.append(link);
    } else
      c.textContent = key.startsWith("user_")
        ? "User supplied"
        : "Reference assumption";
    tr.append(a, b, c);
    table.append(tr);
  }
  $("material-table").replaceChildren(table);
}
setupLibrary(() => {
  materialTable();
  materialNote();
  changed();
});
materialNote();
materialTable();
rangeNote();
objectEditor();
window.addEventListener("hashchange", () => tab(location.hash.slice(1)));
await tab(location.hash.slice(1) || "designer");
window.addEventListener("resize", () =>
  document
    .querySelectorAll("section:not([hidden]) .research-view")
    .forEach((p) => charts.resize(p)),
);
