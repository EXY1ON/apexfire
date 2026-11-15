import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from audit_data import archive_paths


class ArchiveScopeTest(unittest.TestCase):
    def test_new_weather_and_model_csvs_do_not_enter_sensor_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            names = ["modis-2/2025/modis_2025_Test.csv", "viirs-jpss1/2025/viirs-jpss1_2025_Test.csv", "viirs-snpp/2025/viirs-snpp_2025_Test.csv", "readiness/weather/hourly.csv", "reference/progression/steps.csv", "case-studies/fire/summary.csv"]
            for name in names:
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text("test\n")
            self.assertEqual({str(p.relative_to(root)) for p in archive_paths(root)}, set(names[:3]))


if __name__ == "__main__":
    unittest.main()
