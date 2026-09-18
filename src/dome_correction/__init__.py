"""Dome refraction, with lengths in metres and directions in enclosure axes."""
from .model import Dome, Trace, trace_rays
from .correction import Correction, correct_points
from .lut import (AngularLUT, LUTSettings, angles_to_direction,
                  correct_points_lut, direction_to_angles, generate_lut,
                  load_lut, lookup_correction, lookup_directions, save_lut,
                  validate_lut)

__all__ = ["Dome", "Trace", "trace_rays", "Correction", "correct_points",
           "AngularLUT", "LUTSettings", "direction_to_angles",
           "angles_to_direction", "generate_lut", "validate_lut",
           "lookup_correction", "lookup_directions", "correct_points_lut",
           "save_lut", "load_lut"]
__version__ = "0.1.0"
