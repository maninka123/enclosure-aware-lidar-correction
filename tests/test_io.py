import tempfile
import unittest
from pathlib import Path
import numpy as np
from dome_correction.cloud_io import read_cloud, write_cloud


class IOTests(unittest.TestCase):
    def test_csv_metadata_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp)/"raw.csv", Path(tmp)/"corrected.csv"
            src.write_text('intensity,z,x,y,time\n42,5,1,2,1234567890123456789\n', encoding="utf-8")
            cloud = read_cloud(src)
            np.testing.assert_array_equal(cloud.points, [[1, 2, 5]])
            write_cloud(dst, cloud, np.array([[3, 4, 6]]))
            self.assertIn("42,6,3,4,1234567890123456789", dst.read_text())

    def test_ascii_pcd_vector_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp)/"raw.pcd", Path(tmp)/"corrected.pcd"
            src.write_text('VERSION .7\nFIELDS normal x y z intensity\nSIZE 4 4 4 4 4\nTYPE F F F F U\nCOUNT 3 1 1 1 1\nWIDTH 1\nHEIGHT 1\nPOINTS 1\nDATA ascii\n0 0 1 1 2 5 42\n')
            cloud = read_cloud(src)
            write_cloud(dst, cloud, np.array([[3, 4, 6]]))
            result = read_cloud(dst)
            np.testing.assert_array_equal(result.points, [[3, 4, 6]])
            self.assertEqual(result.rows[0][:3], ["0", "0", "1"])
            self.assertEqual(result.rows[0][-1], "42")
            self.assertIn("SIZE 4 8 8 8 4", dst.read_text())

    def test_binary_pcd_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"raw.pcd"
            path.write_bytes(b'DATA binary\n\x00\x01')
            with self.assertRaisesRegex(ValueError, "ASCII"):
                read_cloud(path)
