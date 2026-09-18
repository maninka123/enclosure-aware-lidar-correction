import {
  baseline,
  validate,
  rotation,
  mv,
  trace,
  beamDirection,
  angle,
  norm,
  sub,
  add,
  mul,
  fromPython,
  toPython,
} from "./physics.js";
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
  cloudBusy = false;
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
    const n = indexFor($("material").value, val("wavelength"));
    if (n !== undefined) $("nwall").value = n.toFixed(9);
    materialNote();
    changed();
  } catch (e) {
    error(e.message);
  }
}
function rayNow() {
  return trace(
    mv(config.rotation, beamDirection(val("azimuth"), val("polar"))),
    config,
  );
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
    $("polar-out").value = `${val("polar")}°`;
    $("azimuth-out").value = `${val("azimuth")}°`;
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
      ]);
      $("designer-section-title").textContent = `${a} ray path`;
      $("designer-section-b-title").textContent = `${b} ray path`;
      await Promise.all([
        charts.geometry("geometry", config, ray, length),
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
    } else if (active === "beam") {
      stats("beam-stats", [
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
        [
          "Total deflection",
          ray.valid ? fmt(ray.deflection, 5) : "Blocked",
          "deg",
          ray.valid ? "Transmitted ray" : ray.status.replaceAll("_", " "),
        ],
      ]);
      $("beam-a-title").textContent = `${a} projection`;
      $("beam-b-title").textContent = `${b} projection`;
      await Promise.all([
        charts.geometry("beam3d", config, ray, length, false),
        charts.beam2d("beam-a", config, ray, length, a),
        charts.beam2d("beam-b", config, ray, length, b),
      ]);
    } else if (active === "atlas") {
      atlasData = charts.atlas(config);
      const v = atlasData.values,
        max = v.length ? Math.max(...v) : NaN,
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
async function tab(name) {
  if (
    !$(name) ||
    !["designer", "beam", "atlas", "cloud", "scene", "learn"].includes(name)
  )
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
    jsonDownload(toPython(readConfig()), "enclosure-config.json");
  } catch (e) {
    error(e.message);
  }
};
$("load-config").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 1000000) throw Error("Configuration too large.");
    applyConfig(fromPython(JSON.parse(await f.text())));
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
document.querySelectorAll("[data-camera]").forEach(
  (b) =>
    (b.onclick = () =>
      window.Plotly.relayout(b.dataset.view, {
        "scene.camera": {
          eye:
            b.dataset.camera === "top"
              ? { x: 0, y: 0, z: 2.5 }
              : { x: 0, y: -2.5, z: 0.05 },
          up: { x: 0, y: 0, z: 1 },
        },
      })),
);
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
          ["beam-a", "designer-section"].includes(b.dataset.focus)
            ? $("plane-a").value
            : $("plane-b").value,
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
      window.Plotly.Plots.resize(plot);
    }),
);
function closeExpanded() {
  if (expanded) {
    placeholder.replaceWith(expanded);
    window.Plotly.Plots.resize(expanded);
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
  sceneWorker = workerClient();
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
  for (const id of ["cloud3d", "cloud-hist"]) {
    window.Plotly.purge(id);
    $(id).replaceChildren();
  }
  $("cloud-stats").replaceChildren();
  const result = await cloudWorker.run({ type: "load", text, name });
  cloudLoaded = true;
  cloudName = name;
  $("cloud-info").textContent =
    `${name} · ${result.count.toLocaleString()} points · ${result.fields.join(", ")}`;
  $("cloud-status").textContent =
    "Loaded. Confirm units, axes and range model, then apply correction.";
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
  const mode = $("cloud-mode").value;
  $("cloud-reference").disabled = mode !== "optical_path";
  $("range-note").textContent =
    mode === "direction_only"
      ? "Preserves the measured radius; approximates the exit ray as starting at the source."
      : mode === "geometric_path"
        ? "Use only when the reported radius is the sum of physical path lengths in all three media."
        : "Assumes reference index × reported radius equals the one-way optical path. Check sensor firmware, range offsets and group-index effects.";
}
["cloud-unit", "cloud-mode", "cloud-reference"].forEach((id) =>
  $(id).addEventListener("input", () => {
    markStale();
    rangeNote();
  }),
);
$("correct-cloud").onclick = async () => {
  try {
    const c = readConfig(),
      mode = $("cloud-mode").value,
      reference = val("cloud-reference"),
      factor = val("cloud-unit");
    if (
      mode === "optical_path" &&
      (!Number.isFinite(reference) || reference <= 0)
    )
      throw Error("Range reference index must be positive.");
    cloudBusy = true;
    enableCloudExport(false);
    $("correct-cloud").disabled = true;
    $("cancel-cloud").hidden = false;
    $("cloud-progress").hidden = false;
    $("cloud-status").textContent = "Correcting locally…";
    const snapshot = JSON.stringify({ c, mode, reference, factor });
    const r = await cloudWorker.run(
      { type: "correct", config: c, mode, reference, factor },
      (p) => ($("cloud-progress").value = p),
    );
    cloudResult = r;
    cloudRun = {
      config: toPython(c),
      material: materialSettings(),
      range_model: mode,
      range_reference_index: mode === "optical_path" ? reference : null,
      input_unit: factor === 1 ? "m" : factor === 0.01 ? "cm" : "mm",
      file: cloudName,
    };
    drawCloud();
    const current = JSON.stringify({
      c: readConfig(),
      mode: $("cloud-mode").value,
      reference: val("cloud-reference"),
      factor: val("cloud-unit"),
    });
    if (snapshot === current) {
      enableCloudExport(true);
      $("cloud-status").textContent =
        `Correction complete: ${r.valid.toLocaleString()} / ${r.total.toLocaleString()} valid points. ${r.total - r.valid} rows rejected.`;
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
    data = [];
  if ($("show-raw").checked)
    data.push(charts.points3(r.raw, "Raw", "#b5c1c6", 2));
  if ($("show-corrected").checked)
    data.push(
      charts.points3(r.corrected, "Corrected", r.deviations, 2, "Shift (mm)"),
    );
  charts.plot("cloud3d", data, {
    scene: charts.sceneLayout("m"),
    margin: { l: 0, r: 0, t: 0, b: 0 },
    legend: { orientation: "h", x: 0, y: 1 },
  });
  charts.histogram("cloud-hist", r.histogram);
  stats("cloud-stats", [
    ["Input points", r.total.toLocaleString(), ""],
    ["Valid points", r.valid.toLocaleString(), ""],
    ["RMS displacement", fmt(r.rms, 3), "mm"],
    ["Maximum displacement", fmt(r.max, 3), "mm"],
  ]);
}
["show-raw", "show-corrected"].forEach((id) => ($(id).onchange = drawCloud));
for (const format of ["pcd", "csv"])
  $("export-" + format).onclick = async () => {
    try {
      const r = await cloudWorker.run({ type: "export", format });
      download(
        r.text,
        `corrected.${format}`,
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
      rms_displacement_mm: cloudResult.rms,
      max_displacement_mm: cloudResult.max,
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
    $("cloud-mode").value = "optical_path";
    $("cloud-reference").value = c.nInside;
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
    material: materialSettings(),
    objects: structuredClone(readObjects()),
    pose: worldPose(),
    resolution: val("resolution"),
    fov: val("fov"),
    mode: $("scene-mode").value,
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
  "scene-mode",
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
    $("scene-status").textContent = "Tracing rays in the scene…";
    const r = await sceneWorker.run({
      type: "scene",
      config: fromPython(snapshot.config),
      objects: snapshot.objects,
      pose: snapshot.pose,
      resolution: snapshot.resolution,
      fov: snapshot.fov,
      mode: snapshot.mode,
    });
    if (generation !== sceneGeneration) return;
    sceneResult = r.result;
    sceneRun = snapshot;
    drawScene();
    const matched =
      JSON.stringify(snapshot) === JSON.stringify(sceneSnapshot());
    $("scene-status").textContent = matched
      ? `${sceneResult.truth.length.toLocaleString()} returns · ${sceneResult.rejected} invalid rays · ${sceneResult.missed} misses. Optical ranges simulated with n_ref = n_inside.`
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
      layer = $("scene-layer").value;
    for (const [key, name, color] of [
      ["bare", "No enclosure", "#6284b4"],
      ["raw", "Enclosure raw", "#dd8c64"],
      ["truth", "Refracted-hit truth", "#98a9ad"],
      ["corrected", "Corrected", r.error],
    ])
      if (layer === "all" || layer === key)
        data.push(
          charts.points3(
            r[key],
            name,
            color,
            2,
            key === "corrected" ? "Error (mm)" : undefined,
          ),
        );
    stats("scene-stats", [
      ["No-enclosure returns", r.bare.length.toLocaleString(), ""],
      ["Enclosure returns", r.truth.length.toLocaleString(), ""],
      ["Raw 3D RMSE", fmt(rmse(r.rawError), 4), "mm"],
      ["Corrected 3D RMSE", fmt(rmse(r.error), 6), "mm"],
    ]);
    charts.plot(
      "scene-errors",
      [
        {
          x: ["Raw with enclosure", "Corrected"],
          y: [rmse(r.rawError), rmse(r.error)],
          type: "bar",
          marker: { color: [charts.colors.coral, charts.colors.teal] },
        },
      ],
      {
        yaxis: { title: { text: "3D point RMSE (mm)" }, rangemode: "tozero" },
        xaxis: { title: { text: "Against corresponding refracted-hit truth" } },
      },
    );
  }
  charts
    .plot("scene3d", data, {
      scene: charts.sceneLayout("m"),
      margin: { l: 0, r: 0, t: 10, b: 0 },
      legend: { orientation: "h", x: 0, y: 1 },
    })
    .then(() => {
      $("scene3d").removeAllListeners("plotly_click");
      $("scene3d").on("plotly_click", (event) => {
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
$("scene-layer").onchange = drawScene;
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
    $("scene-mode").value = data.mode;
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
      raw_rmse_mm: rmse(sceneResult.rawError),
      corrected_rmse_mm: rmse(sceneResult.error),
      returns: sceneResult.truth.length,
      rejected: sceneResult.rejected,
      missed: sceneResult.missed,
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
if (!window.Plotly) {
  await new Promise((resolve) =>
    window.addEventListener("load", resolve, { once: true }),
  );
}
await tab(location.hash.slice(1) || "designer");
window.addEventListener("resize", () =>
  document
    .querySelectorAll("section:not([hidden]) .js-plotly-plot")
    .forEach((p) => window.Plotly.Plots.resize(p)),
);
