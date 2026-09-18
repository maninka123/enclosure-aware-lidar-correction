"""Dome refraction, with lengths in metres and directions in enclosure axes."""
from .model import Dome, Trace, trace_rays
from .correction import Correction, correct_points

__all__ = ["Dome", "Trace", "trace_rays", "Correction", "correct_points"]
__version__ = "0.1.0"
