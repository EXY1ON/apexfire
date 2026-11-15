"""Spread Lab helpers: equilibrium moisture, run encoding and summaries (no network, no engine)."""
import base64
import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location("lab", Path(__file__).resolve().parents[1] / "tools/run_spread_lab.py")
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)


class LabChecks(unittest.TestCase):
    def test_emc_ranges(self):
        # 30 °C = 86 °F; RH 30 % uses the 10-50 % Simard form.
        self.assertAlmostEqual(float(lab.emc_percent(30, 30)), 2.22749 + 0.160107 * 30 - 0.014784 * 86, places=6)
        # Drier air and heat lower the equilibrium moisture; humid air raises it.
        self.assertLess(float(lab.emc_percent(35, 15)), float(lab.emc_percent(20, 40)))
        self.assertGreater(float(lab.emc_percent(15, 90)), 15)
        m = lab.weather_moisture(np.array([30.]), np.array([30.]), np.array([5.]))
        self.assertAlmostEqual(float(m["fuel_moisture_dead_1hr"][0]), 1.03 * float(lab.emc_percent(30, 30)) / 100, places=6)

    def test_encode_round_trip_and_summary(self):
        a = np.full((20, 20), np.nan, dtype="float32")
        a[10, 10], a[10, 11], a[10, 12], a[11, 10] = 0, 6, 61, 400  # last one is past the horizon
        fl = np.zeros_like(a)
        fl[10, 12] = 2.5
        layers = {"time_of_arrival": a, "flame_length": fl, "spread_rate": np.ones_like(a)}
        cell = lab.encode(layers, 360, None, 2)
        self.assertEqual(cell["w"], [10, 10, 1, 3])
        self.assertEqual(list(base64.b64decode(cell["a"])), [0, 3, 30])
        self.assertEqual(list(base64.b64decode(cell["f"])), [0, 0, 25])
        site = dict(rows=20, cols=20)
        s = lab.summarize(site, (10, 10), layers, 360)
        self.assertEqual(s["final_ha"], 3)
        self.assertEqual(s["area_ha"][:2], [2, 2])  # 30 and 60 min
        self.assertEqual(s["run_bearing"], 90)  # farthest cell lies due east
        self.assertIsNone(s["edge_minute"])


if __name__ == "__main__":
    unittest.main()
