"""Paper-style angular lookup tables generated from the analytical ray tracer.

Angles are paper-style planar angles in degrees:
theta_xz = atan2(z, x), theta_yz = atan2(z, y).  Zero and 180 degrees are
the lateral axis ends and 90 degrees is sensor +Z. The table stores sensor-frame
exit vectors and bilinearly interpolates those vectors before normalisation.
Measured point radius is preserved by LUT correction.
"""
from dataclasses import asdict, dataclass, field
from hashlib import sha256
import json
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
import numpy as np

from .config import config_dict
from .correction import Correction, rotation_matrix
from .model import Dome, angle_between_deg, trace_rays, vectors


SCHEMA_VERSION = "2.0"


@dataclass(frozen=True)
class LUTSettings:
    """Sensor-frame LUT grid using 0..180 degree XZ/YZ plane angles."""
    resolution_deg: float = 0.1
    xz_min_deg: float = 50.0
    xz_max_deg: float = 130.0
    yz_min_deg: float = 50.0
    yz_max_deg: float = 130.0
    interpolation: str = "bilinear"

    def __post_init__(self):
        values = np.asarray([
            self.resolution_deg, self.xz_min_deg, self.xz_max_deg,
            self.yz_min_deg, self.yz_max_deg,
        ], float)
        if not np.isfinite(values).all() or self.resolution_deg <= 0:
            raise ValueError("LUT angular values must be finite and resolution must be positive.")
        if self.xz_max_deg <= self.xz_min_deg or self.yz_max_deg <= self.yz_min_deg:
            raise ValueError("LUT angular maxima must be greater than minima.")
        if self.interpolation != "bilinear":
            raise ValueError("Only bilinear LUT interpolation is supported.")
        for lo, hi in ((self.xz_min_deg, self.xz_max_deg),
                       (self.yz_min_deg, self.yz_max_deg)):
            if lo < 0 or hi > 180:
                raise ValueError("LUT plane angles must stay within 0 to 180 degrees.")
        nx = round((self.xz_max_deg-self.xz_min_deg)/self.resolution_deg)
        ny = round((self.yz_max_deg-self.yz_min_deg)/self.resolution_deg)
        if (not np.isclose(nx*self.resolution_deg,
                           self.xz_max_deg-self.xz_min_deg, atol=1e-10)
                or not np.isclose(ny*self.resolution_deg,
                                  self.yz_max_deg-self.yz_min_deg, atol=1e-10)):
            raise ValueError("Each LUT angular span must be divisible by its resolution.")
        if nx < 1 or ny < 1:
            raise ValueError("Each LUT axis needs at least two nodes.")
        if (nx+1)*(ny+1) > 4_000_000:
            raise ValueError("LUT exceeds the four-million-cell safety limit.")


@dataclass
class AngularLUT:
    settings: LUTSettings
    xz_deg: np.ndarray
    yz_deg: np.ndarray
    exit_direction_sensor: np.ndarray
    delta_xz_deg: np.ndarray
    delta_yz_deg: np.ndarray
    valid: np.ndarray
    status: np.ndarray
    configuration: dict
    configuration_hash: str
    lut_hash: str
    generation_time_s: float
    validation: dict = field(default_factory=dict)
    validation_error_deg: np.ndarray = field(default_factory=lambda: np.empty(0))
    validation_map: dict = field(default_factory=dict)


def _plane_angles(directions, require_positive_z):
    d = vectors(directions, "directions")
    length = np.linalg.norm(d, axis=1)
    valid = np.isfinite(d).all(axis=1) & np.isfinite(length) & (length > 0)
    unit = np.full_like(d, np.nan)
    np.divide(d, length[:, None], out=unit, where=valid[:, None])
    xz = np.rad2deg(np.arctan2(unit[:, 2], unit[:, 0]))
    yz = np.rad2deg(np.arctan2(unit[:, 2], unit[:, 1]))
    xz[np.hypot(unit[:, 0], unit[:, 2]) <= 1e-12] = 90.0
    yz[np.hypot(unit[:, 1], unit[:, 2]) <= 1e-12] = 90.0
    angles = np.column_stack((xz, yz))
    if require_positive_z:
        valid &= unit[:, 2] >= -1e-12
    angles[~valid] = np.nan
    return angles


def direction_to_angles(directions):
    """Return paper-style input XZ/YZ angles: 90 degrees is sensor +Z."""
    return _plane_angles(directions, True)


def angles_to_direction(theta_xz_deg, theta_yz_deg):
    """Invert 0..180 degree plane angles, with 90 degrees along sensor +Z."""
    xz, yz = np.broadcast_arrays(np.asarray(theta_xz_deg, float),
                                 np.asarray(theta_yz_deg, float))
    xr, yr = np.deg2rad(xz), np.deg2rad(yz)
    valid = (np.isfinite(xr) & np.isfinite(yr) & (xz >= 0) & (xz <= 180)
             & (yz >= 0) & (yz <= 180))
    sx, sy, cx, cy = np.sin(xr), np.sin(yr), np.cos(xr), np.cos(yr)
    direction = np.stack((cx*sy, cy*sx, sx*sy), axis=-1)
    length = np.linalg.norm(direction, axis=-1)
    corners = valid & (length <= 1e-12)
    fallback = np.stack((cx, cy, np.zeros_like(cx)), axis=-1)
    direction = np.where(corners[..., None], fallback, direction)
    length = np.linalg.norm(direction, axis=-1)
    valid &= length > 0
    direction = np.divide(direction, length[..., None],
                          out=np.full_like(direction, np.nan),
                          where=valid[..., None])
    return direction, valid


def _axis(lo, hi, step):
    count = int(round((hi-lo)/step))
    return np.linspace(lo, hi, count+1)


def _canonical_number(value):
    number = float(value)
    if not np.isfinite(number):
        raise ValueError("Configuration signatures require finite numbers.")
    if number == 0:
        return "0"
    text = format(number, ".15g")
    if "e" in text:
        mantissa, exponent = text.split("e")
        text = f"{mantissa}e{int(exponent)}"
    return text


def _signature_value(value):
    if isinstance(value, dict):
        return {key: _signature_value(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [_signature_value(item) for item in value]
    if isinstance(value, (int, float, np.integer, np.floating)) and not isinstance(value, bool):
        return _canonical_number(value)
    return value


def _canonical(value):
    return json.dumps(_signature_value(value), sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def configuration_signature(dome, origin_m, sensor_to_dome_rotation):
    data = config_dict(dome, np.asarray(origin_m, float),
                       rotation_matrix(sensor_to_dome_rotation))
    return sha256(_canonical(data).encode()).hexdigest()


def lut_signature(configuration_hash, settings):
    return sha256(_canonical({"configuration_hash": configuration_hash,
                              "lut": asdict(settings)}).encode()).hexdigest()


def _wrap_delta(value):
    return (value + 180) % 360 - 180


def generate_lut(dome=None, *, origin_m=(0, 0, 0),
                 sensor_to_dome_rotation=None, settings=None,
                 validate=True, validation_limit=20000):
    """Generate a dynamic table by sampling the canonical analytical tracer."""
    dome = Dome() if dome is None else dome
    settings = LUTSettings() if settings is None else settings
    rotation = rotation_matrix(np.eye(3) if sensor_to_dome_rotation is None
                               else sensor_to_dome_rotation)
    origin = np.asarray(origin_m, float)
    started = perf_counter()
    xz = _axis(settings.xz_min_deg, settings.xz_max_deg,
               settings.resolution_deg)
    yz = _axis(settings.yz_min_deg, settings.yz_max_deg,
               settings.resolution_deg)
    gx, gy = np.meshgrid(xz, yz)
    sensor, representable = angles_to_direction(gx.ravel(), gy.ravel())
    traced = trace_rays(sensor @ rotation.T, origin, dome)
    valid = traced.valid & representable
    exit_sensor = traced.exit_direction @ rotation
    exit_sensor[~valid] = np.nan
    # Valid rays can refract below the sensor XY plane near the 0/180-degree
    # input boundaries. Their exit vectors remain valid; only LUT inputs are
    # restricted to +Z, so use unrestricted plane angles for exported deltas.
    exit_angles = _plane_angles(exit_sensor, False)
    delta = _wrap_delta(exit_angles - np.column_stack((gx.ravel(), gy.ravel())))
    delta[~valid] = np.nan
    status = traced.status.copy()
    status[~representable] = "invalid_angle_pair"
    shape = gx.shape
    configuration = config_dict(dome, origin, rotation)
    config_hash = configuration_signature(dome, origin, rotation)
    lut = AngularLUT(
        settings=settings, xz_deg=xz, yz_deg=yz,
        exit_direction_sensor=exit_sensor.reshape(*shape, 3),
        delta_xz_deg=delta[:, 0].reshape(shape),
        delta_yz_deg=delta[:, 1].reshape(shape),
        valid=valid.reshape(shape), status=status.reshape(shape),
        configuration=configuration, configuration_hash=config_hash,
        lut_hash=lut_signature(config_hash, settings),
        generation_time_s=perf_counter()-started,
    )
    if validate:
        lut.validation = validate_lut(lut, dome=dome, origin_m=origin,
                                      sensor_to_dome_rotation=rotation,
                                      sample_limit=validation_limit)
    return lut


def lookup_directions(directions, lut):
    """Bilinearly interpolate sensor-frame exit directions without extrapolation."""
    d = vectors(directions, "directions")
    angles = direction_to_angles(d)
    s = lut.settings
    u = (angles[:, 0]-lut.xz_deg[0])/s.resolution_deg
    v = (angles[:, 1]-lut.yz_deg[0])/s.resolution_deg
    finite = np.isfinite(u) & np.isfinite(v)
    inside = (finite & (u >= -1e-12) & (v >= -1e-12)
              & (u <= len(lut.xz_deg)-1+1e-12)
              & (v <= len(lut.yz_deg)-1+1e-12))
    safe_u, safe_v = np.where(finite, u, 0), np.where(finite, v, 0)
    i = np.clip(np.floor(safe_u).astype(np.int64), 0,
                len(lut.xz_deg)-2)
    j = np.clip(np.floor(safe_v).astype(np.int64), 0,
                len(lut.yz_deg)-2)
    fu = np.clip(u-i, 0, 1)
    fv = np.clip(v-j, 0, 1)
    neighbours = np.column_stack((
        lut.valid[j, i], lut.valid[j, i+1],
        lut.valid[j+1, i], lut.valid[j+1, i+1],
    ))
    usable = inside & neighbours.all(axis=1)
    out = np.full_like(d, np.nan)
    if usable.any():
        k = np.flatnonzero(usable)
        a = lut.exit_direction_sensor[j[k], i[k]]
        b = lut.exit_direction_sensor[j[k], i[k]+1]
        c = lut.exit_direction_sensor[j[k]+1, i[k]]
        e = lut.exit_direction_sensor[j[k]+1, i[k]+1]
        x, y = fu[k, None], fv[k, None]
        q = (a*(1-x)*(1-y) + b*x*(1-y) + c*(1-x)*y + e*x*y)
        q /= np.linalg.norm(q, axis=1)[:, None]
        out[k] = q
    status = np.full(len(d), "invalid_interpolation_neighbours", dtype="U40")
    status[~finite] = "invalid_direction"
    status[finite & ~inside] = "outside_lut_domain"
    status[usable] = "ok"
    return out, usable, status


def correct_points_lut(points, lut, *, dome=None, origin_m=None,
                       sensor_to_dome_rotation=None):
    """Apply paper-style angular correction while preserving measured radius."""
    raw = vectors(points, "points")
    if dome is not None:
        signature = configuration_signature(
            dome, origin_m,
            np.eye(3) if sensor_to_dome_rotation is None else sensor_to_dome_rotation)
        if signature != lut.configuration_hash:
            raise ValueError("LUT is incompatible with the current enclosure configuration.")
    radius = np.linalg.norm(raw, axis=1)
    directions = np.full_like(raw, np.nan)
    usable = np.isfinite(raw).all(axis=1) & np.isfinite(radius) & (radius > 0)
    np.divide(raw, radius[:, None], out=directions, where=usable[:, None])
    exit_direction, valid, status = lookup_directions(directions, lut)
    valid &= usable
    status[~usable] = "invalid_direction"
    result = exit_direction*radius[:, None]
    result[~valid] = np.nan
    return Correction(result, valid, status)


# Public singular name used by the CLI/documentation; it accepts a batch just
# like the analytical correction API.
lookup_correction = lookup_directions


def _percentile(values, q):
    return float(np.percentile(values, q)) if len(values) else None


def validate_lut(lut, *, dome, origin_m, sensor_to_dome_rotation,
                 sample_limit=20000):
    """Validate at deterministic cell interiors, never only at LUT nodes."""
    cx = (lut.xz_deg[:-1]+lut.xz_deg[1:])/2
    cy = (lut.yz_deg[:-1]+lut.yz_deg[1:])/2
    x_count = min(len(cx), max(1, int(np.sqrt(sample_limit*len(cx)/len(cy)))))
    y_count = min(len(cy), max(1, sample_limit//x_count))
    xi = np.unique(np.linspace(0, len(cx)-1, x_count, dtype=int))
    yi = np.unique(np.linspace(0, len(cy)-1, y_count, dtype=int))
    gi, gj = np.meshgrid(xi, yi)
    sample_x, sample_y = cx[gi], cy[gj]
    directions, representable = angles_to_direction(sample_x.ravel(),
                                                      sample_y.ravel())
    rotation = rotation_matrix(sensor_to_dome_rotation)
    analytical = trace_rays(directions @ rotation.T, origin_m, dome)
    reference = analytical.exit_direction @ rotation
    predicted, lut_valid, _ = lookup_directions(directions, lut)
    common = representable & analytical.valid & lut_valid
    errors = angle_between_deg(reference[common], predicted[common])
    cell_indices = (gj*len(cx)+gi).ravel()
    error_map = np.full(len(cx)*len(cy), np.nan)
    error_map[cell_indices[common]] = errors
    validation_map_error = np.full(cell_indices.size, np.nan)
    validation_map_error[common] = errors
    lut.validation_error_deg = error_map.reshape(len(cy), len(cx))
    lut.validation_map = {
        "xz_deg": cx[xi],
        "yz_deg": cy[yi],
        "error_deg": validation_map_error.reshape(len(yi), len(xi)),
    }
    def endpoint(distance):
        return float(np.sqrt(np.mean((2*distance*np.sin(np.deg2rad(errors)/2))**2))*1000) if len(errors) else None
    return {
        "resolution_deg": lut.settings.resolution_deg,
        "cells": int(lut.valid.size),
        "generation_time_s": lut.generation_time_s,
        "memory_bytes": int(sum(a.nbytes for a in (
            lut.exit_direction_sensor, lut.delta_xz_deg, lut.delta_yz_deg,
            lut.valid, lut.status))),
        "valid_cells": int(lut.valid.sum()),
        "invalid_cells": int(lut.valid.size-lut.valid.sum()),
        "validation_samples": int(cell_indices.size),
        "valid_validation_samples": int(common.sum()),
        "mean_angular_error_deg": float(np.mean(errors)) if len(errors) else None,
        "rms_angular_error_deg": float(np.sqrt(np.mean(errors**2))) if len(errors) else None,
        "p95_angular_error_deg": _percentile(errors, 95),
        "max_angular_error_deg": float(np.max(errors)) if len(errors) else None,
        "equivalent_rms_position_error_mm_at_1m": endpoint(1),
        "equivalent_rms_position_error_mm_at_5m": endpoint(5),
        "equivalent_rms_position_error_mm_at_10m": endpoint(10),
    }


def lut_to_dict(lut):
    def floats(values):
        return [float(value) if np.isfinite(value) else None
                for value in np.asarray(values).ravel()]
    return {
        "schema": "enclosure-aware-lidar-lut",
        "schema_version": SCHEMA_VERSION,
        "software_version": "0.1.0",
        "generation_timestamp": datetime.now(timezone.utc).isoformat(),
        "configuration": lut.configuration,
        "configuration_hash": lut.configuration_hash,
        "lut_hash": lut.lut_hash,
        "coordinate_convention": {
            "frame": "sensor",
            "theta_xz": "degrees, atan2(z,x); 0=+X, 90=+Z, 180=-X",
            "theta_yz": "degrees, atan2(z,y); 0=+Y, 90=+Z, 180=-Y",
            "correction": "bilinear exit-vector interpolation; measured radius preserved",
        },
        "settings": asdict(lut.settings),
        "xz_deg": lut.xz_deg.tolist(),
        "yz_deg": lut.yz_deg.tolist(),
        "exit_direction_sensor": floats(lut.exit_direction_sensor),
        "delta_xz_deg": floats(lut.delta_xz_deg),
        "delta_yz_deg": floats(lut.delta_yz_deg),
        "valid": lut.valid.ravel().tolist(),
        "status": lut.status.ravel().tolist(),
        "generation_time_s": lut.generation_time_s,
        "validation": lut.validation,
        "validation_error_deg": floats(lut.validation_error_deg),
        "validation_map": ({
            "xz_deg": floats(lut.validation_map["xz_deg"]),
            "yz_deg": floats(lut.validation_map["yz_deg"]),
            "error_deg": floats(lut.validation_map["error_deg"]),
        } if lut.validation_map else None),
    }


def save_lut(lut, path):
    path = Path(path)
    if path.exists():
        raise ValueError(f"Output already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(lut_to_dict(lut), separators=(",", ":"),
                               allow_nan=False),
                    encoding="utf-8")


def load_lut(path, *, dome=None, origin_m=None, sensor_to_dome_rotation=None):
    data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if data.get("schema") != "enclosure-aware-lidar-lut" or data.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported LUT schema or version.")
    settings = LUTSettings(**data["settings"])
    lut = AngularLUT(
        settings=settings,
        xz_deg=np.asarray(data["xz_deg"], float),
        yz_deg=np.asarray(data["yz_deg"], float),
        exit_direction_sensor=np.asarray(data["exit_direction_sensor"], float),
        delta_xz_deg=np.asarray(data["delta_xz_deg"], float),
        delta_yz_deg=np.asarray(data["delta_yz_deg"], float),
        valid=np.asarray(data["valid"], bool),
        status=np.asarray(data["status"], dtype="U40"),
        configuration=data["configuration"],
        configuration_hash=data["configuration_hash"],
        lut_hash=data["lut_hash"],
        generation_time_s=float(data["generation_time_s"]),
        validation=data.get("validation", {}),
        validation_error_deg=np.asarray(data.get("validation_error_deg", []), float),
        validation_map={
            "xz_deg": np.asarray(data["validation_map"]["xz_deg"], float),
            "yz_deg": np.asarray(data["validation_map"]["yz_deg"], float),
            "error_deg": np.asarray(data["validation_map"]["error_deg"], float),
        } if data.get("validation_map") else {},
    )
    expected = (len(lut.yz_deg), len(lut.xz_deg))
    if (lut.exit_direction_sensor.size == expected[0]*expected[1]*3):
        lut.exit_direction_sensor = lut.exit_direction_sensor.reshape(*expected, 3)
    if lut.delta_xz_deg.size == expected[0]*expected[1]:
        lut.delta_xz_deg = lut.delta_xz_deg.reshape(expected)
    if lut.delta_yz_deg.size == expected[0]*expected[1]:
        lut.delta_yz_deg = lut.delta_yz_deg.reshape(expected)
    if lut.valid.size == expected[0]*expected[1]:
        lut.valid = lut.valid.reshape(expected)
    if lut.status.size == expected[0]*expected[1]:
        lut.status = lut.status.reshape(expected)
    validation_shape = (expected[0]-1, expected[1]-1)
    if lut.validation_error_deg.size:
        if lut.validation_error_deg.size != validation_shape[0]*validation_shape[1]:
            raise ValueError("Malformed LUT validation error map.")
        lut.validation_error_deg = lut.validation_error_deg.reshape(validation_shape)
    if lut.validation_map:
        map_shape = (len(lut.validation_map["yz_deg"]),
                     len(lut.validation_map["xz_deg"]))
        if lut.validation_map["error_deg"].size != map_shape[0]*map_shape[1]:
            raise ValueError("Malformed LUT validation map.")
        lut.validation_map["error_deg"] = lut.validation_map["error_deg"].reshape(map_shape)
    if (lut.exit_direction_sensor.shape != (*expected, 3)
            or lut.valid.shape != expected or lut.status.shape != expected
            or lut.delta_xz_deg.shape != expected or lut.delta_yz_deg.shape != expected
            or lut.lut_hash != lut_signature(lut.configuration_hash, settings)):
        raise ValueError("Malformed or inconsistent LUT data.")
    if dome is not None:
        current = configuration_signature(
            dome, origin_m,
            np.eye(3) if sensor_to_dome_rotation is None else sensor_to_dome_rotation)
        if current != lut.configuration_hash:
            raise ValueError("Imported LUT is incompatible with the current configuration.")
    return lut
