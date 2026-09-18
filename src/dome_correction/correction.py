"""Sensor-frame XYZ correction with explicit reported-range semantics."""
from dataclasses import dataclass
import numpy as np
from .model import Dome, trace_rays, vectors


@dataclass
class Correction:
    points: np.ndarray
    valid: np.ndarray
    status: np.ndarray


def rotation_matrix(value):
    matrix = np.asarray(value, float)
    if (matrix.shape != (3, 3) or not np.isfinite(matrix).all()
            or not np.allclose(matrix.T @ matrix, np.eye(3), atol=1e-9, rtol=0)
            or not np.isclose(np.linalg.det(matrix), 1, atol=1e-9, rtol=0)):
        raise ValueError("sensor_to_dome_rotation must be a proper orthonormal 3x3 rotation.")
    return matrix


def correct_points(points, dome=None, *, origin_m=(0, 0, 0),
                   sensor_to_dome_rotation=np.eye(3), range_model,
                   range_reference_index=None, chunk_size=100000):
    """Correct local sensor XYZ in metres, preserving row order and sensor frame.

    direction_only: preserves the measured radius (far-field approximation).
    geometric_path: measured radius = inside + wall + outside path length.
    optical_path: n_reference * radius = sum(n_i * path_length_i).
    The optical model assumes a reciprocal monostatic path and no range offset.
    """
    dome = Dome() if dome is None else dome
    raw = vectors(points, "points")
    rotation = rotation_matrix(sensor_to_dome_rotation)
    if range_model not in ("direction_only", "geometric_path", "optical_path"):
        raise ValueError("Select direction_only, geometric_path or optical_path.")
    if range_model == "optical_path":
        if (range_reference_index is None or not np.isfinite(range_reference_index)
                or range_reference_index <= 0):
            raise ValueError("optical_path requires a positive range_reference_index.")
    if not isinstance(chunk_size, int) or chunk_size <= 0:
        raise ValueError("chunk_size must be a positive integer.")
    # Validate geometry even for empty input.
    trace_rays(np.empty((0, 3)), origin_m, dome)
    result = np.full_like(raw, np.nan)
    valid = np.zeros(len(raw), bool)
    status = np.full(len(raw), "invalid_direction", dtype="U32")
    for start in range(0, len(raw), chunk_size):
        stop = min(start + chunk_size, len(raw))
        part = raw[start:stop]
        radius = np.linalg.norm(part, axis=1)
        trace = trace_rays(part @ rotation.T, origin_m, dome)
        ok = trace.valid.copy()
        reason = trace.status.copy()
        if range_model == "direction_only":
            local = radius[:, None] * trace.exit_direction
        else:
            if range_model == "geometric_path":
                remaining = radius - trace.inside_length_m - trace.wall_length_m
            else:
                remaining = (range_reference_index * radius
                             - dome.n_inside * trace.inside_length_m
                             - dome.n_wall * trace.wall_length_m) / dome.n_outside
            outside = remaining >= 0
            reason[ok & ~outside] = "range_before_outer_surface"
            ok &= outside
            local = trace.outer_hit + remaining[:, None] * trace.exit_direction - origin_m
        local[~ok] = np.nan
        result[start:stop] = local @ rotation
        valid[start:stop], status[start:stop] = ok, reason
    return Correction(result, valid, status)
