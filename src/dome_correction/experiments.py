"""Deterministic experiments; PNG/PDF figures and underlying CSV tables."""
from dataclasses import replace
from pathlib import Path
import csv
import json
import platform
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from .model import trace_rays, xz_directions, angle_between_deg
from .correction import correct_points
from .config import config_dict


def write_table(path, names, rows):
    with Path(path).open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(names)
        writer.writerows(rows)


def save_figure(fig, folder, name):
    for suffix in ("png", "pdf"):
        fig.savefig(folder / f"{name}.{suffix}", dpi=180, bbox_inches="tight")
    plt.close(fig)


def run_experiments(output, dome, origin, rotation):
    root = Path(output)
    root.mkdir(parents=True, exist_ok=False)
    figures, tables, clouds = [root / name for name in ("figures", "tables", "pointclouds")]
    for folder in (figures, tables, clouds):
        folder.mkdir()
    plt.rcParams.update({"axes.spines.top": False, "axes.spines.right": False,
                         "axes.grid": True, "grid.alpha": 0.22, "font.size": 10})
    origin = np.asarray(origin, float)
    angles = np.linspace(50, 130, 81)
    directions = xz_directions(angles)
    baseline = trace_rays(directions, origin, dome)
    if not baseline.valid.all():
        raise ValueError("Experiment requires all XZ rays in 50..130 degrees to exit the dome.")
    signed = np.rad2deg(np.arctan2(baseline.exit_direction[:, 2], baseline.exit_direction[:, 0])) - angles
    write_table(tables / "deflection.csv", ["input_deg", "signed_deflection_deg", "total_deflection_deg"],
                zip(angles, signed, angle_between_deg(directions, baseline.exit_direction)))
    fig, ax = plt.subplots(figsize=(7, 4), layout="constrained")
    ax.plot(angles, signed)
    ax.set(xlabel="Input angle from +X towards +Z (deg)", ylabel="Signed exit deflection (deg)",
           title="Spherical dome: XZ angle sweep")
    save_figure(fig, figures, "01_deflection")

    fig, ax = plt.subplots(figsize=(7, 5), layout="constrained")
    theta = np.linspace(0, np.pi if dome.upper_only else 2*np.pi, 400)
    for radius in (dome.inner_radius_m, dome.inner_radius_m+dome.thickness_m):
        ax.plot((dome.center_m[0]+radius*np.cos(theta))*100,
                (dome.center_m[2]+radius*np.sin(theta))*100, color="0.4")
    for i in (0, 40, 80):
        chain = np.array([origin, baseline.inner_hit[i], baseline.outer_hit[i],
                          baseline.outer_hit[i] + 0.08*baseline.exit_direction[i]])
        ax.plot(chain[:, 0]*100, chain[:, 2]*100, label=f"{angles[i]:.0f} deg")
    ax.set(xlabel="Enclosure X (cm)", ylabel="Enclosure Z (cm)", title="Ray paths (XZ projection)")
    ax.set_aspect("equal")
    ax.legend()
    save_figure(fig, figures, "02_ray_paths")

    sensitivity(tables, figures, angles, directions, baseline, dome, origin)
    metrics = synthetic_plane(clouds, tables, figures, dome, origin, rotation)
    manifest = {"config": config_dict(dome, origin, rotation), "package_version": "0.1.0",
                "python": platform.python_version(), "numpy": np.__version__,
                "matplotlib": matplotlib.__version__, "synthetic_plane": metrics,
                "interpretation": "Synthetic model consistency only; not measured accuracy or paper figure reproduction."}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, allow_nan=False), encoding="utf-8")
    return manifest


def sensitivity(tables, figures, angles, directions, baseline, dome, origin):
    variants = []
    for group, key, deltas in [
        ("Thickness", "thickness_m", [-.001, -.0005, .0005, .001]),
        ("Radius", "inner_radius_m", [-.002, -.001, .001, .002]),
        ("Wall index", "n_wall", [-.01, -.005, 0, .005, .01])]:
        for delta in deltas:
            variants.append((group, f"{key} {delta:+g}", replace(dome, **{key: getattr(dome, key)+delta}), origin, directions))
    for group, deltas in [("Centre", [-.002, -.001, .001, .002]),
                          ("LiDAR position", [-.005, -.002, -.001, .001, .002, .005])]:
        for axis in range(3):
            for delta in deltas:
                offset = np.eye(3)[axis]*delta
                d = replace(dome, center_m=tuple(np.asarray(dome.center_m)+offset)) if group == "Centre" else dome
                o = origin+offset if group == "LiDAR position" else origin
                variants.append((group, f"{'xyz'[axis]} {delta*1000:+g} mm", d, o, directions))
    for delta in [-1, -.5, -.25, .25, .5, 1]:
        variants.append(("Rotation in XZ", f"{delta:+g} deg", dome, origin, xz_directions(angles+delta)))
    base_points = baseline.outer_hit + 5*baseline.exit_direction
    # Same approximate 1 m pair metric as the old script: 0.9..1.1 m, normalized to 1 m.
    ii, jj = np.triu_indices(len(angles), 1)
    distances = np.linalg.norm(base_points[ii]-base_points[jj], axis=1)
    select = abs(distances-1) <= .1
    ii, jj, distances = ii[select], jj[select], distances[select]
    detail, summaries = [], []
    for group, label, d, o, directions_variant in variants:
        trace = trace_rays(directions_variant, o, d)
        points = trace.outer_hit + 5*trace.exit_direction
        error = np.linalg.norm(points-base_points, axis=1)*1000
        angular = angle_between_deg(trace.exit_direction, baseline.exit_direction)
        valid = trace.valid & baseline.valid
        length_errors = abs(np.linalg.norm(points[ii]-points[jj], axis=1)-distances)/distances*1000
        length_errors = length_errors[np.isfinite(length_errors)]
        summaries.append([group, label, int(valid.sum()), float(np.max(error[valid])) if valid.any() else None,
                          float(np.max(angular[valid])) if valid.any() else None,
                          float(np.max(length_errors)) if len(length_errors) else None])
        detail.extend(zip([group]*len(angles), [label]*len(angles), angles, angular, error, trace.status))
    write_table(tables / "sensitivity_detail.csv", ["group", "variation", "angle_deg", "angular_error_deg", "endpoint_error_5m_mm", "status"], detail)
    write_table(tables / "sensitivity_summary.csv", ["group", "variation", "valid_rays", "max_endpoint_error_5m_mm", "max_angular_error_deg", "max_normalized_1m_length_error_mm"], summaries)
    groups = list(dict.fromkeys(row[0] for row in summaries))
    maxima = [max(row[3] for row in summaries if row[0] == group and row[3] is not None) for group in groups]
    fig, ax = plt.subplots(figsize=(8, 4), layout="constrained")
    ax.barh(groups, maxima, color="#397fa3")
    ax.set(xlabel="Maximum endpoint displacement (mm)", title="Sensitivity at 5 m beyond the outer surface")
    save_figure(fig, figures, "03_sensitivity")


def synthetic_plane(clouds, tables, figures, dome, origin, rotation):
    x, y = np.meshgrid(np.linspace(-.5, .5, 41), np.linspace(-.3, .3, 31))
    directions = np.column_stack((x.ravel(), y.ravel(), np.ones(x.size)))
    directions /= np.linalg.norm(directions, axis=1)[:, None]
    trace = trace_rays(directions, origin, dome)
    plane_z = 5.0
    outside = (plane_z-trace.outer_hit[:, 2])/trace.exit_direction[:, 2]
    valid = trace.valid & (outside > 0)
    if not valid.all():
        raise ValueError("Synthetic plane requires all rays to reach z=5 m.")
    truth_dome = trace.outer_hit + outside[:, None]*trace.exit_direction
    reference_index = dome.n_inside
    measured = (dome.n_inside*trace.inside_length_m + dome.n_wall*trace.wall_length_m
                + dome.n_outside*outside)/reference_index
    raw = (directions * measured[:, None]) @ rotation
    truth = (truth_dome-origin) @ rotation
    exact = correct_points(raw, dome, origin_m=origin, sensor_to_dome_rotation=rotation,
                           range_model="optical_path", range_reference_index=reference_index)
    angular = correct_points(raw, dome, origin_m=origin, sensor_to_dome_rotation=rotation,
                             range_model="direction_only")
    metrics = {}
    for name, points in [("raw", raw), ("direction_only", angular.points), ("optical_path", exact.points), ("truth", truth)]:
        write_table(clouds / f"synthetic_{name}.csv", ["x", "y", "z"], points)
        errors = np.linalg.norm(points-truth, axis=1)*1000
        metrics[name] = {"rmse_mm": float(np.sqrt(np.mean(errors**2))), "max_error_mm": float(errors.max())}
    write_table(tables / "synthetic_metrics.csv", ["method", "rmse_mm", "max_error_mm"],
                [(name, value["rmse_mm"], value["max_error_mm"]) for name, value in metrics.items()])
    fig, axes = plt.subplots(1, 2, figsize=(11, 4), layout="constrained")
    for name, points in [("Raw", raw), ("Direction only", angular.points), ("Optical path", exact.points)]:
        transformed = points @ rotation.T + origin
        axes[0].scatter(transformed[:, 0], (transformed[:, 2]-plane_z)*1000, s=3, label=name)
    axes[0].set(xlabel="Enclosure X (m)", ylabel="Residual from true z=5 m plane (mm)", title="Synthetic plane correction")
    axes[0].legend(markerscale=3)
    names = ["raw", "direction_only", "optical_path"]
    axes[1].bar(["Raw", "Direction only", "Optical path"], [metrics[name]["rmse_mm"] for name in names])
    axes[1].set(ylabel="3D point RMSE (mm)", title="Known synthetic correspondences")
    save_figure(fig, figures, "04_synthetic_plane")
    return metrics
