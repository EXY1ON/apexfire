"""Checks for tools/export_web_data.py: parser self-test and generated public-data contracts."""

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data"
sys.path.insert(0, str(ROOT / "tools"))
import export_web_data as ex  # noqa: E402


class ExportParsing(unittest.TestCase):
    def test_self_test(self):
        ex.self_test()

    def test_leading_zero_and_invalid_minutes(self):
        self.assertEqual(ex.utc_time("2024-09-04", "7"), "2024-09-04T00:07Z")
        with self.assertRaises(ValueError):
            ex.utc_time("2024-09-04", "0775")


@unittest.skipUnless((OUT / "catalog.json").exists(), "run the export first")
class GeneratedData(unittest.TestCase):
    def test_counts_reconcile_with_inventory(self):
        cat = json.loads((OUT / "catalog.json").read_text())
        archive = [f for f in cat["history"]["files"] if f["origin"] == "archive"]
        self.assertEqual(cat["history"]["archive_records"], 47046)
        self.assertEqual(len(archive), 35)
        inventory = {Path(r["path"]).name: r for r in ex.select_mk_files()}
        for f in archive:
            inv = inventory[f["source_file"]]
            self.assertEqual(f["source_sha256"], inv["sha256"])
            self.assertEqual(f["records"], int(inv["records"]))

    def test_landscape(self):
        land = OUT / "landscape"
        doc = json.loads((land / "what-burns.json").read_text())
        self.assertEqual(doc["schema"], "firewatch.landscape.v1")
        self.assertEqual({s: v["years"] for s, v in doc["starts"].items()},
                         {"viirs-snpp": [2012, 2025], "modis": [2001, 2025], "viirs-jpss1": [2018, 2025]})
        self.assertEqual((doc["nasa"]["years"], len(doc["nasa"]["by_year_group"]), doc["nasa"]["months"]), ([2001, 2025], 25, 300))
        self.assertEqual(doc["effis"]["years"][0], 2016)
        row = next(r for r in doc["effis"]["cross_check"] if r["year"] == 2025)
        self.assertEqual((row["fires"], row["ha"]), (82, 31338))  # EFFIS's own 2025 statistics, verified 16 Nov 2026
        burned = json.loads((land / "burned-areas.geojson").read_text())
        story = json.loads((OUT / "stories" / "fires" / "cesinovo-2016.json").read_text())
        ces = next(f for f in burned["features"] if f["properties"]["id"] == "10145")
        self.assertEqual(ces["properties"]["agricultural"], story["official"]["landcover_pct"]["agricultural"])
        self.assertEqual(ces["properties"]["agricultural"], 77.4)
        for name, limit in {"what-burns.json": 200_000, "landcover-mk.png": 700_000, "burned-areas.geojson": 1_500_000}.items():
            self.assertLessEqual((land / name).stat().st_size, limit, name)
        self.assertEqual(len(doc["takeaways"]), 3)

    def test_fire_stories(self):
        fires = OUT / "stories" / "fires"
        index = json.loads((fires / "index.json").read_text())
        self.assertEqual(index["schema"], "firewatch.story.fire.index.v1")
        self.assertEqual({p.stem for p in fires.glob("*.json")} - {"index"}, {e["id"] for e in index["stories"]})
        self.assertGreaterEqual(len(index["stories"]), 6)
        for e in index["stories"]:
            d = json.loads((fires / f"{e['id']}.json").read_text())
            with self.subTest(story=e["id"]):
                self.assertEqual(d["schema"], "firewatch.story.fire.v1")
                for k in ("title", "place", "place_mk", "municipality", "year", "center"):
                    self.assertEqual(d[k], e[k])
                self.assertEqual((d["window"]["start"], d["window"]["end"]), (e["start"], e["end"]))
                self.assertEqual(len(d["detections"]), e["detections"])
                self.assertEqual(sum(x["detections"] for x in d["days"]), len(d["detections"]))
                start, end = d["window"]["start"], d["window"]["end"]
                self.assertLessEqual(len(d["days"]), 21)
                self.assertEqual((d["days"][0]["date"], d["days"][-1]["date"]), (start, end))
                self.assertTrue(all(start <= x["t"][:10] <= end for x in d["detections"]))
                h = d["weather"]["hourly"]
                self.assertEqual(len(h["time"]), 24 * len(d["days"]))
                self.assertTrue(all(len(v) == len(h["time"]) for v in h.values()))
                self.assertEqual((h["time"][0], h["time"][-1]), (f"{start}T00:00Z", f"{end}T23:00Z"))
                noon = [n["date"] for n in d["weather"]["noon"]]
                self.assertEqual(len(noon), 60 + len(d["days"]))
                self.assertEqual(noon[-len(d["days"]):], [x["date"] for x in d["days"]])
                self.assertLess((fires / f"{e['id']}.json").stat().st_size, 400_000)

    def test_public_output_has_no_private_material(self):
        allowed = {".json", ".geojson", ".jpg", ".png", ".txt"}
        for p in OUT.rglob("*"):
            if p.is_file():
                self.assertIn(p.suffix, allowed, p)
                if p.suffix not in (".jpg", ".png"):
                    text = p.read_text(encoding="utf-8")
                    self.assertNotIn("Token-and-key", text)
                    self.assertNotIn("/Users/", text)
                    self.assertNotIn("project-state", text)


if __name__ == "__main__":
    unittest.main()
