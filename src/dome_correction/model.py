"""Vector Snell refraction through two concentric spherical surfaces."""
from dataclasses import dataclass
import numpy as np


@dataclass(frozen=True)
class Dome:
    inner_radius_m: float = 0.074
    thickness_m: float = 0.004
    center_m: tuple = (0.0, 0.0, 0.0)
    n_inside: float = 1.000293
    n_wall: float = 1.52
    n_outside: float = 1.000293
    upper_only: bool = True

    def __post_init__(self):
        values = np.asarray([self.inner_radius_m, self.thickness_m,
                             self.n_inside, self.n_wall, self.n_outside], float)
        if not np.all(np.isfinite(values)) or np.any(values <= 0):
            raise ValueError("Radii, thickness and refractive indices must be finite and positive.")
        center = np.asarray(self.center_m, float)
        if center.shape != (3,) or not np.all(np.isfinite(center)):
            raise ValueError("center_m must be a finite 3-vector.")
        object.__setattr__(self, "center_m", tuple(center))
        if not isinstance(self.upper_only, bool):
            raise ValueError("upper_only must be a boolean.")


@dataclass
class Trace:
    inner_hit: np.ndarray
    outer_hit: np.ndarray
    wall_direction: np.ndarray
    exit_direction: np.ndarray
    inside_length_m: np.ndarray
    wall_length_m: np.ndarray
    valid: np.ndarray
    status: np.ndarray


def vectors(values, name):
    values = np.asarray(values, dtype=float)
    if values.ndim != 2 or values.shape[1] != 3:
        raise ValueError(f"{name} must have shape (N, 3).")
    return values


def _refract(direction, normal, n1, n2):
    cosine = np.sum(direction * normal, axis=1)
    tangent = (n1 / n2) * (direction - cosine[:, None] * normal)
    square = np.sum(tangent * tangent, axis=1)
    valid = (cosine > 0) & (square <= 1 + 1e-12)
    out = tangent + np.sqrt(np.maximum(0, 1 - square))[:, None] * normal
    return out, valid


def _exit_sphere(origin, direction, center, radius):
    relative = origin - center
    projection = np.sum(relative * direction, axis=1)
    discriminant = projection**2 + radius**2 - np.sum(relative**2, axis=-1)
    distance = -projection + np.sqrt(np.maximum(discriminant, 0))
    valid = (discriminant >= -1e-14) & (distance > 0)
    hit = origin + distance[:, None] * direction
    return hit, distance, valid


def trace_rays(directions, origin_m, dome=None):
    """Trace an (N,3) batch from one interior origin; invalid rows become NaN.

    Hemisphere support means both hits have z >= center.z. A base plate, rim,
    nonconcentric surfaces, scattering and multiple reflections are not modeled.
    """
    dome = Dome() if dome is None else dome
    direction = vectors(directions, "directions").copy()
    origin = np.asarray(origin_m, dtype=float)
    center = np.asarray(dome.center_m)
    if origin.shape != (3,) or not np.all(np.isfinite(origin)):
        raise ValueError("origin_m must be a finite 3-vector.")
    if np.linalg.norm(origin - center) >= dome.inner_radius_m:
        raise ValueError("LiDAR origin must be strictly inside the inner sphere.")
    lengths = np.linalg.norm(direction, axis=1)
    valid = np.isfinite(direction).all(axis=1) & np.isfinite(lengths) & (lengths > 0)
    status = np.where(valid, "ok", "invalid_direction").astype("U32")
    direction[~valid] = (0, 0, 1)
    direction /= np.where(valid, lengths, 1)[:, None]

    def require(mask, reason):
        nonlocal valid
        status[valid & ~mask] = reason
        valid &= mask

    p1, l1, hit = _exit_sphere(origin, direction, center, dome.inner_radius_m)
    require(hit, "no_inner_hit")
    if dome.upper_only:
        require(p1[:, 2] >= center[2] - 1e-12, "outside_aperture")
    wall, transmit = _refract(direction, (p1-center)/dome.inner_radius_m,
                              dome.n_inside, dome.n_wall)
    require(transmit, "inner_total_reflection")
    radius = dome.inner_radius_m + dome.thickness_m
    p2, l2, hit = _exit_sphere(p1, wall, center, radius)
    require(hit, "no_outer_hit")
    if dome.upper_only:
        require(p2[:, 2] >= center[2] - 1e-12, "outside_aperture")
    out, transmit = _refract(wall, (p2-center)/radius, dome.n_wall, dome.n_outside)
    require(transmit, "outer_total_reflection")
    for array in (p1, p2, wall, out, l1, l2):
        array[~valid] = np.nan
    return Trace(p1, p2, wall, out, l1, l2, valid, status)


def xz_directions(angles_deg):
    """Legacy angle convention: counterclockwise from +X towards +Z."""
    a = np.deg2rad(np.asarray(angles_deg, float))
    return np.column_stack((np.cos(a), np.zeros_like(a), np.sin(a)))


def angle_between_deg(a, b):
    """Stable for near-zero deflections as well as large angles."""
    return np.rad2deg(np.arctan2(np.linalg.norm(np.cross(a, b), axis=-1),
                                np.sum(a*b, axis=-1)))
