import unittest
import numpy as np
from dome_correction import Dome, trace_rays, correct_points
from dome_correction.model import xz_directions


class PhysicsTests(unittest.TestCase):
    def test_existing_2d_regression(self):
        # Captured from dome_beam_refraction.trace_beam, current Python baseline.
        # Constants keep this regression independent of the old source folder.
        angles = [50, 70, 90, 110, 130]
        expected_exit = [[.6359667642956957, .7717164470913285],
                         [.33504825693950135, .9422009687544383],
                         [-.005105988719334736, .999986964354635],
                         [-.3443883158284703, .9388272939794784],
                         [-.6427158593650519, .7661046430616661]]
        expected_outer_cm = [[2.1557397092762596, 7.49618478333142],
                             [-.10879026470517399, 7.799241288632208],
                             [-2.0384691557690524, 7.528920473811516],
                             [-3.6414321401697016, 6.897823712486361],
                             [-4.982837653524516, 6.000944002289831]]
        trace = trace_rays(xz_directions(angles), (-.02, 0, .02445))
        np.testing.assert_allclose(trace.exit_direction[:, [0, 2]], expected_exit, atol=1e-13, rtol=0)
        np.testing.assert_allclose(trace.outer_hit[:, [0, 2]]*100, expected_outer_cm, atol=1e-12, rtol=0)

    def test_centered_rays_have_no_deflection(self):
        directions = xz_directions(np.arange(1, 180))
        t = trace_rays(directions, (0, 0, 0))
        self.assertTrue(t.valid.all())
        np.testing.assert_allclose(t.exit_direction, directions, atol=1e-14)

    def test_snell_invariants_and_surface_hits(self):
        d = Dome()
        directions = xz_directions(np.arange(20, 161))
        t = trace_rays(directions, (-.02, 0, .02445), d)
        self.assertTrue(t.valid.all())
        np.testing.assert_allclose(np.linalg.norm(t.inner_hit, axis=1), d.inner_radius_m, atol=1e-14)
        np.testing.assert_allclose(np.linalg.norm(t.outer_hit, axis=1), d.inner_radius_m+d.thickness_m, atol=1e-14)
        for before, after, normal, n1, n2 in [
            (directions, t.wall_direction, t.inner_hit/d.inner_radius_m, d.n_inside, d.n_wall),
            (t.wall_direction, t.exit_direction, t.outer_hit/(d.inner_radius_m+d.thickness_m), d.n_wall, d.n_outside)]:
            np.testing.assert_allclose(n1*np.cross(before, normal), n2*np.cross(after, normal), atol=1e-13)
            np.testing.assert_allclose(np.linalg.norm(after, axis=1), 1, atol=1e-13)

    def test_homogeneous_medium_is_identity(self):
        points = np.array([[1, 2, 5], [-2, .3, 7]])
        dome = Dome(n_inside=1.2, n_wall=1.2, n_outside=1.2)
        for mode in ("direction_only", "geometric_path", "optical_path"):
            r = correct_points(points, dome, origin_m=(-.02, 0, .02445),
                               range_model=mode, range_reference_index=1.2 if mode == "optical_path" else None)
            np.testing.assert_allclose(r.points, points, atol=1e-13)

    def test_optical_roundtrip_with_rotation_and_translation(self):
        dome = Dome(center_m=(.1, .2, .3), n_outside=1.333)
        origin = np.array([.08, .2, .32445])
        rotation = np.array([[0, 1, 0], [0, 0, 1], [1, 0, 0]])
        directions = xz_directions([50, 90, 130])
        trace = trace_rays(directions, origin, dome)
        outside = np.array([1., 4., 9.])
        measured = (dome.n_inside*trace.inside_length_m + dome.n_wall*trace.wall_length_m
                    + dome.n_outside*outside)/dome.n_inside
        raw = directions*measured[:, None] @ rotation
        r = correct_points(raw, dome, origin_m=origin, sensor_to_dome_rotation=rotation,
                           range_model="optical_path", range_reference_index=dome.n_inside, chunk_size=1)
        expected = (trace.outer_hit + outside[:, None]*trace.exit_direction-origin) @ rotation
        np.testing.assert_allclose(r.points, expected, atol=1e-13)

    def test_invalid_and_short_ranges_preserve_rows(self):
        raw = [[0, 0, 0], [np.nan, 0, 1], [0, 0, -2], [0, 0, .001], [0, 0, 5]]
        r = correct_points(raw, range_model="geometric_path")
        self.assertEqual(r.valid.tolist(), [False, False, False, False, True])
        self.assertTrue(np.isnan(r.points[:4]).all())
        self.assertEqual(r.status[3], "range_before_outer_surface")

    def test_total_internal_reflection(self):
        d = Dome(n_inside=1.5, n_wall=1, upper_only=False)
        t = trace_rays([[0, 1, 0]], (.07, 0, 0), d)
        self.assertEqual(t.status[0], "inner_total_reflection")
        self.assertFalse(t.valid[0])

    def test_bad_configuration_rejected(self):
        for value in (0, -1, np.nan, np.inf):
            with self.assertRaises(ValueError):
                Dome(thickness_m=value)
        with self.assertRaises(ValueError):
            trace_rays([[0, 0, 1]], (.1, 0, 0))
        with self.assertRaises(ValueError):
            correct_points([[0, 0, 5]], range_model="optical_path")
        with self.assertRaises(ValueError):
            correct_points([[0, 0, 5]], range_model="direction_only", sensor_to_dome_rotation=-np.eye(3))

    def test_empty_cloud(self):
        r = correct_points(np.empty((0, 3)), range_model="direction_only")
        self.assertEqual(r.points.shape, (0, 3))

    def test_direction_scale_does_not_change_ray(self):
        directions = np.array([[.3, .2, 1.]])
        reference = trace_rays(directions, (-.02, 0, .02445))
        for scale in (1e-200, 1e200):
            trace = trace_rays(directions*scale, (-.02, 0, .02445))
            self.assertTrue(trace.valid.all())
            np.testing.assert_allclose(trace.exit_direction, reference.exit_direction, atol=1e-14)

    def test_near_surface_and_thin_wall(self):
        dome = Dome(thickness_m=1e-10)
        trace = trace_rays([[0, 0, 1]], (0, 0, dome.inner_radius_m-1e-12), dome)
        self.assertTrue(trace.valid.all())
        np.testing.assert_allclose(trace.inside_length_m, 1e-12, atol=1e-17, rtol=0)
        np.testing.assert_allclose(trace.wall_length_m, 1e-10, atol=1e-17, rtol=0)

    def test_numeric_strings_are_rejected(self):
        for value in ("0.004", True, [0.004]):
            with self.assertRaises(ValueError):
                Dome(thickness_m=value)

    def test_irrelevant_range_index_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "only used"):
            correct_points([[0, 0, 5]], range_model="direction_only", range_reference_index=1)


if __name__ == "__main__":
    unittest.main()
