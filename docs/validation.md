# Validation performed

Local environment: Python 3.10.14, NumPy 1.26.4, Matplotlib 3.7.0.

- The 33-test Python suite covers geometry, Snell invariants, limiting cases, frame transforms, analytical and LUT correction, bilinear interpolation, invalid cells and domains, CLI workflows, LUT compatibility, attribute preservation and Python/JavaScript parity. The parity suite compares 300 analytical rays and a generated/interpolated LUT (requires Node.js).
- Compared 179 XZ rays (1–179 degrees) against the existing `dome_beam_refraction.py` using identical geometry. The maximum combined absolute difference over exit-direction components and outer-hit coordinates in centimetres was 2.67e-15. Five captured cases are permanent standalone regression tests.
- Generated and visually inspected all four baseline PNG figures. Matching vector PDF files and underlying CSV data are generated in the same run.
- Synthetic plane: 1,271 rays, plane z=5 m, baseline configuration, optical ranges referenced to index 1.000293. Raw 3D RMSE: 29.1529 mm; direction-only RMSE: 2.1350 mm; full optical correction: approximately 1e-12 mm (floating-point precision).

The synthetic forward model and inverse use the same geometry and ray tracer. These numbers demonstrate consistency, not independent physical validation, manuscript reproduction or real-cloud accuracy. The Snell and limiting-case tests provide additional independent constraints; external ray-tracing and measured-data comparisons remain future validation.

The [GitHub workflow passed on Python 3.10 and 3.12](https://github.com/maninka123/enclosure-aware-lidar-correction/actions/runs/35339077546) for commit `63ed02e`. It assumes this standalone folder is the repository root.

The browser app has 14 Node.js tests for analytical physics, LUT angle round trips, full-domain inspection deltas, interpolation, compatibility, file handling, scene reconstruction and finer-LUT convergence in Scene Lab. Eight Playwright workflows exercise desktop/mobile rendering, material selectors, positive-Z projections, correction/export invalidation, scene editing, renderer controls, dynamic LUT generation, LUT heatmaps, cloud comparison, a 150,000-point Compare Both regression, Scene Lab LUT metrics and stale-table detection. The Pages workflow runs these checks before deployment.

Use `requirements-tested.txt` on Python 3.10 to reproduce the tested direct dependency versions. CI tests this pinned baseline on Python 3.10 and the declared compatible dependency ranges on Python 3.12. JavaScript dependencies are pinned in `webapp/package-lock.json`; install with `npm ci`.

The rendering migration replaces Plotly with locally bundled Three.js and ECharts.
The browser suite additionally checks both engines, camera changes, wall-detail focus,
PNG file downloads, expanded views, scene picking and the model dialog. Numerical
regressions continue to run independently of the rendering engines.
