import { materials, indexFor } from "./materials.js";

const storageKey = "enclosure-lab-materials-v1";
const $ = (id) => document.getElementById(id);
const selectors = ["material", "inside-material", "outside-material"];
const inputs = ["nwall", "ninside", "noutside"];
Object.assign(materials, {
  air: {
    name: "Air · nominal 1.000293",
    n: 1.000293,
    note: "Air: nominal legacy value; actual index depends on wavelength, temperature, pressure and humidity.",
  },
  vacuum: { name: "Vacuum · 1", n: 1, note: "Vacuum: refractive index 1." },
  water: {
    name: "Water · nominal 1.333",
    n: 1.333,
    note: "Water: approximate visible-light index near 20 °C, not a calibrated LiDAR-wavelength value.",
    url: "https://iapws.org/public/documents/cMTlA/rindex.pdf",
  },
});
function validEntry(m) {
  return (
    m &&
    typeof m.id === "string" &&
    /^user_[a-zA-Z0-9-]+$/.test(m.id) &&
    typeof m.name === "string" &&
    m.name.trim().length > 0 &&
    m.name.length <= 60 &&
    Number.isFinite(m.n) &&
    m.n >= 0.1 &&
    m.n <= 10 &&
    typeof m.note === "string" &&
    m.note.length <= 200
  );
}
function entries() {
  return Object.entries(materials)
    .filter(([id]) => id.startsWith("user_"))
    .map(([id, m]) => ({ id, ...m }));
}
export function importMaterials(list = []) {
  if (!Array.isArray(list) || list.length > 100 || !list.every(validEntry))
    throw Error("Invalid saved material library.");
  for (const m of list)
    materials[m.id] = { name: m.name, n: m.n, note: m.note };
}
try {
  importMaterials(JSON.parse(localStorage.getItem(storageKey) || "[]"));
} catch {
  /* A malformed or unavailable local store must not stop ray tracing. */
}
export function populateMaterials() {
  for (const id of selectors) {
    const selected = $(id).value;
    $(id).replaceChildren(
      ...Object.entries(materials).map(([key, m]) => new Option(m.name, key)),
    );
    $(id).value = Object.hasOwn(materials, selected) ? selected : "custom";
  }
}
export function syncMedia() {
  for (let i = 1; i < 3; i++) {
    const current = $(selectors[i]).value;
    const n = Number($(inputs[i]).value);
    const key =
      indexFor(current, Number($("wavelength").value)) === n
        ? current
        : Object.keys(materials).find((k) => materials[k].n === n) || "custom";
    $(selectors[i]).value = key;
    $(inputs[i]).readOnly = key !== "custom";
  }
  $("medium-note").textContent = [1, 2]
    .map((i) => materials[$(selectors[i]).value].note)
    .filter((v, i, a) => v && a.indexOf(v) === i)
    .join(" ");
}
export function librarySettings() {
  return {
    inside: $("inside-material").value,
    outside: $("outside-material").value,
    library: entries(),
  };
}
export function restoreMedia(settings) {
  for (const [key, id] of [
    ["inside", "inside-material"],
    ["outside", "outside-material"],
  ]) {
    if (Object.hasOwn(materials, settings[key])) $(id).value = settings[key];
  }
  syncMedia();
}
export function setupLibrary(onChange) {
  populateMaterials();
  syncMedia();
  for (let i = 1; i < 3; i++)
    $(selectors[i]).onchange = () => {
      const n = indexFor($(selectors[i]).value, Number($("wavelength").value));
      if (n !== undefined) $(inputs[i]).value = n;
      $(inputs[i]).readOnly = $(selectors[i]).value !== "custom";
      $("medium-note").textContent = materials[$(selectors[i]).value].note;
      onChange();
    };
  $("wavelength").addEventListener("input", () => {
    for (let i = 1; i < 3; i++)
      if ($(selectors[i]).value === "bk7")
        $(selectors[i]).dispatchEvent(new Event("change"));
  });
  let target = "material";
  document.querySelectorAll("[data-add-material]").forEach(
    (b) =>
      (b.onclick = () => {
        target = b.dataset.addMaterial;
        $("material-form").reset();
        $("material-save-error").textContent = "";
        $("material-dialog").showModal();
        $("new-material-name").focus();
      }),
  );
  $("cancel-material").onclick = () => $("material-dialog").close();
  $("material-form").onsubmit = (e) => {
    e.preventDefault();
    try {
      const m = {
        id: `user_${crypto.randomUUID()}`,
        name: $("new-material-name").value.trim(),
        n: Number($("new-material-index").value),
        note: $("new-material-note").value.trim(),
      };
      if (!validEntry(m))
        throw Error("Enter a name and a finite index between 0.1 and 10.");
      if (
        Object.values(materials).some(
          (v) => v.name.toLowerCase() === m.name.toLowerCase(),
        )
      )
        throw Error("That name already exists. Choose a different name.");
      if (entries().length >= 100)
        throw Error("The library supports up to 100 custom materials.");
      localStorage.setItem(storageKey, JSON.stringify([...entries(), m]));
      importMaterials([m]);
      populateMaterials();
      $(target).value = m.id;
      $(target).dispatchEvent(new Event("change"));
      $("material-dialog").close();
    } catch (err) {
      $("material-save-error").textContent =
        `Could not save material: ${err.message}`;
    }
  };
}
