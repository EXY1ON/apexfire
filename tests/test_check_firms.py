import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from check_firms import parse_detections


HEADER = "latitude,longitude,acq_date,acq_time,satellite,confidence,frp\n"


class FirmsParsingTests(unittest.TestCase):
    def test_preserves_native_confidence_and_midnight_time(self):
        rows = parse_detections(HEADER + "41.8,21.1,2017-08-02,5,N20,l,1.2\n", "VIIRS_NOAA20_NRT")
        self.assertEqual(rows[0]["observed_utc"], "2017-08-02T00:05:00+00:00")
        self.assertEqual(rows[0]["raw"]["confidence"], "l")

    def test_rejects_body_level_errors_and_invalid_fields(self):
        for body in ["Invalid MAP_KEY", HEADER + "41.8,21.1,2017-08-02,1265,N20,n,1\n", HEADER + "41.8,21.1,2017-08-02,1200,N20,n,nan\n", HEADER + "0,0,2017-08-02,1200,N20,n,1\n"]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                parse_detections(body, "VIIRS_NOAA20_NRT")

    def test_valid_empty_csv_is_not_an_api_error(self):
        self.assertEqual(parse_detections(HEADER, "VIIRS_NOAA21_NRT"), [])


if __name__ == "__main__":
    unittest.main()
