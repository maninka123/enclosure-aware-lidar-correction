"""Strict JSON configuration: metres, enclosure-frame origin, sensor rotation."""
from dataclasses import asdict
import json
from pathlib import Path
from .model import Dome
from .correction import rotation_matrix


def load_config(path):
    config = json.loads(Path(path).read_text(encoding="utf-8"))
    allowed = {"dome", "origin_m", "sensor_to_dome_rotation"}
    unknown = set(config) - allowed
    if unknown:
        raise ValueError(f"Unknown configuration keys: {sorted(unknown)}")
    dome = Dome(**config["dome"])
    origin = config["origin_m"]
    rotation = rotation_matrix(config["sensor_to_dome_rotation"])
    return dome, origin, rotation


def config_dict(dome, origin, rotation):
    return {"dome": asdict(dome), "origin_m": list(origin),
            "sensor_to_dome_rotation": rotation.tolist()}
