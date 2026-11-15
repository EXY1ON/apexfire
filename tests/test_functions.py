"""Checks for the scheduled ingestion function (functions/main.py) without cloud access."""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "functions"))
import main  # noqa: E402
import mkffis  # noqa: E402

HDR = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n"


class Ingestion(unittest.TestCase):
    def test_copy_of_grouping_code_matches_source(self):
        self.assertEqual((ROOT / "functions" / "firelib.py").read_text(), (ROOT / "tools" / "firelib.py").read_text())

    def test_parse_rejects_html_and_bad_times(self):
        with self.assertRaises(ValueError):
            main.parse("<html>quota</html>", "VIIRS_NOAA20_NRT")
        with self.assertRaises(ValueError):
            main.parse(HDR + "41.5,21.5,330,0.4,0.4,2026-11-14,1275,N20,VIIRS,n,2.0NRT,290,3.1,D\n", "VIIRS_NOAA20_NRT")
        rows = main.parse(HDR + "41.5,21.5,330,0.4,0.4,2026-11-14,32,N20,VIIRS,n,2.0NRT,290,3.1,N\n", "VIIRS_NOAA20_NRT")
        self.assertEqual(rows[0]["t"], "2026-11-14T00:32Z")

    def test_snapshot_groups_dedupes_and_flags_country(self):
        now = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
        row = HDR + "41.5,21.5,330,0.4,0.4,2026-11-14,0032,N20,VIIRS,n,2.0NRT,290,3.1,N\n" + "42.6,20.6,330,0.4,0.4,2026-11-14,0032,N20,VIIRS,n,2.0NRT,290,3.1,N\n"
        snap = main.build_snapshot(lambda product, days, date: row if product == "VIIRS_NOAA20_NRT" else HDR, now)
        self.assertEqual(len(snap["detections"]), 2)  # the same rows returned by both requests are kept once
        self.assertEqual([d["inside"] for d in snap["detections"]], [True, False])  # central MK vs Kosovo-side point
        self.assertEqual(len(snap["fires"]), 2)
        self.assertEqual(snap["delivery"], "live")



# The exact queries the website sends (web/src/lib/mkffis.ts): a tile after MapLibre fills {bbox-epsg-3857}, a 1 px probe, a legend.
TILE = [("service", "WMS"), ("version", "1.1.1"), ("request", "GetMap"), ("layers", "fwibeta:fwi20240815_tif"), ("styles", ""), ("srs", "EPSG:3857"),
        ("width", "256"), ("height", "256"), ("format", "image/png"), ("transparent", "true"), ("bbox", "2348145.5,5009377.1,2504688.5,5165920.1")]
PROBE = [("service", "WMS"), ("version", "1.1.1"), ("request", "GetMap"), ("layers", "VDM:VDM_20261109_20261116_tif"), ("styles", ""),
         ("srs", "EPSG:4326"), ("bbox", "20,40.5,23.5,42.5"), ("width", "1"), ("height", "1"), ("format", "image/png")]
LEGEND = [("service", "WMS"), ("version", "1.1.1"), ("request", "GetLegendGraphic"), ("layer", "fwibeta:fwi20261115_tif"), ("format", "image/png")]


class FakeUpstream:
    """Stands in for urllib.request.urlopen; records the URL it was asked for."""
    def __init__(self, body, kind):
        self.body, self.kind, self.url = body, kind, None

    def __call__(self, req, timeout):
        self.url = req.full_url
        outer = self

        class R:
            headers = {"Content-Type": outer.kind}
            def read(self, n): return outer.body[:n]
            def __enter__(self): return self
            def __exit__(self, *a): return False
        return R()


class MkffisProxy(unittest.TestCase):
    def test_accepts_exactly_what_the_site_sends(self):
        for q in (TILE, PROBE, LEGEND):
            mkffis.validate(q)
        self.assertEqual(mkffis.validate([(k.upper(), v) for k, v in LEGEND])["layer"], "fwibeta:fwi20261115_tif")  # names are case-insensitive

    def test_rejects_everything_else(self):
        bad = [
            [*LEGEND[:2], ("request", "GetCapabilities")],
            [*LEGEND[:2], ("request", "GetFeatureInfo"), *LEGEND[3:]],
            [*TILE, ("cql_filter", "1=1")],                                   # extra parameter
            [*TILE, ("layers", "fwibeta:fwi20240816_tif")],                    # repeated
            [p if p[0] != "layers" else ("layers", "Makedonija:FFHistory") for p in TILE],          # other layer
            [p if p[0] != "layers" else ("layers", "fwibeta:fwi20240815_tif,VDM:x") for p in TILE],  # several layers
            [p if p[0] != "format" else ("format", "application/json") for p in TILE],
            [p if p[0] != "styles" else ("styles", "raster") for p in TILE],
            [p if p[0] != "width" else ("width", "4096") for p in TILE],
            [p if p[0] != "bbox" else ("bbox", "0,0,1000,1000") for p in TILE],                     # far from North Macedonia
            [p if p[0] != "bbox" else ("bbox", "nan,1,2,3") for p in TILE],
            [p if p[0] != "srs" else ("srs", "EPSG:32634") for p in TILE],
            [p for p in TILE if p[0] != "bbox"],                                                      # missing
        ]
        for q in bad:
            with self.subTest(q=q), self.assertRaises(mkffis.Rejected):
                mkffis.validate(q)

    def test_rebuilds_the_query_and_relays_only_png(self):
        up = FakeUpstream(mkffis.PNG + b"rest", "image/png")
        status, body, headers = mkffis.handle("GET", TILE, up)
        self.assertEqual((status, headers["Content-Type"]), (200, "image/png"))
        self.assertTrue(up.url.startswith(mkffis.UPSTREAM + "?service=WMS&version=1.1.1&request=GetMap&layers=fwibeta%3Afwi20240815_tif"))
        self.assertIn("max-age=86400", headers["Cache-Control"])  # a past day's map is settled
        xml = FakeUpstream(b"<?xml version='1.0'?><ServiceExceptionReport/>", "application/vnd.ogc.se_xml")
        self.assertEqual(mkffis.handle("GET", PROBE, xml)[0], 404)  # unknown layer: no XML relayed
        fake_png = FakeUpstream(b"<svg/>", "image/png")
        self.assertEqual(mkffis.handle("GET", LEGEND, fake_png)[0], 404)  # content type alone is not trusted
        self.assertEqual(mkffis.handle("POST", LEGEND, up)[0], 405)
        self.assertEqual(mkffis.handle("GET", [("request", "GetCapabilities")], up)[0], 400)

    def test_recent_maps_are_cached_briefly(self):
        from datetime import date
        q = mkffis.validate(LEGEND)
        self.assertIn("s-maxage=1800", mkffis.cache_control(q, today=date(2026, 11, 15)))
        self.assertIn("s-maxage=604800", mkffis.cache_control(q, today=date(2026, 11, 20)))


if __name__ == "__main__":
    unittest.main()
