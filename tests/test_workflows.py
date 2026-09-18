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
