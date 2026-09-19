import contextlib
import csv
import io
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from dome_correction import Dome
from dome_correction.cli import main
from dome_correction.config import config_dict, load_config
from dome_correction.cloud_io import read_cloud


class WorkflowTests(unittest.TestCase):
    def test_config_validation(self):
        valid = config_dict(Dome(), [0, 0, 0], np.eye(3))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"config.json"
            for bad in ([], {}, dict(valid, origin_m=[0, 0, 1]), dict(valid, typo=1)):
                path.write_text(json.dumps(bad), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_config(path)
            path.write_text(json.dumps(valid), encoding="utf-8-sig")
            self.assertEqual(load_config(path)[0], Dome())

    def test_cli_units_metadata_and_overwrite_protection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config, raw, output = root/'config.json', root/'raw.csv', root/'out.csv'
            config.write_text(json.dumps(config_dict(Dome(n_inside=1, n_wall=1, n_outside=1), [0, 0, 0], np.eye(3))))
            raw.write_text('x,y,z,id\n0,0,5000,1234567890123456789\n0,0,0,2\n')
            args = ['correct', str(raw), '--config', str(config), '--input-unit', 'mm',
                    '--range-model', 'geometric_path', '--output', str(output)]
            with contextlib.redirect_stdout(io.StringIO()):
                main(args)
            result = read_cloud(output)
            np.testing.assert_allclose(result.points[0], [0, 0, 5000])
            self.assertTrue(np.isnan(result.points[1]).all())
            self.assertEqual(result.rows[0][3], '1234567890123456789')
            report = json.loads(output.with_suffix('.csv.report.json').read_text())
            self.assertEqual(report['valid'], 1)
            before = output.read_bytes()
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as exc:
                main(args)
            self.assertEqual(exc.exception.code, 2)
            self.assertEqual(output.read_bytes(), before)

    def test_cli_generate_and_apply_lut_preserves_attributes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config, raw = root/'config.json', root/'raw.csv'
            data = config_dict(Dome(), [0, 0, 0], np.eye(3))
            data['lut'] = dict(resolution_deg=10, xz_min_deg=70,
                               xz_max_deg=110, yz_min_deg=70,
                               yz_max_deg=110, interpolation='bilinear')
            config.write_text(json.dumps(data))
            raw.write_text('x,y,z,label\n0,0,5,centre\n.1,0,5,edge\n')
            lut_dir, output = root/'lut', root/'corrected.csv'
            with contextlib.redirect_stdout(io.StringIO()):
                main(['generate-lut', '--config', str(config),
                      '--resolution-deg', '10', '--output', str(lut_dir)])
                main(['correct', str(raw), '--config', str(config),
                      '--method', 'lut', '--lut', str(lut_dir/'lut.json'),
                      '--input-unit', 'm', '--output', str(output)])
            result = read_cloud(output)
            self.assertEqual([row[3] for row in result.rows], ['centre', 'edge'])
            np.testing.assert_allclose(np.linalg.norm(result.points, axis=1),
                                       np.linalg.norm([[0, 0, 5], [.1, 0, 5]], axis=1))
            report = json.loads(output.with_suffix('.csv.report.json').read_text())
            self.assertEqual(report['method'], 'lut')
            self.assertEqual(report['range_model'], 'preserve_measured_radius')

    def test_experiments_report_invalid_perturbations(self):
        from dome_correction.experiments import run_experiments
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/'run'
            manifest = run_experiments(root, Dome(thickness_m=.0005), [0, 0, 0], np.eye(3))
            self.assertLess(manifest['synthetic_plane']['optical_path']['rmse_mm'], 1e-8)
            with (root/'tables/sensitivity_detail.csv').open() as stream:
                rows = list(csv.DictReader(stream))
            self.assertTrue(any(row['status'].startswith('invalid_geometry') for row in rows))
            self.assertEqual(len(list((root/'figures').glob('*.png'))), 4)
