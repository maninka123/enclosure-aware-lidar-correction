# Enclosure-aware LiDAR correction

[![Paper DOI](https://img.shields.io/badge/DOI-10.1016%2Fj.measurement.2026.122285-blue)](https://doi.org/10.1016/j.measurement.2026.122285)
[![Cite this work](https://img.shields.io/badge/Cite-this%20work-green)](#citation)
[![Open web app](https://img.shields.io/badge/Web_app-Enclosure_Lab-087f83)](https://maninka123.github.io/enclosure-aware-lidar-correction/)

A standalone Python and browser implementation of two spherical-enclosure correction paths: analytical two-interface ray tracing and a dynamically generated angular lookup table (LUT) with bilinear interpolation. It extends the original 2D experiments to 3D, reproducible synthetic scenes, and attribute-preserving point-cloud correction.

This repository accompanies the enclosure-refraction topic in [Ranasinghe et al. (2026), *Correcting time offsets and enclosure-induced measurement distortions in LiDAR–camera systems*](https://doi.org/10.1016/j.measurement.2026.122285), published in **Measurement, Volume 285, Article 122285**.

**Scope:** 3D spherical-dome refraction correction and synthetic validation. See [implementation coverage](docs/codebase_review.md) for the relationship to the paper.

## Interactive app

**[Launch Enclosure Lab →](https://maninka123.github.io/enclosure-aware-lidar-correction/)**

Design a dome, position and rotate the LiDAR, inspect compact positive-Z ray projections, and explore XY/XZ/YZ deflection curves. Point Clouds and Scene Lab compare analytical and LUT correction, measured runtimes, validation maps, and method differences. Equations and assumptions are available from the header dialog. Configurations, LUTs, plots, point clouds and reports can be downloaded.

The app runs entirely in your browser. Uploaded clouds stay on your device. See the [web app guide](webapp/README.md) for supported formats, material sources, scene assumptions and local development.

## Install and run

Use this folder as the repository root. Python 3.10 or newer is required; MATLAB, Calibmar, and sibling project directories are not required.

```powershell
git clone https://github.com/maninka123/enclosure-aware-lidar-correction.git
cd enclosure-aware-lidar-correction
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e .
python -m unittest discover -s tests -v
python -m dome_correction experiments --config configs/baseline.json --output outputs/my_first_run
```

On Linux/macOS activate with `source .venv/bin/activate`. The installed `dome-correct` command is equivalent to `python -m dome_correction`.

Each experiment writes:

- `figures/01_deflection`, `02_ray_paths`, `03_sensitivity`, `04_synthetic_plane` as PNG and PDF.
- `tables/`: underlying angle sweep, sensitivity details/summary, and synthetic error metrics as CSV.
- `pointclouds/`: synthetic raw, ground-truth, direction-only, and optical-path corrected XYZ CSVs.
- `manifest.json`: configuration, software versions, assumptions, and error metrics.

Output directories must be new, preventing accidental replacement of earlier runs. Use `configs/sensitivity.json` for the original sensitivity script's index of 1.570; `baseline.json` uses 1.52. Experiments use enclosure-frame rays, independent of the sensor rotation; synthetic clouds are exported in sensor coordinates.

The baseline and sensitivity examples use a 4 mm wall. The historical point-cloud configuration uses 6 mm, matching the paper's stated wall thickness; its remaining parameters still require validation for your capture.

## Correct a point cloud

Input must contain local, uncorrected sensor-frame XYZ, with its origin at the beam source. Supported formats are CSV with scalar `x,y,z` columns, and ASCII PCD. Other columns (e.g. intensity, timestamps, ring) are preserved as text. Binary/compressed PCD, PLY, LAS/LAZ and registered multi-view maps are not supported in this release.

```powershell
python -m dome_correction correct outputs/my_first_run/pointclouds/synthetic_raw.csv --config configs/baseline.json --input-unit m --range-model optical_path --range-reference-index 1.000293 --output outputs/synthetic_corrected.csv
```

For a real cloud, first measure geometry and verify the sensor axes and range convention. `configs/legacy_pointcloud.json` records the older MATLAB settings and axis permutation; it is an example, not a calibrated configuration for an unspecified capture.

```powershell
python -m dome_correction correct data/raw/scan.pcd --config configs/legacy_pointcloud.json --input-unit m --range-model direction_only --output outputs/scan_corrected.pcd
```

Choose the range model explicitly:

| Model | Meaning | Limitation |
|---|---|---|
| `direction_only` | Keep measured radius, replace beam direction | Far-field approximation; ignores exit-point displacement and optical delay |
| `geometric_path` | Radius is total geometric length through all three media | Only valid if this is how the supplied ranges were produced |
| `optical_path` | Reference index × measured radius is the one-way optical path length | Requires known range convention, reciprocal path, and appropriate indices; no instrument bias model |

Output XYZ uses the input's units and sensor frame. Invalid rows retain their positions in the table, receive NaN XYZ, and appear in a `.status.csv` sidecar. A `.report.json` records the settings and status counts. The input is never modified. Ray calculations are chunked; file parsing currently loads the complete cloud in memory.

### Use LUT correction

Set the LUT bounds in the configuration, generate the table once, then use that same configuration and table for correction. XZ and YZ are sensor-frame plane angles: 0° is +X/+Y, 90° is forward (+Z), and 180° is −X/−Y.

```powershell
dome-correct generate-lut --config configs/baseline.json --resolution-deg 0.1 --output outputs/baseline_lut
dome-correct correct data/raw/scan.pcd --config configs/baseline.json --method lut --lut outputs/baseline_lut/lut.json --input-unit m --output outputs/scan_lut_corrected.pcd
```

Use `--xz-min-deg`, `--xz-max-deg`, `--yz-min-deg`, and `--yz-max-deg` with `generate-lut` to override the configured domain. Check `validation.json` before using the table. LUT correction uses bilinear interpolation and preserves measured range; incompatible configurations and out-of-domain points are rejected. See [LUT correction](docs/lut_correction.md) for the scientific details.

## Python API

```python
import numpy as np
from dome_correction import Dome, LUTSettings, generate_lut, correct_points_lut

dome = Dome(inner_radius_m=0.074, thickness_m=0.004)
settings = LUTSettings(resolution_deg=0.25, xz_min_deg=55, xz_max_deg=125,
                       yz_min_deg=55, yz_max_deg=125)
lut = generate_lut(dome, origin_m=(-0.02, 0., 0.02445), settings=settings)
result = correct_points_lut(np.array([[0., 0., 5.]]), lut, dome=dome,
                            origin_m=(-0.02, 0., 0.02445))
```

All internal distances are metres. Rotation maps sensor vectors into enclosure coordinates. The dome's upper hemisphere is defined by `z >= center_z`. See [the model](docs/model.md) and [real-data validation plan](docs/real_pointclouds.md).

## Repository layout

```text
src/dome_correction/   physics, configuration, I/O, correction, experiments, CLI
webapp/               interactive browser app, scene lab and browser tests
configs/              explicit baseline and historical configurations
tests/                physical invariants, reconstruction and I/O checks
docs/                 derivation, codebase review and validation plan
data/raw/             local captures (ignored by Git)
outputs/              generated runs (ignored by Git)
.github/workflows/    installation, tests and experiment smoke run
```

Tests verify spherical intersections, Snell's law, centered and homogeneous limits, transformed-frame reconstruction, LUT nodes and interpolation, cache invalidation, Python/JavaScript parity, invalid rays, total internal reflection and attribute preservation. Synthetic reconstruction is a model-consistency check, not evidence of measured accuracy. No external COMSOL results or claims of one method outperforming the other are included.

Generated data, environment files, and private captures are ignored by Git. No third-party repository or paper PDF is bundled.

## Citation

If you use this work in your research, please cite the associated paper:

> Pasindu Ranasinghe, Dibyayan Patra, Amantha Mawathage, Bikram Banerjee, Chenxi Ye, Bingfei Nan, and Simit Raval (2026). **Correcting time offsets and enclosure-induced measurement distortions in LiDAR–camera systems.** *Measurement*, **285**, 122285. https://doi.org/10.1016/j.measurement.2026.122285

[Read the paper on ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0263224126019949) · [DOI](https://doi.org/10.1016/j.measurement.2026.122285) · [Citation metadata](CITATION.cff)

```bibtex
@article{ranasinghe2026enclosure,
  author  = {Ranasinghe, Pasindu and Patra, Dibyayan and Mawathage, Amantha
             and Banerjee, Bikram and Ye, Chenxi and Nan, Bingfei and Raval, Simit},
  title   = {Correcting time offsets and enclosure-induced measurement
             distortions in {LiDAR}–camera systems},
  journal = {Measurement},
  volume  = {285},
  pages   = {122285},
  year    = {2026},
  doi     = {10.1016/j.measurement.2026.122285},
  url     = {https://www.sciencedirect.com/science/article/pii/S0263224126019949}
}
```

The root `CITATION.cff` provides the paper as the preferred citation through GitHub's **Cite this repository** menu. To make computational results reproducible, also record the repository commit and configuration used.

## License

The repository software is available under the [MIT License](LICENSE). Third-party
libraries retain their own licenses; the associated paper is not relicensed by this repository.

## Tested environment

For the tested Python 3.10 baseline, install `python -m pip install -r requirements-tested.txt`
followed by `python -m pip install -e .`. This pins the two direct scientific dependencies;
it is not a complete environment lock. General installations use the compatible ranges
in `pyproject.toml`. For the browser app, use Node.js 20 and `npm ci` inside `webapp`
to install the committed dependency lock. See [validation](docs/validation.md).
