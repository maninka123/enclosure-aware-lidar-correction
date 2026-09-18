# Validation performed

Local environment: Python 3.10.14, NumPy 1.26.4, Matplotlib 3.7.0.

- Unit tests cover geometry, Snell invariants, limiting cases, frame transforms, optical reconstruction, rejection handling and CSV/ASCII PCD field preservation.
- Compared 179 XZ rays (1–179 degrees) against the existing `dome_beam_refraction.py` using identical geometry. The maximum combined absolute difference over exit-direction components and outer-hit coordinates in centimetres was 2.67e-15. Five captured cases are permanent standalone regression tests.
- Generated and visually inspected all four baseline PNG figures. Matching vector PDF files and underlying CSV data are generated in the same run.
- Synthetic plane: 1,271 rays, plane z=5 m, baseline configuration, optical ranges referenced to index 1.000293. Raw 3D RMSE: 29.1529 mm; direction-only RMSE: 2.1350 mm; full optical correction: approximately 1e-12 mm (floating-point precision).

The synthetic forward model and inverse use the same geometry and ray tracer. These numbers demonstrate consistency, not independent physical validation, manuscript reproduction or real-cloud accuracy. The Snell and limiting-case tests provide additional independent constraints; external ray-tracing and measured-data comparisons remain future validation.

The GitHub workflow is supplied but has not been executed on GitHub. It assumes this standalone folder is the repository root.
