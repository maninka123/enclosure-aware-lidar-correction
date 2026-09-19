# Enclosure Lab web app

**[Open the app](https://maninka123.github.io/enclosure-aware-lidar-correction/)**

A static browser application for the same concentric spherical-shell model as the Python package. No server processes your clouds. Three.js and Apache ECharts are bundled locally; the deployed app has no runtime CDN or analytics dependency. Source links open external sites only when selected.

## Workspaces

| Workspace | Features |
|---|---|
| Enclosure & beam | Geometry and materials, selected-beam controls, true 3D surface angles, projected paths, interface zoom, source axes, forward direction and comparison curves |
| Deflection atlas | Selectable XY/XZ/YZ sweeps in the designer, 0–180° or 0–360° ranges, full-sphere direction colours and azimuth/polar heatmap |
| Scene lab | Clickable 3D overlay layers; raw, analytical and LUT endpoint/angular errors against synthetic truth; editable targets; up to eight sensor stations; JSON scene import/export |
| Point clouds | Analytical/LUT/both correction, dynamic LUT validation and import/export, selectable overlays and difference maps, measured performance, attribute-preserving CSV/PCD output |


The header **Model & assumptions** button opens equations, coordinate conventions, material sources, paper citation and the simplified-model scope in a dialog.

Scene Lab and Point Clouds provide the same LUT workflow: generate with progress, save the versioned JSON, or load a compatible LUT created earlier. Imported tables are checked against the current enclosure configuration before use.

The browser's normal LUT workflow covers the complete 0°–180° XZ and YZ domains and asks only for angular resolution. **Advanced domain** exposes custom limits when a known sensor field of view should use a smaller table. Analytical correction offers direction-only, geometric-path and optical-path range interpretations in both Point Clouds and Scene Lab; optical path is the default for ToF data, while direction only is the paper-style LUT reference. The exported report records the selected model.

Use **Save PNG** in a view for image export. Plots support orbit/pan/zoom; each relevant card has an expanded dialog. The designer exports curve CSVs, the atlas exports map CSVs, and scene/point-cloud workspaces export clouds and reports. Config JSON is compatible with the Python CLI. Scene JSON is a separate app format containing objects and sensor stations, not a general 3D mesh format.

## Local development

Node.js 20+:

```sh
cd webapp
npm ci
npm test
npm run build
npm start
```

Open `http://127.0.0.1:4173`. Re-run the build after source edits. For browser checks:

```sh
npx playwright install chromium
npm run test:browser
```

The app source is in `src/`; the build writes only to `dist/`, which is ignored by Git. GitHub Actions tests the app and deploys the static build to Pages. Third-party licenses and notices for Three.js, Apache ECharts and zrender are included under `dist/vendor/`; the repository software has its own MIT license.

## Data and coordinate conventions

- Controls use mm for enclosure geometry, degrees for angles, and metres for scene positions. All numerical tracing uses metres.
- Sensor +Z is forward. Active right-handed rotations use `Rz(yaw) Ry(pitch) Rx(roll)`. Imported Python matrices are converted to equivalent Euler angles for editing.
- Selected-beam and LUT angles use `theta_xz = atan2(Z,X)` and `theta_yz = atan2(Z,Y)` in the sensor frame. Both run from 0° to 180°, with 90° pointing straight along sensor +Z. The app bilinearly interpolates valid exit vectors and normalizes the result.
- Planar curves report the full 3D angle between incident and exit directions, not an independent two-dimensional approximation. The frame selector determines whether the input plane uses enclosure or sensor axes.
- The upper-shell aperture is measured relative to the dome centre Z. Invalid directions and total internal reflection produce gaps, not interpolated corrections.
- Clouds must be original, local sensor-frame XYZ. A registered map needs per-acquisition pose handling outside this app. CSV fields are named `x,y,z`; additional columns are retained in CSV output.
- ASCII PCD input preserves fields, counts, row order and viewpoint metadata. XYZ is written as 64-bit floating point. Binary/compressed PCD and PLY/LAS are not supported. CSV-to-PCD output is explicitly XYZ-only; CSV is the attribute-preserving export for CSV input.
- Browser limits: 80 MB input, 500,000 points and four million LUT nodes. Heavy correction, simulation, generation and validation run in workers. The display samples at most 20,000 points; metrics use all valid rows. Invalid rows are NaN and identified in the JSON report. Use Python for larger inputs.
- Edits invalidate prior exports until recomputed. Settings and clouds are not persisted automatically or sent to a server; save config/scene/report files to retain your work.

## Scene interpretation

The selected station emits an ideal rectangular angular sampling grid. The scene returns the closest positive intersection with an opaque primitive. Rotations apply to boxes and planes; spheres use the X size as radius. Targets have no simulated reflectance, noise, transparency or multipath.

No-enclosure points use straight rays. The enclosure changes the actual hit locations as well as the measured coordinates, so those two clouds are not generally pointwise correspondences. Raw and corrected errors are measured against the same **refracted-hit truth**. Optical-path correction uses the same forward model and parameters, so its near-zero error is a consistency check. Direction-only and geometric-path results intentionally differ because they interpret the reported range differently.

Each station retains its own enclosure configuration and world pose. Only the selected station is simulated/exported at a time; inactive station markers remain visible. Scene clouds are exported in world metres unless the sensor-frame option is chosen. Use the raw sensor-frame export as an input to the correction workspace.

## Material sources

The app includes three sourced wall presets and a custom index:

- **Polycarbonate:** nominal 1.586, [Covestro Makrolon 3107, ISO 489](https://solutions.covestro.com/en/products/makrolon/makrolon-3107_000000000057534595).
- **PMMA:** nominal 1.49 at 23 °C, [PLEXIGLAS film technical information](https://www.plexiglas.de/files/plexiglas-content/pdf/239-35-EN-PLEXIGLAS-Films-microfluidic-applications.pdf).
- **N-BK7:** [SCHOTT manufacturer's datasheet, mirrored by Caltech](https://labcit.ligo.caltech.edu/~gari/LIGOII/BK7datasheet.pdf). Sellmeier coefficients are used with wavelength in micrometres; the UI permits 400–1550 nm. Check temperature and material batch for precision work.

Polymer presets are not extrapolated to infrared wavelengths. The wavelength control updates N-BK7 only. A nominal material value is not a calibrated index for a particular protective dome. Air starts from the Python legacy constant 1.000293, and both inside/outside indices are editable.

The optical range approximation uses the same configured index for ray bending and timing. Phase and group indices can differ; instrument range offsets, firmware compensation, wavelength and temperature require independent characterization. Material selection here is optical exploration, not a mechanical or safety qualification.

### Named materials

Select the inside medium, outside medium and dome material independently. Air, vacuum,
water and the existing dome materials include preset indices; nominal values are not
calibrated for every wavelength or operating condition. Select Custom for direct entry,
or choose **Add dome material…** or **Add medium…** inside the relevant selector to save a name, phase index and optional measurement notes.
The shared library is stored locally in this browser (up to 100 entries). Scene JSON
includes the library and selections for use on another computer; Python configuration
JSON retains the numerical indices. Browser storage failures are reported before saving.

### Interface design

UI changes follow [Emil Kowalski's Apple Design skill](https://github.com/emilkowalski/skills/tree/main/skills/apple-design): system typography, clear hierarchy, immediate press feedback, restrained translucent navigation, accessible focus states and reduced-motion/transparency preferences. Keep the desktop designer split equally between the 3D enclosure and the two ray projections. Scientific plot colours distinguish beam segments independently of interface styling.

For scene JSON with a `stations` array, `stations[active_station]` is authoritative
for geometry, pose and material metadata. Top-level copies are ignored on import.
Legacy scenes without stations continue to use top-level values. Exports synchronize
both representations with the current controls.

## Rendering and navigation

Three.js renders the transparent dome, ray paths, sensor axes, point clouds and scene
objects. Drag to orbit, right-drag to pan, and scroll/pinch to zoom. Top/Side buttons
provide fixed views; Reset view fits the geometry. A focused 3D canvas also accepts
arrow keys to orbit, +/- to zoom and 0 to reset. Hover reveals coordinates and colour
values; Scene Lab's click mode can place the enclosure frame or selected object.

ECharts renders the planar paths, unsmoothed deflection curves, heatmap, histogram
and error bars. Scroll to zoom, drag to pan, and use Wall detail to focus on an
interface. Planar geometry retains equal axis scale. Invalid-ray gaps stay empty.
Expand and Save PNG work in both engines. Geometry/ray tracing and exported point
clouds use the unchanged numerical model. WebGL 2 is required for the 3D views.
