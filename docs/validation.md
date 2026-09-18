# Validation performed

Local environment: Python 3.10.14, NumPy 1.26.4, Matplotlib 3.7.0.

- The 23-test Python suite covers geometry, Snell invariants, limiting cases, frame transforms, optical reconstruction, rejection handling and CSV/ASCII PCD field preservation. It also checks malformed inputs, very small/large direction scales, thin walls, CLI units and overwrite protection, invalid sensitivity variations, and cross-language browser/Python parity on 300 random 3D rays and all three correction modes (requires Node.js).
- Compared 179 XZ rays (1–179 degrees) against the existing `dome_beam_refraction.py` using identical geometry. The maximum combined absolute difference over exit-direction components and outer-hit coordinates in centimetres was 2.67e-15. Five captured cases are permanent standalone regression tests.
- Generated and visually inspected all four baseline PNG figures. Matching vector PDF files and underlying CSV data are generated in the same run.
- Synthetic plane: 1,271 rays, plane z=5 m, baseline configuration, optical ranges referenced to index 1.000293. Raw 3D RMSE: 29.1529 mm; direction-only RMSE: 2.1350 mm; full optical correction: approximately 1e-12 mm (floating-point precision).

The synthetic forward model and inverse use the same geometry and ray tracer. These numbers demonstrate consistency, not independent physical validation, manuscript reproduction or real-cloud accuracy. The Snell and limiting-case tests provide additional independent constraints; external ray-tracing and measured-data comparisons remain future validation.

The [GitHub workflow passed on Python 3.10 and 3.12](https://github.com/maninka123/enclosure-aware-lidar-correction/actions/runs/35339077546) for commit `63ed02e`. It assumes this standalone folder is the repository root.

The browser app additionally has nine Node.js tests for the ray model, material presets, file handling and synthetic scene reconstruction. Six Playwright tests exercise desktop/mobile rendering, material edits, plane selection, interface zoom, expanded dialogs, correction and export, invalidation after parameter edits, scene edits, and independent sensor-station configurations, active-station authority over conflicting top-level scene fields, and persistence/scene import of named materials. Local screenshots of the designer, atlas, cloud view and scene lab were inspected. The Pages workflow runs the browser tests before deploying.

Use `requirements-tested.txt` on Python 3.10 to reproduce the tested direct dependency versions. CI tests this pinned baseline on Python 3.10 and the declared compatible dependency ranges on Python 3.12. JavaScript dependencies are pinned in `webapp/package-lock.json`; install with `npm ci`.

The rendering migration replaces Plotly with locally bundled Three.js and ECharts.
The browser suite additionally checks both engines, camera changes, wall-detail focus,
PNG file downloads, expanded views, scene picking and the model dialog. Numerical
regressions continue to run independently of the rendering engines.
