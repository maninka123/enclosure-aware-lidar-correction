"""Strict JSON configuration: metres, enclosure-frame origin, sensor rotation."""
from dataclasses import asdict
import json
from pathlib import Path
import numpy as np
from .model import Dome, trace_rays
from .correction import rotation_matrix


def load_config(path):
    config = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if not isinstance(config, dict):
        raise ValueError("Configuration must be a JSON object.")
    allowed = {"dome", "origin_m", "sensor_to_dome_rotation"}
    unknown = set(config) - allowed
    if unknown:
        raise ValueError(f"Unknown configuration keys: {sorted(unknown)}")
    missing = allowed - set(config)
    if missing:
        raise ValueError(f"Missing configuration keys: {sorted(missing)}")
    if not isinstance(config["dome"], dict):
        raise ValueError("dome must be a JSON object.")
    dome = Dome(**config["dome"])
    origin = np.asarray(config["origin_m"], dtype=float)
    rotation = rotation_matrix(config["sensor_to_dome_rotation"])
    trace_rays(np.empty((0, 3)), origin, dome)
    return dome, origin, rotation


def config_dict(dome, origin, rotation):
    return {"dome": asdict(dome), "origin_m": list(origin),
            "sensor_to_dome_rotation": rotation.tolist()}
