# Review of the existing work

Associated paper: Ranasinghe et al. (2026), [*Correcting time offsets and enclosure-induced measurement distortions in LiDAR–camera systems*](https://doi.org/10.1016/j.measurement.2026.122285), *Measurement* 285, 122285. This repository currently covers the spherical-dome refraction component and a 3D extension; paper-wide reproduction has not been established.

The paper-style angular lookup-table workflow is implemented for the spherical enclosure model, including dynamic generation, validation, bilinear lookup and point-cloud/Scene Lab comparison. Temporal calibration and camera intrinsic/extrinsic calibration remain outside this repository. Numbered equations and figures have not been mapped individually to the code. The baseline simulation uses a configurable 4 mm wall; the paper describes a 6 mm dome.

Inspected source files include `calculate_deflection.m`, `calculate_deflection2.m`, `dome_beam_refraction.py`, `sensitivity_analysis_our_method.py`, `simulate_1m_length_measurement.py`, the comparison scripts, and the embedded MATLAB source in `Correct_PCD.mlx`, `Correction_onePoint.mlx`, and `Create3D_Maketable.mlx`.

| Existing component | Behavior | New implementation |
|---|---|---|
| MATLAB deflection | 2D inner/outer intersections, two Snell refractions, unsigned angle | Vector sphere intersections and signed XZ output, including 90 degrees |
| Python dome trace | Robust 2D vector tracing with upper-circle restriction | Same physical method extended to batches of 3D rays |
| MATLAB PCD correction | Permutes axes, separately adjusts XZ/YZ using 90/107 degree thresholds, preserves radius | Explicit rotation, a single 3D ray, selectable range model |
| Sensitivity | Angle, geometry, index and projected-endpoint perturbations | CSV details, six disturbance groups, all three translation axes, PNG/PDF summaries |
| 1 m simulation | Reconstructs target endpoints using a known target Z plane | Synthetic cloud with simulated ranges, known correspondences, and correction errors |

Historical settings differ:

- Current Python baseline: inner radius 7.4 cm, thickness 0.4 cm, source (-2, 2.445) cm in the selected plane, wall index 1.52.
- Sensitivity baseline: same geometry, wall index 1.570.
- MATLAB deflection function: radius 7.65 cm, thickness 0.6 cm, wall index 1.52.
- MATLAB cloud correction: source (0, -1.615, 5.3) cm, enclosure axes `[sensor_y, sensor_z, sensor_x]`.
- The MATLAB table-generation notebook also contains plotting geometry that differs from its final table settings. A saved table cannot be assumed to describe every later experiment.

These are captured as separate JSON examples. None is assumed to be a measured calibration for new data.

The old comparison script labels a reference curve as COMSOL while generating it by calling `trace_dome_port_2d`. That is not an independent COMSOL simulation. Some comparisons deliberately set the Calibmar wall index to `ours.N_DOME - 0.2`. Those differences measure parameter mismatch as well as any model difference and cannot establish algorithm superiority. The new package does not repeat those labels or comparisons.

The folder also contains Palomer et al.'s *Underwater Laser Scanner: Ray-Based Model and Calibration* and a compact flat-viewport implementation. A flat port and a spherical dome have different geometry. The current work targets the spherical method; full camera/mirror calibration and triangulation from that paper are outside this implementation.

The old cloud correction catches failures into preallocated zero rows, which can look like real points. Here invalid rows have NaN XYZ and a reason code. The full 3D extension intentionally need not reproduce the legacy 90/107-degree heuristic point for point.

The new package has no runtime imports or file dependencies on these historical sources. Exact paper-equation mapping, all legacy robustness plots, external solver validation, measured performance studies and instrument calibration remain separate follow-up work.
