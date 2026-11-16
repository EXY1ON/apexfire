"""Unit tests for tools/landscape.py (What burns, slice 1)."""

import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import landscape as ls  # noqa: E402


class Tables(unittest.TestCase):
    def test_every_corine_code_maps_once(self):
        codes = [c for g in ls.GROUPS for c in g["codes"]]
        self.assertEqual(len(codes), len(set(codes)))
        self.assertEqual(len([c for c in codes if c != "995"]), 44)
        self.assertEqual(sorted(codes), sorted(c for f in ls.FIELDS for c in f["codes"]))

    def test_unknown_code_is_refused(self):
        lut = ls.code_lut(ls.GROUPS)
        ls.check_codes([0, 311, 990, 999], lut, len(ls.GROUPS))
        with self.assertRaises(ValueError):
            ls.check_codes([311, 777], lut, len(ls.GROUPS))

    def test_edition_at_or_before_year(self):
        years = (2000, 2005, 2006, 2011, 2012, 2017, 2018, 2026)
        self.assertEqual([ls.edition_for_year(y) for y in years], [2000, 2000, 2006, 2006, 2012, 2012, 2018, 2018])
        with self.assertRaises(ValueError):
            ls.edition_for_year(1999)


class Footprints(unittest.TestCase):
    lut, n = ls.code_lut(ls.GROUPS), len(ls.GROUPS)
    grid = np.array([[311, 311, 231, 231]] * 4, dtype=np.uint16)  # west half broadleaf, east half pasture; top-left (0, 400)

    def shares(self, x, y, hx, hy):
        return ls.window_shares(self.grid, 0, 400, 100, x, y, hx, hy, self.lut, self.n)

    def test_half_and_half(self):
        s = self.shares(200, 200, 200, 200)
        self.assertAlmostEqual(s[0], 0.5)
        self.assertAlmostEqual(s[4], 0.5)

    def test_small_footprint_takes_its_cell(self):
        self.assertAlmostEqual(self.shares(50, 350, 10, 10)[0], 1.0)

    def test_outside_grid_or_country_is_none(self):
        self.assertIsNone(self.shares(-500, 200, 100, 100))
        zero = np.zeros((4, 4), dtype=np.uint16)
        self.assertIsNone(ls.window_shares(zero, 0, 400, 100, 200, 200, 100, 100, self.lut, self.n))

    def test_edge_footprint_is_clipped(self):
        self.assertAlmostEqual(self.shares(0, 200, 100, 100)[0], 1.0)


class Ratios(unittest.TestCase):
    def test_ratio_is_share_over_land(self):
        np.testing.assert_allclose(ls.ratio(np.array([30.0, 10.0, 0.0]), np.array([0.25, 0.5, 0.25])), [3.0, 0.5, 0.0])

    def test_weighted_land(self):
        w = ls.weighted({2012: np.array([1.0, 0.0]), 2018: np.array([0.0, 1.0])}, {2012: 1, 2018: 3})
        np.testing.assert_allclose(w, [0.25, 0.75])


class Sinusoidal(unittest.TestCase):
    def test_round_trip(self):
        lon, lat = ls.sin_to_lonlat(*ls.lonlat_to_sin(21.75, 41.65))
        self.assertAlmostEqual(float(lon), 21.75, places=9)
        self.assertAlmostEqual(float(lat), 41.65, places=9)

    def test_country_window_inside_h19v04(self):
        r0, r1, c0, c1 = ls.sin_window()
        self.assertTrue(0 <= r0 < r1 <= 2400 and 0 <= c0 < c1 <= 2400)
        x0, y0 = ls.sin_tile_origin(19, 4)
        lon, lat = ls.sin_to_lonlat(x0 + (c0 + c1) / 2 * ls.PIXEL_M, y0 - (r0 + r1) / 2 * ls.PIXEL_M)
        self.assertTrue(20.4 < float(lon) < 23.1 and 40.8 < float(lat) < 42.5)


class Takeaways(unittest.TestCase):
    def test_templates_quote_the_numbers(self):
        starts = np.zeros(10); starts[4], starts[5] = 60, 40
        months = np.zeros((12, 10)); months[2, 5] = 7; months[7, 6] = 3
        nasa = np.zeros(10); nasa[0], nasa[4] = 300, 100
        t = ls.takeaways(starts, months, nasa, "VIIRS S-NPP", (2012, 2025), (2001, 2025))
        self.assertEqual(t[0]["text"], "Most fires start on grassland and pasture: 60% of the fire starts VIIRS S-NPP saw in 2012–2025.")
        self.assertIn("peak in March", t[1]["text"])
        self.assertEqual(t[2]["values"], {"group": "broadleaf", "pct": 75.0, "total_ha": 400})

    def test_no_majority_says_more_than_any_other(self):
        starts = np.full(10, 10.0); starts[1] = 20
        t = ls.takeaways(starts, np.ones((12, 10)), np.ones(10), "MODIS", (2001, 2025), (2001, 2025))
        self.assertTrue(t[0]["text"].startswith("More fires start on conifer forest than on any other land:"))


class Grouping(unittest.TestCase):
    def test_gap_parameter(self):
        import firelib
        dets = [{"id": "a", "t": "2020-08-01T10:00Z", "lat": 41.5, "lon": 21.5, "frp": 1},
                {"id": "b", "t": "2020-08-02T16:00Z", "lat": 41.5, "lon": 21.5, "frp": 1}]  # 30 h apart
        self.assertEqual(len(firelib.cluster(dets)), 2)
        self.assertEqual(len(firelib.cluster(dets, 48.0)), 1)


class FetchChecks(unittest.TestCase):
    def test_corine_features_must_be_coded_polygons(self):
        import fetch_landscape as fl
        poly = {"type": "Polygon", "coordinates": [[[21, 41], [21.1, 41], [21.1, 41.1], [21, 41]]]}
        fl.check_features([{"properties": {"Code_18": "311"}, "geometry": poly}], "Code_18")
        for bad in ({"properties": {"Code_18": "31"}, "geometry": poly},
                    {"properties": {"Code_18": "311"}, "geometry": {"type": "Point", "coordinates": [21, 41]}}):
            with self.assertRaises(ValueError):
                fl.check_features([bad], "Code_18")


def box(w, s, e, n):
    return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


class StartsAndBurns(unittest.TestCase):
    """Synthetic country 21-22 E, 41-42 N: broadleaf west of 21.5 E, pasture east of it."""

    @classmethod
    def setUpClass(cls):
        cls.country = box(21.0, 41.0, 22.0, 42.0)
        feats = [{"type": "Feature", "properties": {"Code_18": "311"}, "geometry": box(20.9, 40.9, 21.5, 42.1)},
                 {"type": "Feature", "properties": {"Code_18": "231"}, "geometry": box(21.5, 40.9, 22.1, 42.1)}]
        grid = ls.land_grid(feats, "Code_18", cls.country, "EPSG:3035", ls.CELL)
        cls.grids = {e: grid for e in ls.EDITIONS}

    def test_land_grid_keeps_only_the_country(self):
        grid = self.grids[2018][0]
        self.assertEqual(set(np.unique(grid)), {0, 231, 311})

    def test_start_is_classed_by_its_first_detection(self):
        from shapely.geometry import shape
        dets = [{"id": "a", "t": "2020-08-01T10:00Z", "lat": 41.5, "lon": 21.2, "frp": 5, "scan": 0.4, "track": 0.4},
                {"id": "b", "t": "2020-08-02T09:00Z", "lat": 41.505, "lon": 21.21, "frp": 5, "scan": 0.4, "track": 0.4},
                {"id": "c", "t": "2020-03-05T12:00Z", "lat": 41.5, "lon": 21.8, "frp": 5, "scan": 0.4, "track": 0.4},
                {"id": "d", "t": "2020-03-05T12:00Z", "lat": 41.5, "lon": 22.5, "frp": 5, "scan": 0.4, "track": 0.4}]
        lon, lat = [d["lon"] for d in dets], [d["lat"] for d in dets]
        x, y = ls.to_3035(lon, lat)
        inside = ls.point_test(shape(self.country))(lon, lat)
        starts = sorted(ls.starts_for(dets, x, y, inside, self.grids, 24.0), key=lambda s: s["month"])
        self.assertEqual([s["month"] for s in starts], [3, 8])  # "d" starts outside the country
        self.assertAlmostEqual(starts[0]["shares"][4], 1.0)    # pasture -> grassland and pasture
        self.assertAlmostEqual(starts[1]["shares"][0], 1.0)    # broadleaf
        self.assertAlmostEqual(starts[1]["days"], 23 / 24)

    def test_effis_fire_is_clipped_and_split_by_size(self):
        import json
        import tempfile
        from shapely.geometry import shape

        def props(i, area, year):
            return {"id": i, "COUNTRY": "MK", "FIREDATE": f"{year}-08-01 00:00:00", "FINALDATE": None, "AREA_HA": area,
                    "BROADLEA": 60, "CONIFER": 0, "MIXED": 0, "SCLEROPH": 0, "TRANSIT": 0, "OTHERNATLC": 40,
                    "AGRIAREAS": 0, "ARTIFSURF": 0, "OTHERLC": 0}
        fires = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": props(1, 100, 2020), "geometry": box(21.95, 41.4, 22.05, 41.5)},  # half outside
            {"type": "Feature", "properties": props(2, 10, 2021), "geometry": box(21.3, 41.3, 21.31, 41.31)},   # small
            {"type": "Feature", "properties": props(3, 50, 2019), "geometry": box(22.5, 41.3, 22.6, 41.4)}]}    # outside
        with tempfile.TemporaryDirectory() as tmp:
            p, a = Path(tmp) / "f.geojson", Path(tmp) / "a.json"
            p.write_text(json.dumps(fires))
            a.write_text(json.dumps([{"year": 2020, "ba": 100, "nf": 1}]))
            agg, per_ed, by_field, web, check = ls.effis_burned(p, a, shape(self.country))
        self.assertEqual(agg["years"], [2016, 2021])
        self.assertAlmostEqual(agg["all"]["by_year_field"][4][0], 30.0, delta=0.5)  # 60 % of the ~50 ha inside
        self.assertEqual(agg["ge30"]["fires"][5], 0)
        self.assertEqual([f["properties"]["small"] for f in web], [False, True])
        self.assertEqual(agg["cross_check"][4], {"year": 2020, "fires": 1, "ha": 100, "estimate_fires": 1, "estimate_ha": 100})
        self.assertEqual(len(check), 1)


if __name__ == "__main__":
    unittest.main()
