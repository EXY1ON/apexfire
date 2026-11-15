"""Behavior checks for scenario orientation, forcing, barriers, and export geometry."""
import importlib.util
from pathlib import Path
import unittest
from datetime import datetime, timezone

import numpy as np
from rasterio.transform import from_origin
from shapely.geometry import shape

spec = importlib.util.spec_from_file_location("scenario", Path(__file__).resolve().parents[1]/"tools/run_spread_scenario.py")
scenario = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scenario)


class SpreadChecks(unittest.TestCase):
    def test_real_engine_sensitivity_and_barrier(self):
        scenario.controlled_checks()

    def test_slope_aspect_and_north_up_export(self):
        # East-rising terrain has west-facing aspect; north-rising has south-facing aspect.
        north, east = np.mgrid[:5, :5]
        slope, aspect = scenario.terrain_fields(east.astype("float32")*10, 100)
        np.testing.assert_allclose(slope, .1)
        np.testing.assert_allclose(aspect, 270)
        _, aspect = scenario.terrain_fields(north.astype("float32")*10, 100)
        np.testing.assert_allclose(aspect, 180)
        arrival = np.full((3, 3), np.nan, dtype="float32")
        arrival[0, 1] = 0
        arrival[1, 1] = 20
        profile = dict(transform=from_origin(500000, 4600000, 100, 100), crs="EPSG:32634")
        result = scenario.perimeters(arrival, profile, datetime(2024, 9, 2, 12, tzinfo=timezone.utc), [0, 30])
        self.assertEqual([f["properties"]["burned_area_ha"] for f in result["features"]], [1., 2.])
        first, second = [shape(f["geometry"]) for f in result["features"]]
        self.assertTrue(first.is_valid and second.is_valid)
        self.assertGreater(first.intersection(second).area/first.area, .99999)
        self.assertGreater(first.centroid.y, second.centroid.y)
        self.assertEqual(result["features"][1]["properties"]["valid_time_utc"], "2024-09-02T12:30:00+00:00")

    def test_invalid_fuel_and_nonburnable_ignition_rejected(self):
        for model in (0, 98, 999):
            with self.assertRaises(ValueError):
                scenario.propagate(np.full((5,5), model), np.zeros((5,5)), np.zeros((5,5)), [0], [0], (2,2))


if __name__ == "__main__":
    unittest.main()
