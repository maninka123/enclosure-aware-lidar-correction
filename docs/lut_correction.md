# Angular LUT correction

The lookup table is generated from the repository's analytical two-interface spherical ray tracer. It is configuration-specific and contains no hard-coded correction values.

## Coordinates and representation

All table directions are in the local sensor frame, where +Z is forward. The paper-style plane coordinates are

```text
theta_xz = degrees(atan2(z, x))
theta_yz = degrees(atan2(z, y))
```

Each axis runs from 0° to 180°: 0° is its positive lateral axis, 90° is sensor +Z, and 180° is its negative lateral axis. `atan2` preserves quadrants. The implementation provides tested `direction_to_angles` / `directionToAngles` and inverse functions. Internally each valid table node stores the analytical exit unit vector as XYZ. Delta XZ and YZ angles are also stored for inspection and export. Interpolating vectors avoids the discontinuities and ambiguity that arise from treating the two planar angles as independent Euler rotations.

## Generation and validation

The user selects XZ/YZ limits and a resolution. The default resolution is 0.1°, but no accuracy claim is attached to that value. Each grid direction is transformed by the configured sensor-to-enclosure rotation, traced through the inner and outer surfaces, and transformed back to the sensor frame. Invalid aperture, intersection and total-internal-reflection results remain invalid cells.

Validation evaluates deterministic cell midpoints, which are separate from the table nodes. It compares bilinearly interpolated LUT directions with direct analytical `direction_only` traces and reports mean, RMS, P95 and maximum angular error. Equivalent RMS endpoint differences are reported at 1, 5 and 10 metres. The UI also shows an interpolation-error heatmap. Finer resolution increases generation time and memory; validation results should guide the selection.

## Runtime lookup

For a raw sensor point `p`, runtime correction computes `r = norm(p)` and `d = p/r`, maps `d` to XZ/YZ coordinates, and identifies four neighbouring nodes. The exit vectors are bilinearly weighted and normalized. No extrapolation is performed, and a result is rejected if any neighbour is invalid. The paper-style output is

```text
p_lut = r * d_lut
```

so the original measured radius is preserved. Analytical `direction_only` is the equivalent reference for LUT interpolation error. A comparison with analytical `geometric_path` or `optical_path` is labelled **method difference**, because those models also reconstruct range and exit-point displacement.

## Configuration identity and caching

The table hash includes inner radius, wall thickness, dome centre, source origin, sensor rotation, all three refractive indices, aperture mode, angular bounds, resolution and interpolation type. Browser generation reuses a cached table only when this hash matches. Any relevant control change marks the current table stale; stale or incompatible tables cannot be applied. Python and JavaScript use the same canonical numeric signature, and parity tests compare hashes, nodes and interpolated outputs.

## Import and export

Browser and Python exports use the versioned JSON schema `enclosure-aware-lidar-lut` version `2.0`. The file records the configuration and hash, settings, coordinate convention, generation timestamp, arrays, statuses and validation metrics. Import recalculates the current configuration and LUT signatures before accepting a file. Version 2.0 makes the 0°–180° paper convention explicit, so tables exported with the earlier signed convention are rejected rather than misapplied.

Python example:

```bash
dome-correct generate-lut --config configs/baseline.json --resolution-deg 0.1 --output outputs/baseline_lut
dome-correct correct data/raw/scan.pcd --config configs/baseline.json --method lut --lut outputs/baseline_lut/lut.json --input-unit m --output outputs/scan_lut_corrected.pcd
```

The browser's Point Clouds workspace offers Analytical, LUT and Compare both. For clouds without a reference, it reports correction magnitude and analytical/LUT method differences rather than accuracy. Scene Lab has simulated refracted-hit truth and therefore reports separate ground-truth errors for Raw, Analytical and LUT reconstructions. Near-zero analytical error there is an exact-model consistency result, not measured real-world accuracy.

## Limitations

The LUT covers only its configured angular domain. It does not model temporal calibration, sensor firmware bias, camera calibration, nonconcentric surfaces, scattering, absorption, finite beam width or multipath. Its angular correction preserves range; it is not a replacement for a justified optical-path endpoint model when that range convention is known.
