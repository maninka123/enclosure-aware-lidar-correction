"""Cross-language parity: the deployed browser model must agree with Python."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import numpy as np
from dome_correction import (Dome, LUTSettings, correct_points,
                             generate_lut, load_lut, lookup_correction, trace_rays)
from dome_correction.lut import lut_to_dict


@unittest.skipUnless(shutil.which('node'), 'Node.js required for browser parity')
class WebParityTests(unittest.TestCase):
    def test_lut_generation_hash_and_interpolation(self):
        dome = Dome(n_outside=1.333)
        origin = np.array([.01, -.02, .005])
        rotation = np.array([[0., 1, 0], [0, 0, 1], [1, 0, 0]])
        settings = LUTSettings(resolution_deg=10, xz_min_deg=-20,
                               xz_max_deg=20, yz_min_deg=-20,
                               yz_max_deg=20)
        expected = generate_lut(dome, origin_m=origin,
                                sensor_to_dome_rotation=rotation,
                                settings=settings, validate=False)
        directions = np.array([[0, 0, 1], [.08, -.12, 1.]])
        expected_directions, expected_valid, _ = lookup_correction(directions, expected)
        cfg = dict(radius=dome.inner_radius_m, thickness=dome.thickness_m,
                   origin=origin.tolist(), center=list(dome.center_m),
                   nInside=dome.n_inside, nWall=dome.n_wall,
                   nOutside=dome.n_outside, upperOnly=dome.upper_only,
                   rotation=rotation.tolist())
        script = """import {deserializeLUT,generateLUT,lookupDirection,serializeLUT} from './src/lut.js';
let s='';for await(const chunk of process.stdin)s+=chunk;
const {c,settings,directions,pythonLUT}=JSON.parse(s);const lut=await generateLUT(c,settings);
const imported=await deserializeLUT(pythonLUT,c);
console.log(JSON.stringify({configurationHash:lut.configurationHash,lutHash:lut.lutHash,
exit:Array.from(lut.exit),valid:Array.from(lut.valid),
lookup:directions.map(d=>lookupDirection(d,imported)),exported:serializeLUT(lut)}));"""
        root = Path(__file__).resolve().parents[1] / 'webapp'
        result = subprocess.run(
            ['node', '--input-type=module', '-e', script], cwd=root,
            input=json.dumps({'c': cfg, 'settings': settings.__dict__,
                              'directions': directions.tolist(),
                              'pythonLUT': lut_to_dict(expected)}),
            text=True, capture_output=True, check=True)
        actual = json.loads(result.stdout)
        self.assertEqual(actual['configurationHash'], expected.configuration_hash)
        self.assertEqual(actual['lutHash'], expected.lut_hash)
        self.assertEqual(actual['valid'], expected.valid.ravel().astype(int).tolist())
        actual_exit = np.asarray([np.nan if value is None else value
                                  for value in actual['exit']], dtype=float)
        np.testing.assert_allclose(actual_exit.reshape(expected.exit_direction_sensor.shape),
                                   expected.exit_direction_sensor, atol=1e-12, rtol=0,
                                   equal_nan=True)
        for index in np.flatnonzero(expected_valid):
            np.testing.assert_allclose(actual['lookup'][index]['direction'],
                                       expected_directions[index], atol=1e-12, rtol=0)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'browser-lut.json'
            path.write_text(json.dumps(actual['exported']))
            imported = load_lut(path, dome=dome, origin_m=origin,
                                sensor_to_dome_rotation=rotation)
            self.assertEqual(imported.lut_hash, expected.lut_hash)

    def test_random_3d_rays_and_corrections(self):
        rng = np.random.default_rng(12)
        points = rng.normal(size=(300, 3)) * 5
        q = np.array([[0., 1, 0], [0, 0, 1], [1, 0, 0]])
        origin = [.01, -.02, .03]
        dome = Dome(n_outside=1.333)
        trace = trace_rays(points @ q.T, origin, dome)
        cfg = dict(radius=dome.inner_radius_m, thickness=dome.thickness_m,
                   origin=origin, center=[0, 0, 0], nInside=dome.n_inside,
                   nWall=dome.n_wall, nOutside=dome.n_outside,
                   upperOnly=True, rotation=q.tolist())
        script = """import {trace,correct,mv} from './src/physics.js';
let s='';for await(const chunk of process.stdin)s+=chunk;
const {c,p}=JSON.parse(s);
console.log(JSON.stringify(p.map(v=>({trace:trace(mv(c.rotation,v),c),
  corrections:['direction_only','geometric_path','optical_path'].map(m=>correct(v,c,m,c.nInside))}))));"""
        root = Path(__file__).resolve().parents[1] / 'webapp'
        result = subprocess.run(['node', '--input-type=module', '-e', script],
                                cwd=root, input=json.dumps({'c':cfg, 'p':points.tolist()}),
                                text=True, capture_output=True, check=True)
        actual = json.loads(result.stdout)
        self.assertEqual([r['trace']['valid'] for r in actual], trace.valid.tolist())
        for i in np.flatnonzero(trace.valid):
            np.testing.assert_allclose(actual[i]['trace']['exit'], trace.exit_direction[i], atol=1e-12, rtol=0)
            np.testing.assert_allclose(actual[i]['trace']['outer'], trace.outer_hit[i], atol=1e-12, rtol=0)
        for j, mode in enumerate(['direction_only','geometric_path','optical_path']):
            expected = correct_points(points, dome, origin_m=origin, sensor_to_dome_rotation=q,
                                      range_model=mode, range_reference_index=dome.n_inside if j==2 else None)
            self.assertEqual([r['corrections'][j]['valid'] for r in actual], expected.valid.tolist())
            for i in np.flatnonzero(expected.valid):
                np.testing.assert_allclose(actual[i]['corrections'][j]['point'], expected.points[i], atol=1e-11, rtol=0)
