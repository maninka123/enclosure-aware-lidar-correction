import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from dome_correction import Dome
from dome_correction.lut import (
    AngularLUT,
    LUTSettings,
    angles_to_direction,
    configuration_signature,
    correct_points_lut,
    direction_to_angles,
    generate_lut,
    load_lut,
    lookup_directions,
    lut_signature,
    save_lut,
)
from dome_correction.model import angle_between_deg, trace_rays


class LUTTests(unittest.TestCase):
    def settings(self, resolution=5):
        return LUTSettings(resolution, 60, 120, 60, 120)

    def test_angle_roundtrip_preserves_valid_quadrants(self):
        directions = np.asarray([
            [1, 2, 3], [-1, 2, 3], [-1, -2, 3], [1, -2, 3],
            [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
        ], float)
        angles = direction_to_angles(directions)
        restored, valid = angles_to_direction(angles[:, 0], angles[:, 1])
        self.assertTrue(valid.all())
        expected = directions/np.linalg.norm(directions, axis=1)[:, None]
        np.testing.assert_allclose(restored, expected, atol=1e-14)

    def test_nodes_reproduce_analytical_exit_directions(self):
        dome, origin, rotation = Dome(), (-.02, 0, .02445), np.eye(3)
        lut = generate_lut(dome, origin_m=origin,
                           sensor_to_dome_rotation=rotation,
                           settings=self.settings(), validate=False)
        gx, gy = np.meshgrid(lut.xz_deg, lut.yz_deg)
        directions, _ = angles_to_direction(gx.ravel(), gy.ravel())
        predicted, valid, _ = lookup_directions(directions, lut)
        traced = trace_rays(directions @ rotation.T, origin, dome)
        common = valid & traced.valid
        np.testing.assert_allclose(predicted[common],
                                   (traced.exit_direction @ rotation)[common],
                                   atol=2e-14)

    def test_valid_full_domain_nodes_have_finite_inspection_deltas(self):
        lut = generate_lut(
            Dome(), origin_m=(-.02, 0, .02445),
            sensor_to_dome_rotation=np.eye(3),
            settings=LUTSettings(10, 0, 180, 0, 180), validate=False,
        )
        self.assertTrue(np.isfinite(lut.delta_xz_deg[lut.valid]).all())
        self.assertTrue(np.isfinite(lut.delta_yz_deg[lut.valid]).all())

    def test_bilinear_interpolation_known_constant_nodes(self):
        settings = LUTSettings(1, 0, 1, 0, 1)
        exits = np.zeros((2, 2, 3)); exits[..., 2] = 1
        lut = AngularLUT(settings, np.array([0., 1.]), np.array([0., 1.]),
                         exits, np.zeros((2, 2)), np.zeros((2, 2)),
                         np.ones((2, 2), bool), np.full((2, 2), "ok"), {},
                         "config", lut_signature("config", settings), 0)
        direction, _ = angles_to_direction([.25], [.75])
        result, valid, status = lookup_directions(direction, lut)
        self.assertTrue(valid[0]); self.assertEqual(status[0], "ok")
        np.testing.assert_allclose(result[0], [0, 0, 1])

    def test_finer_resolution_reduces_interpolation_error(self):
        kwargs = dict(dome=Dome(), origin_m=(-.02, 0, .02445),
                      sensor_to_dome_rotation=np.eye(3), validate=True,
                      validation_limit=5000)
        coarse = generate_lut(settings=self.settings(5), **kwargs)
        fine = generate_lut(settings=self.settings(1), **kwargs)
        self.assertLess(fine.validation["rms_angular_error_deg"],
                        coarse.validation["rms_angular_error_deg"])
        self.assertEqual(
            fine.validation_map["error_deg"].shape,
            (len(fine.validation_map["yz_deg"]),
             len(fine.validation_map["xz_deg"])),
        )
        self.assertEqual(np.isfinite(fine.validation_map["error_deg"]).sum(),
                         fine.validation["valid_validation_samples"])

    def test_zero_correction_limits(self):
        for dome, origin in [
            (Dome(), (0, 0, 0)),
            (Dome(n_inside=1.2, n_wall=1.2, n_outside=1.2),
             (-.02, 0, .02445)),
        ]:
            lut = generate_lut(dome, origin_m=origin,
                               sensor_to_dome_rotation=np.eye(3),
                               settings=self.settings(), validate=False)
            points = np.array([[.1, .2, 2], [-.2, .1, 3]])
            corrected = correct_points_lut(points, lut, dome=dome,
                                           origin_m=origin,
                                           sensor_to_dome_rotation=np.eye(3))
            np.testing.assert_allclose(corrected.points, points, atol=2e-3)

    def test_rotation_domain_and_invalid_neighbours(self):
        rotation = np.array([[0., 1, 0], [0, 0, 1], [1, 0, 0]])
        dome, origin = Dome(upper_only=False), (-.02, 0, .02445)
        lut = generate_lut(dome, origin_m=origin,
                           sensor_to_dome_rotation=rotation,
                           settings=self.settings(), validate=False)
        inside, _ = angles_to_direction([90], [90])
        outside, _ = angles_to_direction([121], [90])
        self.assertTrue(lookup_directions(inside, lut)[1][0])
        self.assertEqual(lookup_directions(outside, lut)[2][0],
                         "outside_lut_domain")
        lut.valid[0, 0] = False
        corner, _ = angles_to_direction([61], [61])
        self.assertEqual(lookup_directions(corner, lut)[2][0],
                         "invalid_interpolation_neighbours")

    def test_hash_cache_and_import_compatibility(self):
        dome, origin, rotation = Dome(), (-.02, 0, .02445), np.eye(3)
        lut = generate_lut(dome, origin_m=origin,
                           sensor_to_dome_rotation=rotation,
                           settings=self.settings(), validate=False)
        self.assertEqual(lut.configuration_hash,
                         configuration_signature(dome, origin, rotation))
        self.assertNotEqual(lut.configuration_hash,
                            configuration_signature(Dome(thickness_m=.006),
                                                    origin, rotation))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"lut.json"
            save_lut(lut, path)
            loaded = load_lut(path, dome=dome, origin_m=origin,
                              sensor_to_dome_rotation=rotation)
            self.assertEqual(loaded.lut_hash, lut.lut_hash)
            with self.assertRaisesRegex(ValueError, "incompatible"):
                load_lut(path, dome=Dome(thickness_m=.006), origin_m=origin,
                         sensor_to_dome_rotation=rotation)
            data = json.loads(path.read_text())
            data["settings"]["resolution_deg"] = 2
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "inconsistent"):
                load_lut(path)

    def test_lut_correction_preserves_measured_radius(self):
        lut = generate_lut(Dome(), origin_m=(-.02, 0, .02445),
                           sensor_to_dome_rotation=np.eye(3),
                           settings=self.settings(1), validate=False)
        points = np.array([[.1, .2, 2], [-.2, .1, 3]])
        result = correct_points_lut(points, lut)
        np.testing.assert_allclose(np.linalg.norm(result.points, axis=1),
                                   np.linalg.norm(points, axis=1), atol=1e-12)


if __name__ == "__main__":
    unittest.main()
