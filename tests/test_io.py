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

    def test_empty_csv_has_clear_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"empty.csv"
            path.write_text("")
            with self.assertRaisesRegex(ValueError, "empty"):
                read_cloud(path)
            path.write_text("x,y,z\n")
            self.assertEqual(read_cloud(path).points.shape, (0, 3))

    def test_pcd_whitespace_and_header_case(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp)/"raw.pcd", Path(tmp)/"out.pcd"
            src.write_text('fields\tx y z\nsize 4 4 4\ntype F F F\nwidth 1\nheight 1\npoints 1\ndata ascii\n1 2 5\n')
            cloud = read_cloud(src)
            write_cloud(dst, cloud, [[3, 4, 6]])
            np.testing.assert_array_equal(read_cloud(dst).points, [[3, 4, 6]])

    def test_malformed_pcd_headers_are_rejected(self):
        header = 'FIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nWIDTH 1\nHEIGHT 1\nPOINTS 1\nDATA ascii\n1 2 5\n'
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"bad.pcd"
            for bad in (header.replace('SIZE 4 4 4\n', ''),
                        header.replace('POINTS 1', 'POINTS'),
                        header.replace('SIZE 4 4 4', 'SIZE 3 4 4')):
                path.write_text(bad)
                with self.assertRaises(ValueError):
                    read_cloud(path)
