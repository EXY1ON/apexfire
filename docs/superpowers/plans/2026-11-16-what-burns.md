# What burns in North Macedonia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/landscape` page and its land-cover and burned-area layers. It shows what catches fire and when, what fire destroys, and what spreads in North Macedonia, from CORINE, EFFIS, NASA MCD64A1 and the FIRMS archive.

**Architecture:**
- Offline Python fetch tools cache the raw inputs in `Data/readiness/landscape/`.
- `tools/landscape.py` turns them into three static web files. `tools/export_web_data.py` calls it.
- The React page and two map hooks read those files: one validated JSON, one PNG and one GeoJSON.
- Nothing new runs at request time.

**Tech Stack:**
- Python 3.15 `.venv`: numpy, shapely, rasterio, Pillow (already installed).
- `uv run --python 3.14` with pyhdf, for NASA HDF4 only (D26).
- React 19, TypeScript, Vite 8, MapLibre 6, Vitest; unittest for Python.

**Spec:** [docs/superpowers/specs/2026-11-16-what-burns-design.md](../specs/2026-11-16-what-burns-design.md). Decisions are cited as D1–D26.

**Ground rules for every task:**
- Run Python as `.venv/bin/python` from the repository root; run web commands from `web/`.
- Never print or log the credential file or the Earthdata bearer.
- Commit after each task with the message given. Do not push until Task 17.
- End every commit message with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
| --- | --- |
| `tools/landscape.py` (new) | Land-cover tables (10 groups, 9 EFFIS fields), pure helpers (footprint shares, ratios, sinusoidal maths, takeaways), and `export()` |
| `tools/fetch_landscape.py` (new) | Download CORINE 2000/2006/2012/2018, EFFIS burned areas and annual estimates, with a manifest |
| `tools/fetch_mcd64a1.py` (new) | uv script: list MCD64A1 h19v04 granules in CMR, download from LP DAAC, crop to MK, keep ID and SHA-256, delete the HDF |
| `tools/firelib.py` | `cluster()` gains an optional time gap (default unchanged) for the 48 h check |
| `tools/export_web_data.py` | Calls `landscape.export()` before the catalog |
| `tests/test_landscape.py` (new) | Unit tests for tables, helpers, fire starts and EFFIS clipping |
| `tests/test_export_web_data.py` | Generated-data contracts for the three landscape files |
| `web/scripts/check-dist.mjs` | Allow `data/**/*.png` |
| `web/src/lib/history.ts` | Export `csvCell` |
| `web/src/lib/landscape.ts` (+ `.test.ts`) (new) | Types, validator, helpers, CSV builder |
| `web/src/components/StackedBars.tsx` (new) | Stacked bar chart and series legend (inline SVG) |
| `web/src/components/LandscapeLayers.tsx` (new) | `useLandCover`, `useBurnedLayer`, land-cover legend |
| `web/src/pages/Landscape.tsx` (new) | The page (D20 order) |
| `web/src/styles.css` | Share bars and chart legend |
| `web/src/App.tsx`, `firebase.json` | Route, navigation, title, hosting rewrite |
| `web/src/pages/Now.tsx`, `web/src/pages/Explore.tsx` | Land-cover layer; burned-area layer in Archive (D9, D22) |
| `web/src/pages/DataMethods.tsx`, `README.md`, `docs/website-spec.md`, `PROJECT.md` | Sources, features, screen entry, state and re-export routine |

---

### Task 1: Land-cover tables and pure helpers

**Files:**
- Create: `tools/landscape.py`
- Test: `tests/test_landscape.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_landscape.py`:

```python
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


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `.venv/bin/python -m unittest tests/test_landscape.py`
Expected: ERROR, `ModuleNotFoundError: No module named 'landscape'`.

- [ ] **Step 3: Write the module**

Create `tools/landscape.py`:

```python
"""What burns in North Macedonia: land-cover tables, footprint shares and the /landscape export.

Design: docs/superpowers/specs/2026-11-16-what-burns-design.md (decisions D1-D26).
Everything above the export section needs only numpy, so tools/fetch_mcd64a1.py can import it under uv;
export() also needs rasterio, shapely and Pillow from the project .venv.
"""

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

BBOX = (20.4, 40.8, 23.1, 42.5)  # west, south, east, north: the country plus a margin
EDITIONS = (2000, 2006, 2012, 2018)
CORINE_FIELD = {2000: "code_00", 2006: "Code_06", 2012: "Code_12", 2018: "Code_18"}
NOT_CLASSIFIED = (0, 990, 999)  # outside the country, unclassified land, no data
URBAN = ["111", "112", "121", "122", "123", "124", "131", "132", "133", "141", "142"]
FARMLAND = ["211", "212", "213", "221", "222", "223", "231", "241", "242", "243", "244"]
WATER = ["411", "412", "421", "422", "423", "511", "512", "521", "522", "523", "995"]

# Ten chart groups (D8). Colours are checked with the dataviz skill in Task 11.
GROUPS = [
    {"id": "broadleaf", "label": "Broadleaf forest", "color": "#5fae45", "codes": ["311"]},
    {"id": "conifer", "label": "Conifer forest", "color": "#1f6f4a", "codes": ["312"]},
    {"id": "mixed", "label": "Mixed forest", "color": "#3d9a74", "codes": ["313"]},
    {"id": "shrub", "label": "Shrubland and young woodland", "color": "#a3c25a", "codes": ["322", "323", "324"]},
    {"id": "grass", "label": "Grassland and pasture", "color": "#d8cf6a", "codes": ["231", "321"]},
    {"id": "arable", "label": "Arable land", "color": "#f0b44c", "codes": ["211", "212", "213"]},
    {"id": "orchards", "label": "Orchards, vineyards and mixed farming", "color": "#c27a3a",
     "codes": ["221", "222", "223", "241", "242", "243", "244"]},
    {"id": "sparse", "label": "Sparse, bare and burnt", "color": "#bcae9e", "codes": ["331", "332", "333", "334", "335"]},
    {"id": "urban", "label": "Urban and industrial", "color": "#8d8d94", "codes": URBAN},
    {"id": "water", "label": "Water and wetland", "color": "#4b8fc4", "codes": WATER},
]
# EFFIS per-fire land-cover fields. The code lists are inferred from the field names; export() checks them
# against EFFIS's own shares (check_field_mapping) and stops if they disagree by more than 5 points.
FIELDS = [
    {"prop": "BROADLEA", "id": "broadleaf", "label": "Broadleaf forest", "color": "#5fae45", "codes": ["311"]},
    {"prop": "CONIFER", "id": "conifer", "label": "Conifer forest", "color": "#1f6f4a", "codes": ["312"]},
    {"prop": "MIXED", "id": "mixed", "label": "Mixed forest", "color": "#3d9a74", "codes": ["313"]},
    {"prop": "SCLEROPH", "id": "sclerophyll", "label": "Sclerophyllous scrub", "color": "#8aa84a", "codes": ["323"]},
    {"prop": "TRANSIT", "id": "transitional", "label": "Transitional woodland-shrub", "color": "#b5cf6b", "codes": ["324"]},
    {"prop": "OTHERNATLC", "id": "other_natural", "label": "Other natural land", "color": "#d8cf6a",
     "codes": ["321", "322", "331", "332", "333", "334", "335"]},
    {"prop": "AGRIAREAS", "id": "agricultural", "label": "Agricultural land", "color": "#f0b44c", "codes": FARMLAND},
    {"prop": "ARTIFSURF", "id": "artificial", "label": "Artificial surfaces", "color": "#8d8d94", "codes": URBAN},
    {"prop": "OTHERLC", "id": "other", "label": "Water, wetland and other", "color": "#4b8fc4", "codes": WATER},
]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
FARM_GROUPS = ("arable", "orchards")

# MODIS sinusoidal grid (MCD64A1 500 m)
R_SIN = 6371007.181
TILE_M = 1111950.5197665
PIXEL_M = TILE_M / 2400
PIXEL_HA = PIXEL_M ** 2 / 1e4


def code_lut(table):
    """Array mapping an integer CORINE code (0-999) to its row in table; len(table) marks 'not classified'."""
    lut = np.full(1000, len(table), dtype=np.int16)
    for i, row in enumerate(table):
        for code in row["codes"]:
            if lut[int(code)] != len(table):
                raise ValueError(f"CORINE code {code} is in two rows")
            lut[int(code)] = i
    return lut


def check_codes(present, lut, n):
    """Every CORINE code found in a grid must belong to a row (D8); 0, 990 and 999 mean no land cover."""
    unknown = sorted(int(c) for c in present if int(c) not in NOT_CLASSIFIED and lut[int(c)] == n)
    if unknown:
        raise ValueError(f"CORINE codes without a land-cover row: {unknown}")


def edition_for_year(year):
    """CORINE edition at or before the fire's year (D3)."""
    if year < EDITIONS[0]:
        raise ValueError(f"No CORINE edition before {EDITIONS[0]}")
    return max(e for e in EDITIONS if e <= year)


def window_shares(grid, left, top, cell, x, y, half_x, half_y, lut, n):
    """Fractional row shares of the grid cells under a centred rectangle (a pixel footprint), or None when no cell
    under it is classified. grid holds integer CORINE codes (0 outside the country), north-up, square cells."""
    rows, cols = grid.shape
    c0, c1 = math.floor((x - half_x - left) / cell), math.ceil((x + half_x - left) / cell)
    r0, r1 = math.floor((top - y - half_y) / cell), math.ceil((top - y + half_y) / cell)
    c1, r1 = max(c1, c0 + 1), max(r1, r0 + 1)
    if c1 <= 0 or r1 <= 0 or c0 >= cols or r0 >= rows:
        return None
    block = grid[max(r0, 0):min(r1, rows), max(c0, 0):min(c1, cols)]
    counts = np.bincount(lut[block].ravel(), minlength=n + 1)[:n]
    total = counts.sum()
    return counts / total if total else None


def weighted(land, weights):
    """Land shares averaged over CORINE editions, weighted by how much each edition period contributes."""
    total = sum(weights.values())
    if not total:
        raise ValueError("No weight for any CORINE edition")
    return sum(land[e] * w for e, w in weights.items()) / total


def ratio(part, land):
    """Share of fire (starts or burned area) divided by share of land, per row (D10); rows without land get 0."""
    share = part / part.sum() if part.sum() else np.zeros_like(part, dtype=float)
    return np.where(land > 0, share / np.where(land > 0, land, 1), 0.0)


def sin_tile_origin(h, v):
    """Upper-left corner of MODIS tile h/v in sinusoidal metres."""
    return -20015109.354 + h * TILE_M, 10007554.677 - v * TILE_M


def lonlat_to_sin(lon, lat):
    lat_r = np.radians(lat)
    return R_SIN * np.radians(lon) * np.cos(lat_r), R_SIN * lat_r


def sin_to_lonlat(x, y):
    lat_r = np.asarray(y, dtype=float) / R_SIN
    return np.degrees(np.asarray(x, dtype=float) / (R_SIN * np.cos(lat_r))), np.degrees(lat_r)


def sin_window(bbox=BBOX, h=19, v=4):
    """Row/column range of tile h/v covering a lon/lat box east of Greenwich (x shrinks as latitude grows)."""
    w, s, e, n = bbox
    x0, y0 = sin_tile_origin(h, v)
    xs = [float(lonlat_to_sin(lon, lat)[0]) for lon in (w, e) for lat in (s, n)]
    c0, c1 = math.floor((min(xs) - x0) / PIXEL_M), math.ceil((max(xs) - x0) / PIXEL_M)
    r0 = math.floor((y0 - float(lonlat_to_sin(0, n)[1])) / PIXEL_M)
    r1 = math.ceil((y0 - float(lonlat_to_sin(0, s)[1])) / PIXEL_M)
    if not (0 <= c0 < c1 <= 2400 and 0 <= r0 < r1 <= 2400):
        raise ValueError("Box is not inside the tile")
    return r0, r1, c0, c1


def takeaways(starts_by_group, avg_month_group, nasa_by_group, sensor_label, start_years, nasa_years):
    """Three Simple-mode sentences filled from the exported numbers by fixed templates (D18)."""
    ids, labels = [g["id"] for g in GROUPS], [g["label"] for g in GROUPS]
    top = int(np.argmax(starts_by_group))
    top_pct = 100 * float(starts_by_group[top]) / float(starts_by_group.sum())
    farm = avg_month_group[:, [ids.index(f) for f in FARM_GROUPS]].sum(axis=1)
    peak = int(np.argmax(farm))
    burn = int(np.argmax(nasa_by_group))
    burn_total = float(nasa_by_group.sum())
    burn_pct = 100 * float(nasa_by_group[burn]) / burn_total
    lead, tail = ("Most fires start", "") if top_pct >= 50 else ("More fires start", " than on any other land")
    return [
        {"id": "starts", "values": {"group": ids[top], "pct": round(top_pct, 1)},
         "text": f"{lead} on {labels[top].lower()}{tail}: {top_pct:.0f}% of the fire starts {sensor_label} saw in {start_years[0]}–{start_years[1]}."},
        {"id": "farm_peak", "values": {"month": peak + 1, "starts": round(float(farm[peak]), 1)},
         "text": f"Fires on farmland peak in {MONTHS[peak]}: about {farm[peak]:.0f} fire starts on arable land, orchards and vineyards in an average {MONTHS[peak]}."},
        {"id": "burned", "values": {"group": ids[burn], "pct": round(burn_pct, 1), "total_ha": round(burn_total)},
         "text": f"{labels[burn]} lost the most area: {burn_pct:.0f}% of the {burn_total:,.0f} ha NASA mapped as burned in {nasa_years[0]}–{nasa_years[1]}."},
    ]
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `.venv/bin/python -m unittest tests/test_landscape.py`
Expected: `Ran 13 tests` … `OK`.

- [ ] **Step 5: Commit**

```bash
git add tools/landscape.py tests/test_landscape.py
git commit -m "Landscape: land-cover tables and footprint helpers"
```

---

### Task 2: Optional time gap in fire grouping

**Files:**
- Modify: `tools/firelib.py:25` (signature) and `:44` (comparison)
- Test: `tests/test_landscape.py`

- [ ] **Step 1: Write the failing test** — append to `tests/test_landscape.py` above `if __name__`:

```python
class Grouping(unittest.TestCase):
    def test_gap_parameter(self):
        import firelib
        dets = [{"id": "a", "t": "2020-08-01T10:00Z", "lat": 41.5, "lon": 21.5, "frp": 1},
                {"id": "b", "t": "2020-08-02T16:00Z", "lat": 41.5, "lon": 21.5, "frp": 1}]  # 30 h apart
        self.assertEqual(len(firelib.cluster(dets)), 2)
        self.assertEqual(len(firelib.cluster(dets, 48.0)), 1)
```

- [ ] **Step 2: Run it to see it fail**

Run: `.venv/bin/python -m unittest tests.test_landscape.Grouping`
Expected: `TypeError: cluster() takes 1 positional argument but 2 were given`.

- [ ] **Step 3: Implement**

In `tools/firelib.py` change `def cluster(dets):` to:

```python
def cluster(dets, gap_hours=LINK_HOURS):
    """dets: dicts with lat, lon, t (ISO UTC), frp, sensor, id. Returns lists of member indices; gap_hours defaults to the site rule."""
```

and in the inner comparison replace `abs(hours[i] - hours[j]) <= LINK_HOURS` with `abs(hours[i] - hours[j]) <= gap_hours`.

- [ ] **Step 4: Run the landscape and functions tests**

Run: `.venv/bin/python -m unittest tests/test_landscape.py && functions/venv/bin/python -m unittest tests/test_functions.py`
Expected: both `OK` (the function copy of firelib is refreshed by the next export; its default is unchanged).

- [ ] **Step 5: Commit**

```bash
git add tools/firelib.py tests/test_landscape.py
git commit -m "firelib: optional time gap for the 48-hour sensitivity check"
```

---

### Task 3: Fetch CORINE and EFFIS

**Files:**
- Create: `tools/fetch_landscape.py`
- Test: `tests/test_landscape.py`

- [ ] **Step 1: Write the failing test** — append:

```python
class FetchChecks(unittest.TestCase):
    def test_corine_features_must_be_coded_polygons(self):
        import fetch_landscape as fl
        poly = {"type": "Polygon", "coordinates": [[[21, 41], [21.1, 41], [21.1, 41.1], [21, 41]]]}
        fl.check_features([{"properties": {"Code_18": "311"}, "geometry": poly}], "Code_18")
        for bad in ({"properties": {"Code_18": "31"}, "geometry": poly},
                    {"properties": {"Code_18": "311"}, "geometry": {"type": "Point", "coordinates": [21, 41]}}):
            with self.assertRaises(ValueError):
                fl.check_features([bad], "Code_18")
```

- [ ] **Step 2: Run it to see it fail**

Run: `.venv/bin/python -m unittest tests.test_landscape.FetchChecks`
Expected: `ModuleNotFoundError: No module named 'fetch_landscape'`.

- [ ] **Step 3: Write the tool**

Create `tools/fetch_landscape.py`:

```python
"""Fetch CORINE Land Cover 2000-2018 and EFFIS burned areas for North Macedonia (What burns, slice 1).

    .venv/bin/python tools/fetch_landscape.py

Writes Data/readiness/landscape/: corine-{2000,2006,2012,2018}.geojson, effis-burned-areas.geojson,
effis-annual.json and manifest.json (URL, SHA-256, bytes, retrieval time). No account is needed.
NASA burned area comes separately from tools/fetch_mcd64a1.py.
"""

import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from landscape import BBOX, CORINE_FIELD, EDITIONS  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "Data" / "readiness" / "landscape"
UA = "ApexFire data preparation (+https://apexfire.web.app)"
EEA = "https://image.discomap.eea.europa.eu/arcgis/rest/services/Corine/CLC{year}_WM/MapServer/0/query"
EFFIS_WFS = ("https://maps.effis.emergency.copernicus.eu/effis?service=WFS&version=2.0.0&request=GetFeature"
             f"&typeNames=ms:modis.ba.poly&srsName=EPSG:4326&bbox={BBOX[1]},{BBOX[0]},{BBOX[3]},{BBOX[2]},EPSG:4326&outputFormat=geojson")
EFFIS_ANNUAL = "https://api2.effis.emergency.copernicus.eu/statistics/v2/effis/estimatesbycountry?country=MKD"
PAGE = 1000


def get_json(url, tries=2):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120) as r:
                return json.load(r)
        except OSError:
            if attempt + 1 == tries:
                raise
            time.sleep(5)


def check_features(features, field):
    """Refuse anything but polygons carrying a three-digit CORINE code."""
    for f in features:
        code = str((f.get("properties") or {}).get(field, ""))
        if (f.get("geometry") or {}).get("type") not in ("Polygon", "MultiPolygon") or not (len(code) == 3 and code.isdigit()):
            raise ValueError(f"Unexpected CORINE feature: {str(f)[:120]}")


def corine(edition):
    """All CORINE polygons touching the box, paged; ~30 m server-side generalisation (the grid is 100 m)."""
    field, url = CORINE_FIELD[edition], EEA.format(year=edition)
    base = {"where": "1=1", "geometry": ",".join(map(str, BBOX)), "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects"}
    count = get_json(f"{url}?{urllib.parse.urlencode({**base, 'returnCountOnly': 'true', 'f': 'json'})}")["count"]
    features = []
    while len(features) < count:
        q = {**base, "outFields": field, "outSR": 4326, "orderByFields": "OBJECTID", "resultOffset": len(features),
             "resultRecordCount": PAGE, "maxAllowableOffset": 0.0003, "f": "geojson"}
        page = get_json(f"{url}?{urllib.parse.urlencode(q)}")["features"]
        if not page:
            raise ValueError(f"CORINE {edition}: empty page at offset {len(features)} of {count}")
        check_features(page, field)
        features += [{"type": "Feature", "properties": {field: f["properties"][field]}, "geometry": f["geometry"]} for f in page]
        print(f"CORINE {edition}: {len(features)}/{count}", flush=True)
    if len(features) != count:
        raise ValueError(f"CORINE {edition}: {len(features)} features, expected {count}")
    return {"type": "FeatureCollection", "features": features}, f"{url}?{urllib.parse.urlencode({**base, 'outFields': field, 'f': 'geojson'})}"


def effis():
    data = get_json(EFFIS_WFS)
    feats = data.get("features")
    if not isinstance(feats, list) or not feats:
        raise ValueError("EFFIS returned no burned areas")
    if data.get("numberMatched") not in (None, len(feats)):
        raise ValueError(f"EFFIS query truncated: {len(feats)} of {data['numberMatched']}")
    if any(f["geometry"]["type"] not in ("Polygon", "MultiPolygon") for f in feats):
        raise ValueError("EFFIS returned a non-polygon burned area")
    return data


def save(name, data, url):
    raw = json.dumps(data, separators=(",", ":")).encode()
    (DEST / name).write_bytes(raw)
    return {"path": str((DEST / name).relative_to(ROOT)), "url": url, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    assets = []
    for e in EDITIONS:
        data, url = corine(e)
        assets.append({**save(f"corine-{e}.geojson", data, url), "features": len(data["features"])})
    burned = effis()
    assets.append({**save("effis-burned-areas.geojson", burned, EFFIS_WFS), "features": len(burned["features"])})
    annual = get_json(EFFIS_ANNUAL)
    if not isinstance(annual, list) or not all({"year", "ba", "nf"} <= set(r) for r in annual):
        raise ValueError("Unexpected EFFIS annual estimates")
    assets.append(save("effis-annual.json", annual, EFFIS_ANNUAL))
    (DEST / "manifest.json").write_text(json.dumps({"bbox_wgs84": BBOX, "assets": assets}, indent=1) + "\n")
    print(f"saved {len(assets)} files, {sum(a['bytes'] for a in assets) / 1e6:.1f} MB in {DEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the test, then the fetch**

Run: `.venv/bin/python -m unittest tests.test_landscape.FetchChecks`
Expected: `OK`.

Run (about 5–10 min, ~300 MB): `.venv/bin/python tools/fetch_landscape.py`
Expected:
- the last lines read `saved 6 files, … MB in Data/readiness/landscape`;
- the CORINE counts end at about 18,500–19,000 per edition;
- EFFIS returns about 1,600 features (MK 1,244 plus neighbours, as verified on 16 Nov).

If a request fails twice, stop and report the failure (stop rule 3).

- [ ] **Step 5: Commit** (raw data stays in the git-ignored `Data/`)

```bash
git add tools/fetch_landscape.py tests/test_landscape.py
git commit -m "Landscape: fetch CORINE 2000-2018 and EFFIS burned areas"
```

---

### Task 4: Fetch NASA MCD64A1 from LP DAAC (D26)

**Files:**
- Create: `tools/fetch_mcd64a1.py`

- [ ] **Step 1: Write the script with its self-test**

Create `tools/fetch_mcd64a1.py`:

```python
# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["numpy>=2.3", "pyhdf==0.11.7"]
# ///
"""Crop NASA MCD64A1 v061 burned area (tile h19v04, 2001-2025) to North Macedonia (D24, D26).

    uv run --python 3.14 tools/fetch_mcd64a1.py --self-test
    uv run --python 3.14 tools/fetch_mcd64a1.py            # resumable; needs the Earthdata bearer in token-and-key.txt

Lists granules in NASA CMR, downloads each HDF4 from LP DAAC with the bearer (dropped on redirects away from NASA
hosts), hashes it, saves the Burn Date and QA crop with its granule ID, and deletes the HDF.
"""

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from landscape import PIXEL_M, sin_tile_origin, sin_window  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "Data" / "readiness" / "landscape" / "mcd64a1"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
YEARS = (2001, 2025)
NASA_HOSTS = (".earthdata.nasa.gov", ".earthdatacloud.nasa.gov")
HDF4_MAGIC = b"\x0e\x03\x13\x01"


def find_token(text):
    tokens = set(re.findall(r"eyJ[\w-]+\.[\w-]+\.[\w-]+", text))
    if len(tokens) != 1:
        raise ValueError("Expected one Earthdata bearer (JWT) in the local credential file; contents withheld")
    return tokens.pop()


class KeepBearerOnNasaHosts(urllib.request.HTTPRedirectHandler):
    """LP DAAC redirects to a pre-signed S3 URL; the bearer must not travel to non-NASA hosts."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and not (urllib.parse.urlsplit(newurl).hostname or "").endswith(NASA_HOSTS):
            new.remove_header("Authorization")
        return new


def granules():
    """One h19v04 granule per month for YEARS, from NASA CMR (public, no login)."""
    q = urllib.parse.urlencode({"short_name": "MCD64A1", "version": "061", "page_size": 2000, "bounding_box": "21.5,41.5,21.6,41.6",
                                "temporal": f"{YEARS[0]}-01-01T00:00:00Z,{YEARS[1]}-12-31T23:59:59Z"})
    with urllib.request.urlopen(f"{CMR}?{q}", timeout=120) as r:
        entries = json.load(r)["feed"]["entry"]
    out = {}
    for e in entries:
        gid = e["producer_granule_id"].removesuffix(".hdf")
        if ".h19v04." not in gid:
            continue
        stamp = gid.split(".")[1]
        day = date(int(stamp[1:5]), 1, 1) + timedelta(int(stamp[5:8]) - 1)
        url = next(link["href"] for link in e["links"] if link["href"].startswith("https://") and link["href"].endswith(".hdf"))
        if (day.year, day.month) in out:
            raise ValueError(f"Two granules for {day:%Y-%m}")
        out[(day.year, day.month)] = {"id": gid, "year": day.year, "month": day.month, "url": url}
    need = {(y, m) for y in range(YEARS[0], YEARS[1] + 1) for m in range(1, 13)}
    if set(out) != need:
        raise ValueError(f"CMR months missing: {sorted(need - set(out))[:6]}")
    return [out[k] for k in sorted(out)]


def fetch(g, opener, token):
    from pyhdf.SD import SD, SDC
    tmp = DEST / "download.hdf.part"
    h, size = hashlib.sha256(), 0
    request = urllib.request.Request(g["url"], headers={"Authorization": f"Bearer {token}"})
    with opener.open(request, timeout=300) as r, open(tmp, "wb") as f:
        for chunk in iter(lambda: r.read(1 << 20), b""):
            h.update(chunk)
            f.write(chunk)
            size += len(chunk)
    with open(tmp, "rb") as f:
        if f.read(4) != HDF4_MAGIC:
            raise ValueError(f"{g['id']}: response is not an HDF4 file (a login page?)")
    r0, r1, c0, c1 = sin_window()
    sd = SD(str(tmp), SDC.READ)
    try:
        burn = np.asarray(sd.select("Burn Date")[r0:r1, c0:c1], dtype=np.int16)
        qa = np.asarray(sd.select("QA")[r0:r1, c0:c1], dtype=np.uint8)
    finally:
        sd.end()
    x0, y0 = sin_tile_origin(19, 4)
    crop = f"{g['id']}.npz"
    np.savez_compressed(DEST / crop, burn_date=burn, qa=qa, x0=x0 + c0 * PIXEL_M, y0=y0 - r0 * PIXEL_M)
    tmp.unlink()
    return {**g, "sha256": h.hexdigest(), "bytes": size, "crop": crop}


def self_test():
    assert find_token("FIRMS 0123 eyJhbGci.eyJzdWIi.c2ln") == "eyJhbGci.eyJzdWIi.c2ln"
    for bad in ("no token here", "eyJa.b.c eyJd.e.f"):
        try:
            find_token(bad)
        except ValueError:
            continue
        raise AssertionError(bad)
    handler = KeepBearerOnNasaHosts()
    req = urllib.request.Request("https://data.lpdaac.earthdatacloud.nasa.gov/x.hdf", headers={"Authorization": "Bearer t"})
    s3 = handler.redirect_request(req, None, 307, "", {}, "https://lp-prod-protected.s3.us-west-2.amazonaws.com/x.hdf?sig=1")
    urs = handler.redirect_request(req, None, 302, "", {}, "https://urs.earthdata.nasa.gov/oauth/authorize?x=1")
    assert not s3.has_header("Authorization") and urs.has_header("Authorization")
    r0, r1, c0, c1 = sin_window()
    assert 0 <= r0 < r1 <= 2400 and 0 <= c0 < c1 <= 2400
    print("self-test passed")


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--self-test", action="store_true")
    p.add_argument("--credentials-file", type=Path, default=ROOT / "token-and-key.txt")
    a = p.parse_args()
    if a.self_test:
        return self_test()
    DEST.mkdir(parents=True, exist_ok=True)
    path = DEST / "manifest.json"
    manifest = json.loads(path.read_text()) if path.exists() else {
        "product": "MCD64A1.061", "tile": "h19v04", "window_rows_cols": list(sin_window()), "pixel_m": PIXEL_M, "granules": []}
    manifest["granules"] = [g for g in manifest["granules"] if (DEST / g["crop"]).exists()]
    done = {g["id"] for g in manifest["granules"]}
    token = find_token(a.credentials_file.read_text())
    opener = urllib.request.build_opener(KeepBearerOnNasaHosts)
    todo = [g for g in granules() if g["id"] not in done]
    for i, g in enumerate(todo, 1):
        try:
            manifest["granules"].append(fetch(g, opener, token))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit(f"Earthdata refused the bearer (HTTP {e.code}); renew it and rerun. {i - 1} new granules saved.") from None
            raise
        path.write_text(json.dumps(manifest, indent=1) + "\n")
        print(f"{g['id']} ({i}/{len(todo)})", flush=True)
    print(f"{len(manifest['granules'])} granules cropped in {DEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the self-test**

Run: `uv run --python 3.14 tools/fetch_mcd64a1.py --self-test`
Expected: uv installs pyhdf 0.11.7 and numpy into its own cache, then prints `self-test passed`.

- [ ] **Step 3: Fetch (background, ~1.2 GB transient, resumable)**

Run (with `run_in_background`): `uv run --python 3.14 tools/fetch_mcd64a1.py`
Expected: 300 lines `MCD64A1.A…h19v04… (n/300)`, then `300 granules cropped in Data/readiness/landscape/mcd64a1`.

On `Earthdata refused the bearer`, stop and ask SAI to renew the token (stop rule 4). Do not retry in a loop.

- [ ] **Step 4: Spot-check one crop against the Mariovo case**

Run:

```bash
.venv/bin/python -c "
import json, numpy as np
from pathlib import Path
d = Path('Data/readiness/landscape/mcd64a1'); m = json.loads((d / 'manifest.json').read_text())
g = next(x for x in m['granules'] if (x['year'], x['month']) == (2024, 9)); z = np.load(d / g['crop'])
print(g['id'], z['burn_date'].shape, int(((z['burn_date'] >= 245) & (z['burn_date'] <= 251)).sum()))"
```

Expected: the granule ID matches `MCD64A1.A2024245.h19v04.061.*` and the cell count is greater than 0. Mariovo had 1–7 Sep burns; the exact number varies with the window.

- [ ] **Step 5: Commit**

```bash
git add tools/fetch_mcd64a1.py
git commit -m "Landscape: crop NASA MCD64A1 2001-2025 from LP DAAC (uv + pyhdf)"
```

---

### Task 5: Land grids, display image and fire starts

**Files:**
- Modify: `tools/landscape.py` (append the export section)
- Test: `tests/test_landscape.py`

- [ ] **Step 1: Write the failing test** — append:

```python
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `.venv/bin/python -m unittest tests.test_landscape.StartsAndBurns`
Expected: `AttributeError: module 'landscape' has no attribute 'CELL'`.

- [ ] **Step 3: Implement** — append to `tools/landscape.py`:

```python
# --- export (needs the project .venv: rasterio, shapely, Pillow) ------------------------------------------

SENSOR_YEARS = {"viirs-snpp": (2012, 2025), "modis": (2001, 2025), "viirs-jpss1": (2018, 2025)}  # full years (D11, D12)
SENSOR_LABEL = {"viirs-snpp": "VIIRS S-NPP", "modis": "MODIS", "viirs-jpss1": "VIIRS NOAA-20"}
NASA_YEARS = (2001, 2025)
EFFIS_FIRST = 2016
SMALL_HA = 30
CELL = 100        # statistics grid in EPSG:3035, the CORINE projection
SHOW_CELL = 134   # display image in EPSG:3857: about 100 m on the ground at 41.6 N
BUDGET = {"what-burns.json": 200_000, "landcover-mk.png": 700_000, "burned-areas.geojson": 1_500_000}
CREDITS = [
    "Land cover: © European Union, Copernicus Land Monitoring Service, European Environment Agency (CORINE Land Cover 2000, 2006, 2012, 2018).",
    "Burned areas 2016 to now: EFFIS, European Commission Joint Research Centre (CC BY 4.0).",
    "Burned area 2001–2025: NASA MODIS MCD64A1 v061, NASA LP DAAC.",
    "Fire detections: NASA FIRMS, MODIS C6.1 and VIIRS 375 m; cite LANCE/FIRMS.",
]


def to_3035(lon, lat):
    from rasterio.warp import transform
    x, y = transform("EPSG:4326", "EPSG:3035", np.asarray(lon, dtype=float).tolist(), np.asarray(lat, dtype=float).tolist())
    return np.array(x), np.array(y)


def point_test(mk):
    """Vectorised 'inside the country' test for lon/lat arrays."""
    import shapely
    shapely.prepare(mk)
    return lambda lon, lat: shapely.contains_xy(mk, np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))


def _frame(crs, cell):
    from rasterio.warp import transform_bounds
    w, s, e, n = transform_bounds("EPSG:4326", crs, *BBOX, densify_pts=21)
    left, top = math.floor(w / cell) * cell, math.ceil(n / cell) * cell
    return left, top, math.ceil((e - left) / cell), math.ceil((top - s) / cell)


def land_grid(features, field, country, crs, cell):
    """CORINE codes on a north-up grid over BBOX, 0 outside the country (cell centres decide). Returns (grid, left, top)."""
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    from rasterio.warp import transform_geom
    left, top, width, height = _frame(crs, cell)
    tr = from_origin(left, top, cell, cell)
    shapes = ((transform_geom("EPSG:4326", crs, f["geometry"]), int(f["properties"][field])) for f in features)
    grid = rasterize(shapes, out_shape=(height, width), transform=tr, fill=0, dtype="uint16")
    inside = rasterize([(transform_geom("EPSG:4326", crs, country), 1)], out_shape=(height, width), transform=tr, fill=0, dtype="uint8")
    grid[inside == 0] = 0
    return grid, left, top


def shares_of(grid, lut, n):
    counts = np.bincount(lut[grid[grid > 0]], minlength=n + 1)[:n].astype(float)
    return counts / counts.sum(), counts


def code_shares(grid):
    codes, counts = np.unique(grid[grid > 0], return_counts=True)
    keep = [(int(c), int(k)) for c, k in zip(codes, counts) if int(c) not in NOT_CLASSIFIED]
    total = sum(k for _, k in keep)
    return {str(c): round(k / total, 5) for c, k in keep}


def write_png(grid, path):
    """Indexed PNG: palette entry 0 is transparent, 1-10 are the group colours (D7)."""
    from PIL import Image
    lut, n = code_lut(GROUPS), len(GROUPS)
    idx = lut[grid].astype(np.int16) + 1
    idx[(grid == 0) | (idx == n + 1)] = 0
    img = Image.frombytes("P", (grid.shape[1], grid.shape[0]), idx.astype(np.uint8).tobytes())
    palette = [0, 0, 0] + [b for g in GROUPS for b in bytes.fromhex(g["color"][1:])]
    img.putpalette(palette + [0] * (768 - len(palette)))
    img.save(path, optimize=True, transparency=0)


def corners_3857(left, top, width, height, cell):
    from rasterio.warp import transform
    right, bottom = left + width * cell, top - height * cell
    lons, lats = transform("EPSG:3857", "EPSG:4326", [left, right, right, left], [top, top, bottom, bottom])
    return [[round(x, 6), round(y, 6)] for x, y in zip(lons, lats)]


def _ts(t):
    return datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp()


def starts_for(dets, x, y, inside, grids, gap_hours):
    """Fire starts (D2, D13, D17): detections grouped by firelib. A start counts when its first detection is inside the
    country; the land under that detection's footprint (CORINE edition at or before its year, D3) classes it."""
    from firelib import cluster
    lut, n = code_lut(GROUPS), len(GROUPS)
    out = []
    for members in cluster(dets, gap_hours):
        members = sorted(members, key=lambda i: dets[i]["t"])
        i = members[0]
        f = dets[i]
        if not inside[i]:
            continue
        year = int(f["t"][:4])
        edition = edition_for_year(year)
        grid, left, top = grids[edition]
        shares = window_shares(grid, left, top, CELL, x[i], y[i], f["scan"] * 500, f["track"] * 500, lut, n)
        out.append({"year": year, "month": int(f["t"][5:7]), "edition": edition, "shares": shares,
                    "days": (_ts(dets[members[-1]]["t"]) - _ts(f["t"])) / 86400})
    return out
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m unittest tests/test_landscape.py`
Expected: `OK` (all classes).

- [ ] **Step 5: Commit**

```bash
git add tools/landscape.py tests/test_landscape.py
git commit -m "Landscape: land grids, display image and fire starts"
```

---

### Task 6: Sensor summaries, NASA and EFFIS burned area

**Files:**
- Modify: `tools/landscape.py` (append)
- Test: `tests/test_landscape.py`

- [ ] **Step 1: Write the failing test** — add to class `StartsAndBurns`:

```python
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `.venv/bin/python -m unittest tests.test_landscape.StartsAndBurns`
Expected: `AttributeError: module 'landscape' has no attribute 'effis_burned'`.

- [ ] **Step 3: Implement** — append to `tools/landscape.py`:

```python
def load_detections(history_dir, sensor, years):
    """Type-0 (vegetation fire) rows of one sensor's full years from the exported partitions (D12)."""
    out = []
    for path in sorted(history_dir.glob(f"{sensor}-*.json")):
        doc = json.loads(path.read_text())
        if doc["sensor"] != sensor or not years[0] <= doc["year"] <= years[1]:
            continue
        c = {k: i for i, k in enumerate(doc["columns"])}
        out += [{"id": r[c["id"]], "t": r[c["t"]], "lat": r[c["lat"]], "lon": r[c["lon"]], "frp": r[c["frp"]],
                 "scan": r[c["scan"]], "track": r[c["track"]]} for r in doc["rows"] if r[c["type"]] == 0]
    return out


def sensor_summary(sensor, history_dir, grids, land, area, inside_fn):
    """Fire starts by year x month x group, durations, activity and the D10 figures for one sensor."""
    years = SENSOR_YEARS[sensor]
    ny, n, lut = years[1] - years[0] + 1, len(GROUPS), code_lut(GROUPS)
    dets = load_detections(history_dir, sensor, years)
    found = {int(d["t"][:4]) for d in dets}
    if found != set(range(years[0], years[1] + 1)):
        raise ValueError(f"{sensor}: archive years {sorted(found)} do not cover {years}")
    lon, lat = [d["lon"] for d in dets], [d["lat"] for d in dets]
    x, y = to_3035(lon, lat)
    inside = inside_fn(lon, lat)
    starts = starts_for(dets, x, y, inside, grids, 24.0)
    cube, per_ed, durations, unclassified = np.zeros((ny, 12, n)), {}, {g["id"]: [] for g in GROUPS}, 0
    for s in starts:
        if s["shares"] is None:
            unclassified += 1
            continue
        cube[s["year"] - years[0], s["month"] - 1] += s["shares"]
        per_ed[s["edition"]] = per_ed.get(s["edition"], 0) + 1
        durations[GROUPS[int(np.argmax(s["shares"]))]["id"]].append(s["days"])
    if unclassified > 0.005 * len(starts):
        raise ValueError(f"{sensor}: {unclassified} of {len(starts)} fire starts have no CORINE land under them")
    activity = np.zeros((12, n))
    for i in np.nonzero(inside)[0]:
        d = dets[i]
        grid, left, top = grids[edition_for_year(int(d["t"][:4]))]
        sh = window_shares(grid, left, top, CELL, x[i], y[i], d["scan"] * 500, d["track"] * 500, lut, n)
        if sh is not None:
            activity[int(d["t"][5:7]) - 1] += sh
    by_group = cube.sum(axis=(0, 1))
    land_w = weighted(land, per_ed)
    area_w = sum(area[e] * w for e, w in per_ed.items()) / sum(per_ed.values())
    rates = np.where(land_w > 0, (by_group / ny) / np.where(land_w > 0, land_w * area_w / 100, 1), 0.0)
    total_48 = sum(1 for s in starts_for(dets, x, y, inside, grids, 48.0) if s["shares"] is not None)
    return {
        "starts": {"years": list(years), "gap_hours": 24, "total": len(starts) - unclassified, "total_48h": total_48,
                   "unclassified": unclassified, "by_year_month_group": np.round(cube, 2).tolist(),
                   "duration": {k: {"n": len(v), "median_days": round(float(np.median(v)), 1), "p90_days": round(float(np.percentile(v, 90)), 1)}
                                for k, v in durations.items() if v}},
        "activity": {"years": list(years), "detections": int(inside.sum()), "by_month_group": np.round(activity, 2).tolist()},
        "catches": np.round(ratio(by_group, land_w), 2).tolist(), "catches_land": np.round(land_w, 4).tolist(),
        "rates": np.round(rates, 3).tolist(), "by_group": by_group, "avg_month": cube.sum(axis=0) / ny,
    }


def nasa_burned(folder, grids, inside_fn):
    """NASA MCD64A1 burned 500 m cells inside the country, shared over CORINE land (D4, D15)."""
    manifest = json.loads((folder / "manifest.json").read_text())
    need = {(y, m) for y in range(NASA_YEARS[0], NASA_YEARS[1] + 1) for m in range(1, 13)}
    used = [g for g in manifest["granules"] if (g["year"], g["month"]) in need]
    if {(g["year"], g["month"]) for g in used} != need or len(used) != len(need):
        raise ValueError("MCD64A1 months missing or duplicated; run tools/fetch_mcd64a1.py")
    lut, n = code_lut(GROUPS), len(GROUPS)
    rows, per_ed, kept, dropped = np.zeros((NASA_YEARS[1] - NASA_YEARS[0] + 1, n)), {}, 0, 0
    for g in used:
        z = np.load(folder / g["crop"])
        r, c = np.nonzero((z["burn_date"] >= 1) & (z["burn_date"] <= 366))
        if not len(r):
            continue
        lon, lat = sin_to_lonlat(float(z["x0"]) + (c + 0.5) * PIXEL_M, float(z["y0"]) - (r + 0.5) * PIXEL_M)
        ins = inside_fn(lon, lat)
        if not ins.any():
            continue
        x, y = to_3035(lon[ins], lat[ins])
        edition = edition_for_year(g["year"])
        grid, left, top = grids[edition]
        for xi, yi in zip(x, y):
            sh = window_shares(grid, left, top, CELL, xi, yi, PIXEL_M / 2, PIXEL_M / 2, lut, n)
            if sh is None:
                dropped += 1
                continue
            kept += 1
            rows[g["year"] - NASA_YEARS[0]] += sh * PIXEL_HA
            per_ed[edition] = per_ed.get(edition, 0) + PIXEL_HA
    if dropped > 0.005 * max(kept, 1):
        raise ValueError(f"MCD64A1: {dropped} burned cells inside the country have no CORINE land")
    return rows, per_ed, len(used)


def _area(geom):
    from rasterio.warp import transform_geom
    from shapely.geometry import mapping, shape
    return shape(transform_geom("EPSG:4326", "EPSG:3035", mapping(geom))).area


def _rounded(geom):
    def r(c):
        return [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def effis_burned(path, annual_path, mk):
    """EFFIS mapped fires that intersect the country, clipped to it (D5, D14, D17).
    Returns (aggregates, hectares per edition for fires >= 30 ha, >= 30 ha hectares per field, web features, mapping-check items)."""
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union
    feats = json.loads(path.read_text())["features"]
    nf = len(FIELDS)
    y1 = max(int(f["properties"]["FIREDATE"][:4]) for f in feats)
    ny = y1 - EFFIS_FIRST + 1
    allr, ge30 = np.zeros((ny, nf)), np.zeros((ny, nf))
    fires_all, fires_ge30 = [0] * ny, [0] * ny
    per_ed, sizes, mk_ge30, web, check = {}, {f["id"]: [] for f in FIELDS}, {}, [], []
    for f in feats:
        p, g = f["properties"], shape(f["geometry"])
        year = int(p["FIREDATE"][:4])
        if year < EFFIS_FIRST or not g.intersects(mk):
            continue
        clip = g.intersection(mk)
        if clip.geom_type == "GeometryCollection":
            clip = unary_union([q for q in clip.geoms if q.geom_type in ("Polygon", "MultiPolygon")])
        if clip.is_empty or clip.area == 0:
            continue
        sh = np.array([float(p[x["prop"]] or 0) for x in FIELDS])
        if abs(sh.sum() - 100) > 1:
            raise ValueError(f"EFFIS fire {p['id']}: land-cover shares sum to {sh.sum():.1f}")
        area = float(p["AREA_HA"])
        ha, big, k = area * _area(clip) / _area(g), area >= SMALL_HA, year - EFFIS_FIRST
        allr[k] += ha * sh / 100
        fires_all[k] += 1
        if big:
            ge30[k] += ha * sh / 100
            fires_ge30[k] += 1
            sizes[FIELDS[int(np.argmax(sh))]["id"]].append(area)
            per_ed[edition_for_year(year)] = per_ed.get(edition_for_year(year), 0) + ha
        if p["COUNTRY"] == "MK" and big:
            c = mk_ge30.setdefault(year, [0, 0.0])
            c[0] += 1
            c[1] += area
            if year >= 2018:
                check.append((f["geometry"], sh, area))
        web.append({"type": "Feature", "geometry": _rounded(mapping(clip.simplify(0.0002, preserve_topology=True))),
                    "properties": {"id": str(p["id"]), "country": p["COUNTRY"], "year": year, "firedate": p["FIREDATE"][:10],
                                   "finaldate": (p.get("FINALDATE") or "")[:10] or None, "area_ha": round(area),
                                   "clipped_ha": round(ha, 1), "small": not big,
                                   **{x["id"]: round(float(s), 1) for x, s in zip(FIELDS, sh)}}})
    annual = {r["year"]: r for r in json.loads(annual_path.read_text())}
    cross = [{"year": y, "fires": mk_ge30.get(y, [0, 0])[0], "ha": round(mk_ge30.get(y, [0, 0])[1]),
              "estimate_fires": annual.get(y, {}).get("nf"), "estimate_ha": annual.get(y, {}).get("ba")} for y in range(EFFIS_FIRST, y1 + 1)]
    spread = {k: {"n": len(v), "median_ha": round(float(np.median(v))), "p90_ha": round(float(np.percentile(v, 90))), "max_ha": round(max(v))}
              for k, v in sizes.items() if v}
    agg = {"years": [EFFIS_FIRST, y1], "all": {"by_year_field": np.round(allr, 1).tolist(), "fires": fires_all},
           "ge30": {"by_year_field": np.round(ge30, 1).tolist(), "fires": fires_ge30}, "cross_check": cross, "spread": spread}
    return agg, per_ed, ge30.sum(axis=0), web, check


def check_field_mapping(items, grid, left, top):
    """EFFIS derives each fire's shares from CORINE; the code-to-field table must reproduce them within 5 points (spec risk)."""
    from rasterio.features import geometry_mask
    from rasterio.transform import from_origin
    from rasterio.warp import transform_geom
    from shapely.geometry import shape
    lut, nf = code_lut(FIELDS), len(FIELDS)
    rows, cols = grid.shape
    ours, theirs = np.zeros(nf), np.zeros(nf)
    for geom, sh, area in items:
        g = transform_geom("EPSG:4326", "EPSG:3035", geom)
        w, s, e, n = shape(g).bounds
        c0, c1 = max(0, math.floor((w - left) / CELL)), min(cols, math.ceil((e - left) / CELL))
        r0, r1 = max(0, math.floor((top - n) / CELL)), min(rows, math.ceil((top - s) / CELL))
        if c1 <= c0 or r1 <= r0:
            continue
        win = grid[r0:r1, c0:c1]
        inside = geometry_mask([g], out_shape=win.shape, transform=from_origin(left + c0 * CELL, top - r0 * CELL, CELL, CELL), invert=True)
        counts = np.bincount(lut[win[inside]], minlength=nf + 1)[:nf]
        if counts.sum():
            ours += area * counts / counts.sum()
            theirs += area * sh / 100
    a, b = 100 * ours / ours.sum(), 100 * theirs / theirs.sum()
    table = {f["id"]: [round(float(x), 1), round(float(y), 1)] for f, x, y in zip(FIELDS, a, b)}
    if np.abs(a - b).max() > 5:
        raise ValueError(f"CORINE-to-EFFIS field table disagrees with EFFIS by up to {np.abs(a - b).max():.1f} points (ours, EFFIS): {table}")
    return table
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m unittest tests/test_landscape.py`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add tools/landscape.py tests/test_landscape.py
git commit -m "Landscape: sensor summaries, NASA and EFFIS burned area"
```

---

### Task 7: The export document

**Files:**
- Modify: `tools/landscape.py` (append `export()`)

- [ ] **Step 1: Implement** — append to `tools/landscape.py`:

```python
def export(out, ready, boundary_path, history_dir):
    """Write out/landscape/{what-burns.json, landcover-mk.png, burned-areas.geojson}; returns a one-line summary."""
    import hashlib
    from shapely.geometry import shape
    if not (ready / "manifest.json").exists() or not (ready / "mcd64a1" / "manifest.json").exists():
        raise ValueError("Landscape inputs missing: run tools/fetch_landscape.py and tools/fetch_mcd64a1.py first")
    country = json.loads(boundary_path.read_text())["features"][0]["geometry"]
    mk = shape(country)
    inside_fn = point_test(mk)
    lut_g, lut_f, ng, nf = code_lut(GROUPS), code_lut(FIELDS), len(GROUPS), len(FIELDS)
    grids, land, land_f, area, codes = {}, {}, {}, {}, {}
    for e in EDITIONS:
        feats = json.loads((ready / f"corine-{e}.geojson").read_text())["features"]
        grids[e] = land_grid(feats, CORINE_FIELD[e], country, "EPSG:3035", CELL)
        present = np.unique(grids[e][0])
        check_codes(present, lut_g, ng)
        check_codes(present, lut_f, nf)
        land[e], counts = shares_of(grids[e][0], lut_g, ng)
        land_f[e], _ = shares_of(grids[e][0], lut_f, nf)
        area[e] = float(counts.sum()) * CELL * CELL / 1e6
        codes[e] = code_shares(grids[e][0])
        if abs(land[e].sum() - 1) > 1e-3 or abs(land_f[e].sum() - 1) > 1e-3:
            raise ValueError(f"CORINE {e}: land shares do not sum to 1")
        if e == 2018:
            display = land_grid(feats, CORINE_FIELD[e], country, "EPSG:3857", SHOW_CELL)
    dest = out / "landscape"
    dest.mkdir(parents=True, exist_ok=True)
    write_png(display[0], dest / "landcover-mk.png")
    corners = corners_3857(display[1], display[2], display[0].shape[1], display[0].shape[0], SHOW_CELL)
    sensors = {s: sensor_summary(s, history_dir, grids, land, area, inside_fn) for s in SENSOR_YEARS}
    nasa_rows, nasa_w, nasa_months = nasa_burned(ready / "mcd64a1", grids, inside_fn)
    effis, effis_w, effis_by_field, web, check_items = effis_burned(ready / "effis-burned-areas.geojson", ready / "effis-annual.json", mk)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    effis["to_date"] = now[:10]
    effis["field_check"] = check_field_mapping(check_items, *grids[2018])
    nasa_land, effis_land = weighted(land, nasa_w), weighted(land_f, effis_w)
    snpp = sensors["viirs-snpp"]
    doc = {
        "schema": "firewatch.landscape.v1", "generated_utc": now, "export_date": now[:10],
        "groups": [{k: g[k] for k in ("id", "label", "color", "codes")} for g in GROUPS],
        "fields": [{k: f[k] for k in ("id", "label", "color", "codes")} for f in FIELDS],
        "editions": list(EDITIONS),
        "land": {str(e): {"area_km2": round(area[e], 1), "groups": np.round(land[e], 5).tolist(), "fields": np.round(land_f[e], 5).tolist(),
                          "codes": codes[e]} for e in EDITIONS},
        "starts": {s: v["starts"] for s, v in sensors.items()},
        "activity": {s: v["activity"] for s, v in sensors.items()},
        "nasa": {"product": "MODIS MCD64A1 v061 Burn Date, tile h19v04 (NASA LP DAAC)", "years": list(NASA_YEARS),
                 "by_year_group": np.round(nasa_rows, 1).tolist(), "pixel_ha": round(PIXEL_HA, 3), "months": nasa_months},
        "effis": effis,
        "shares": {"catches": {s: v["catches"] for s, v in sensors.items()}, "catches_land": {s: v["catches_land"] for s, v in sensors.items()},
                   "rates": {s: v["rates"] for s, v in sensors.items()},
                   "consumes_nasa": np.round(ratio(nasa_rows.sum(axis=0), nasa_land), 2).tolist(), "consumes_nasa_land": np.round(nasa_land, 4).tolist(),
                   "consumes_effis": np.round(ratio(effis_by_field, effis_land), 2).tolist(), "consumes_effis_land": np.round(effis_land, 4).tolist()},
        "takeaways": takeaways(snpp["by_group"], snpp["avg_month"], nasa_rows.sum(axis=0), SENSOR_LABEL["viirs-snpp"],
                               SENSOR_YEARS["viirs-snpp"], NASA_YEARS),
        "image": {"path": "landscape/landcover-mk.png", "corners": corners, "edition": 2018},
        "credits": CREDITS,
        "provenance": {"inputs": json.loads((ready / "manifest.json").read_text())["assets"],
                       "mcd64a1_manifest_sha256": hashlib.sha256((ready / "mcd64a1" / "manifest.json").read_bytes()).hexdigest()},
    }
    (dest / "what-burns.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (dest / "burned-areas.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": web}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for name, limit in BUDGET.items():
        size = (dest / name).stat().st_size
        if size > limit:
            raise ValueError(f"{name} is {size} bytes, over its {limit} budget")
    return (f"{sum(v['starts']['total'] for v in sensors.values())} fire starts over 3 sensors, {nasa_months} MCD64A1 months, "
            f"{len(web)} EFFIS burned areas; takeaways: {' | '.join(t['text'] for t in doc['takeaways'])}")
```

- [ ] **Step 2: Wire it into the export** — in `tools/export_web_data.py` `main()`, after the `fire stories` print and before `write_catalog(...)`:

```python
    import landscape  # What burns (/landscape): reads the partitions written above
    print(f"landscape: {landscape.export(OUT, READY / 'landscape', ADDED / 'geoboundaries-mkd-adm0.geojson', OUT / 'history')}")
```

- [ ] **Step 3: Run the full export**

Run: `.venv/bin/python tools/export_web_data.py`
Expected: the existing lines, plus a `landscape: … fire starts …` line with three takeaways, then `exported …`.

The export rebuilds `web/public/data` from `Data/`. Expected diffs are the new `landscape/` files, `catalog.json` (timestamp, file list) and `functions/firelib.py`. Investigate any other changed file before committing.

On `CORINE-to-EFFIS field table disagrees`, stop: report the table to SAI and do not loosen the threshold (spec risk). On a budget error, report the size (for the PNG, try `SHOW_CELL = 150` only with SAI's OK).

- [ ] **Step 4: Run the Python tests**

Run: `.venv/bin/python -m unittest tests/test_landscape.py tests/test_export_web_data.py`
Expected: `OK`.

- [ ] **Step 5: Commit** (generated data is committed as for earlier exports)

```bash
git add tools/landscape.py tools/export_web_data.py web/public/data functions/firelib.py
git commit -m "Landscape: export what-burns.json, land-cover image and burned areas"
```

---

### Task 8: Generated-data contracts

**Files:**
- Modify: `tests/test_export_web_data.py` (class `GeneratedData`)

- [ ] **Step 1: Add the contract test** — inside `class GeneratedData`:

```python
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
```

- [ ] **Step 2: Run it**

Run: `.venv/bin/python -m unittest tests.test_export_web_data.GeneratedData.test_landscape`
Expected: `OK`.

If the 2025 row differs, EFFIS has revised 2025. Report the new values to SAI before changing the test.

- [ ] **Step 3: Commit**

```bash
git add tests/test_export_web_data.py
git commit -m "Tests: landscape export contracts"
```

---

### Task 9: Build boundary and CSV cell helper

**Files:**
- Modify: `web/scripts/check-dist.mjs:9`, `web/src/lib/history.ts:82`

- [ ] **Step 1: Allow the PNG** — in `web/scripts/check-dist.mjs`, change `/^data\/[\w/.-]+\.(json|geojson|jpg|txt)$/` to `/^data\/[\w/.-]+\.(json|geojson|jpg|png|txt)$/`.

- [ ] **Step 2: Export the CSV cell helper** — in `web/src/lib/history.ts` change `const csvCell = (v: unknown) => {` to `export const csvCell = (v: unknown) => {`.

- [ ] **Step 3: Build**

Run: `cd web && npm run build`
Expected: `public build boundary check passed`.

- [ ] **Step 4: Commit**

```bash
git add web/scripts/check-dist.mjs web/src/lib/history.ts
git commit -m "Build: allow data PNGs; export csvCell"
```

---

### Task 10: Landscape data module

**Files:**
- Create: `web/src/lib/landscape.ts`
- Test: `web/src/lib/landscape.test.ts`

- [ ] **Step 1: Write the failing test** — create `web/src/lib/landscape.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { archiveBurnedYear, burnedFor, monthlyAverage, ratioText, tableCSV, toShares, validateLandscape, type Starts } from './landscape';

const ones = (r: number, c: number) => Array.from({ length: r }, () => Array<number>(c).fill(1));
function per<T>(f: (years: [number, number]) => T) {
  return { 'viirs-snpp': f([2012, 2025]), modis: f([2001, 2025]), 'viirs-jpss1': f([2018, 2025]) };
}
function fixture(): Record<string, unknown> {
  const cls = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `Class ${i}`, color: '#000000', codes: [] }));
  const v10 = Array<number>(10).fill(1); const v9 = Array<number>(9).fill(1);
  return {
    schema: 'firewatch.landscape.v1', generated_utc: '2026-11-17T00:00:00+00:00', export_date: '2026-11-17',
    groups: cls(10), fields: cls(9), editions: [2000, 2006, 2012, 2018], land: {},
    starts: per((years) => ({ years, gap_hours: 24, total: 1, total_48h: 1, unclassified: 0, duration: {},
      by_year_month_group: Array.from({ length: years[1] - years[0] + 1 }, () => ones(12, 10)) })),
    activity: per((years) => ({ years, detections: 1, by_month_group: ones(12, 10) })),
    nasa: { product: 'x', years: [2001, 2025], by_year_group: ones(25, 10), pixel_ha: 21.466, months: 300 },
    effis: { years: [2016, 2026], to_date: '2026-11-17', all: { by_year_field: ones(11, 9), fires: [] }, ge30: { by_year_field: ones(11, 9), fires: [] },
      cross_check: [], spread: {}, field_check: {} },
    shares: { catches: per(() => v10), catches_land: per(() => v10), rates: per(() => v10),
      consumes_nasa: v10, consumes_nasa_land: v10, consumes_effis: v9, consumes_effis_land: v9 },
    takeaways: [{ id: 'starts', text: 'a', values: {} }, { id: 'farm_peak', text: 'b', values: {} }, { id: 'burned', text: 'c', values: {} }],
    image: { path: 'landscape/landcover-mk.png', corners: [[0, 1], [1, 1], [1, 0], [0, 0]], edition: 2018 }, credits: ['credit'],
  };
}

describe('landscape document', () => {
  it('accepts a well-formed document', () => {
    expect(validateLandscape(fixture(), 'x').groups).toHaveLength(10);
  });
  it('rejects a NASA series that does not cover its years', () => {
    const d = fixture(); (d.nasa as { by_year_group: number[][] }).by_year_group.pop();
    expect(() => validateLandscape(d, 'x')).toThrow(/NASA burned area has the wrong shape/);
  });
  it('rejects a missing sensor', () => {
    const d = fixture(); delete (d.starts as Record<string, unknown>).modis;
    expect(() => validateLandscape(d, 'x')).toThrow(/missing modis/);
  });
});

describe('landscape helpers', () => {
  it('averages fire starts per month over the years', () => {
    const y1 = ones(12, 10).map((r) => r.map(() => 0)); const y2 = ones(12, 10).map((r) => r.map(() => 0));
    y1[0][0] = 2; y2[0][0] = 4;
    expect(monthlyAverage({ years: [2024, 2025], by_year_month_group: [y1, y2] } as unknown as Starts)[0][0]).toBe(3);
  });
  it('turns rows into shares and labels ratios', () => {
    expect(toShares([[1, 3], [0, 0]])).toEqual([[0.25, 0.75], [0, 0]]);
    expect([0.42, 1, 3.24, 12.6].map(ratioText)).toEqual(['0.4×', '1.0×', '3.2×', '13×']);
  });
  it('filters burned areas by year and follows the Archive rule', () => {
    const fc = { type: 'FeatureCollection', features: [2016, 2019, 2019].map((year) => ({ type: 'Feature', properties: { year }, geometry: { type: 'Point', coordinates: [0, 0] } })) } as GeoJSON.FeatureCollection;
    expect(burnedFor(fc, 2019).features).toHaveLength(2);
    expect(burnedFor(fc, 'all').features).toHaveLength(3);
    expect([2015, 2016].map((y) => archiveBurnedYear(y))).toEqual([null, 2016]);
  });
  it('writes a chart table as CSV with its credit', () => {
    expect(tableCSV(['Year', 'Land, type'], [[2024, 'a"b']], 'EFFIS, CC BY 4.0')).toBe('Year,"Land, type"\n2024,"a""b"\n\n"EFFIS, CC BY 4.0"\n');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd web && npx vitest run src/lib/landscape.test.ts`
Expected: FAIL, `Failed to resolve import "./landscape"`.

- [ ] **Step 3: Implement** — create `web/src/lib/landscape.ts`:

```ts
// What burns in North Macedonia (/landscape): types, validation and helpers for landscape/what-burns.json,
// built by tools/landscape.py. Arrays follow the order of `groups` (10) or `fields` (9).
import { fail, validateDoc } from './data';
import { csvCell } from './history';

export const START_SENSORS = ['viirs-snpp', 'modis', 'viirs-jpss1'] as const;
export type StartSensor = (typeof START_SENSORS)[number];
export const EFFIS_FIRST_YEAR = 2016;

export interface LcClass { id: string; label: string; color: string; codes: string[] }
export interface Starts {
  years: [number, number]; gap_hours: number; total: number; total_48h: number; unclassified: number;
  by_year_month_group: number[][][]; duration: Record<string, { n: number; median_days: number; p90_days: number }>;
}
export interface Activity { years: [number, number]; detections: number; by_month_group: number[][] }
export interface EffisSeries { by_year_field: number[][]; fires: number[] }
export interface LandscapeDoc {
  schema: 'firewatch.landscape.v1'; generated_utc: string; export_date: string;
  groups: LcClass[]; fields: LcClass[]; editions: number[];
  land: Record<string, { area_km2: number; groups: number[]; fields: number[]; codes: Record<string, number> }>;
  starts: Record<StartSensor, Starts>; activity: Record<StartSensor, Activity>;
  nasa: { product: string; years: [number, number]; by_year_group: number[][]; pixel_ha: number; months: number };
  effis: {
    years: [number, number]; to_date: string; all: EffisSeries; ge30: EffisSeries;
    cross_check: { year: number; fires: number; ha: number; estimate_fires: number | null; estimate_ha: number | null }[];
    spread: Record<string, { n: number; median_ha: number; p90_ha: number; max_ha: number }>; field_check: Record<string, [number, number]>;
  };
  shares: {
    catches: Record<StartSensor, number[]>; catches_land: Record<StartSensor, number[]>; rates: Record<StartSensor, number[]>;
    consumes_nasa: number[]; consumes_nasa_land: number[]; consumes_effis: number[]; consumes_effis_land: number[];
  };
  takeaways: { id: 'starts' | 'farm_peak' | 'burned'; text: string; values: Record<string, number | string> }[];
  image: { path: string; corners: [number, number][]; edition: number };
  credits: string[];
}

const span = ([a, b]: [number, number]) => b - a + 1;
export const yearsOf = ([a, b]: [number, number]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Shape checks for every array the page draws; a mismatch is an error, never a partly drawn chart. */
export function validateLandscape(raw: unknown, path: string): LandscapeDoc {
  const d = validateDoc<LandscapeDoc>('firewatch.landscape.v1', ['groups', 'fields', 'starts', 'activity', 'nasa', 'effis', 'shares', 'takeaways', 'image', 'credits'])(raw, path);
  const G = d.groups.length; const F = d.fields.length;
  if (G !== 10 || F !== 9) fail(path, 'expected 10 land-cover groups and 9 EFFIS fields');
  const matrix = (m: unknown, rows: number, cols: number, what: string) => {
    if (!Array.isArray(m) || m.length !== rows || m.some((r) => !Array.isArray(r) || r.length !== cols || r.some((v) => !Number.isFinite(v)))) fail(path, `${what} has the wrong shape`);
  };
  const vector = (v: unknown, n: number, what: string) => matrix([v], 1, n, what);
  for (const s of START_SENSORS) {
    const st = d.starts[s]; const act = d.activity[s];
    if (!st || !act) fail(path, `missing ${s}`);
    if (!Array.isArray(st.by_year_month_group) || st.by_year_month_group.length !== span(st.years)) fail(path, `${s} fire starts do not cover ${st.years.join('–')}`);
    st.by_year_month_group.forEach((y) => matrix(y, 12, G, `${s} fire starts`));
    matrix(act.by_month_group, 12, G, `${s} activity`);
    for (const k of ['catches', 'catches_land', 'rates'] as const) vector(d.shares[k]?.[s], G, `${s} ${k}`);
  }
  matrix(d.nasa.by_year_group, span(d.nasa.years), G, 'NASA burned area');
  matrix(d.effis.ge30.by_year_field, span(d.effis.years), F, 'EFFIS burned area (30 ha and up)');
  matrix(d.effis.all.by_year_field, span(d.effis.years), F, 'EFFIS burned area');
  vector(d.shares.consumes_nasa, G, 'NASA consumes'); vector(d.shares.consumes_nasa_land, G, 'NASA land shares');
  vector(d.shares.consumes_effis, F, 'EFFIS consumes'); vector(d.shares.consumes_effis_land, F, 'EFFIS land shares');
  if (!Array.isArray(d.takeaways) || d.takeaways.length !== 3) fail(path, 'expected three takeaways');
  if (!Array.isArray(d.image.corners) || d.image.corners.length !== 4) fail(path, 'image corners malformed');
  return d;
}

/** Average fire starts per calendar month over the sensor's years: 12 rows of one value per group. */
export function monthlyAverage(st: Starts): number[][] {
  const n = st.by_year_month_group.length;
  return Array.from({ length: 12 }, (_, m) => st.by_year_month_group[0][m].map((_, g) => st.by_year_month_group.reduce((s, y) => s + y[m][g], 0) / n));
}
/** Each row scaled to sum to 1; empty rows stay 0. */
export const toShares = (rows: number[][]) => rows.map((r) => { const t = r.reduce((a, b) => a + b, 0); return r.map((v) => (t ? v / t : 0)); });
/** "3.2×", "0.4×"; 1× means in proportion to the land (D10). */
export const ratioText = (r: number) => `${r >= 10 ? Math.round(r) : r.toFixed(1)}×`;
/** Burned areas of one year, or all of them (D21). */
export const burnedFor = (fc: GeoJSON.FeatureCollection, year: number | 'all'): GeoJSON.FeatureCollection =>
  (year === 'all' ? fc : { ...fc, features: fc.features.filter((f) => f.properties?.year === year) });
/** Archive rule (D22): EFFIS mapping starts in 2016, so earlier years have no burned-area layer. */
export const archiveBurnedYear = (year: number) => (year < EFFIS_FIRST_YEAR ? null : year);
/** One chart table as CSV, with the credit after a blank line (D23). */
export const tableCSV = (header: string[], rows: (string | number)[][], credit: string) =>
  `${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')}\n\n${csvCell(credit)}\n`;
```

- [ ] **Step 4: Run the tests and the type check**

Run: `cd web && npx vitest run src/lib/landscape.test.ts && npx tsc --noEmit -p .`
Expected: `Tests 7 passed`, no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/landscape.ts web/src/lib/landscape.test.ts
git commit -m "Landscape: data types, validator and helpers"
```

---

### Task 11: Stacked bar chart and palette check

**Files:**
- Create: `web/src/components/StackedBars.tsx`
- Possibly modify: `tools/landscape.py` (colours) and re-export

- [ ] **Step 1: Check the palette.**
  1. Load the `dataviz` skill.
  2. Run its palette validator on the ten `GROUPS` colours in `tools/landscape.py`, against the site's dark background (`--ink-0`) and light background, as an ordered categorical palette.
  3. If it fails, adjust the colours to what it recommends. Keep forests green, farmland warm, urban grey and water blue. Change the same colours in `FIELDS`.
  4. Re-run `.venv/bin/python tools/export_web_data.py` and commit `tools/landscape.py web/public/data` with the message "Landscape: validated chart colours".

- [ ] **Step 2: Write the component** — create `web/src/components/StackedBars.tsx`:

```tsx
import { fmtInt } from '../lib/format';

export interface Series { label: string; color: string }

/** Stacked bars, one per category and one segment per series; values[category][series]. Inline SVG like the site's other charts. */
export function StackedBars({ categories, series, values, label, unit, fmt = fmtInt }: {
  categories: string[]; series: Series[]; values: number[][]; label: string; unit: string; fmt?: (v: number) => string;
}) {
  const W = 320; const H = 130; const n = categories.length; const bw = W / n;
  const totals = values.map((r) => r.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals) || 1;
  const every = Math.ceil(n / 7);
  const u = unit ? ` ${unit}` : '';
  return (
    <svg className="wx-chart" viewBox={`0 0 ${W} ${H + 14}`} width="100%" role="img" aria-label={label}>
      {values.map((r, i) => {
        let y = H;
        return (
          <g key={categories[i]}>
            <title>{`${categories[i]}: ${fmt(totals[i])}${u}`}</title>
            {r.map((v, k) => {
              const h = (v / max) * H; y -= h;
              return h > 0.2 ? <rect key={k} x={i * bw + 0.5} y={y} width={Math.max(1, bw - 1)} height={h} fill={series[k].color} /> : null;
            })}
          </g>
        );
      })}
      <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
      {categories.map((c, i) => (i % every === 0 ? <text key={c} x={i * bw + bw / 2} y={H + 11} fontSize="9" fill="var(--faint)" textAnchor="middle">{c}</text> : null))}
      <text x="2" y="9" fontSize="9" fill="var(--faint)">{fmt(max)}{u}</text>
    </svg>
  );
}

/** Swatches for the series that have any value, in stack order. */
export function SeriesLegend({ series, values }: { series: Series[]; values: number[][] }) {
  const used = series.filter((_, k) => values.some((r) => r[k] > 0));
  return <ul className="chart-legend">{used.map((s) => <li key={s.label}><span className="swatch" style={{ background: s.color }} aria-hidden />{s.label}</li>)}</ul>;
}
```

- [ ] **Step 3: Type check**

Run: `cd web && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/StackedBars.tsx
git commit -m "Landscape: stacked bar chart"
```

---

### Task 12: Map layers for land cover and burned areas

**Files:**
- Create: `web/src/components/LandscapeLayers.tsx`

- [ ] **Step 1: Write the hooks** — create `web/src/components/LandscapeLayers.tsx`:

```tsx
import { useEffect } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { addLayers, setGeoJSON, setImage } from './MapView';
import type { LegendItem } from './LayersDrawer';
import { useData } from '../lib/useData';
import { validateLandscape, type LandscapeDoc } from '../lib/landscape';

export const LANDSCAPE_PATH = 'landscape/what-burns.json';
export const BURNED_PATH = 'landscape/burned-areas.geojson';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const LANDCOVER_CREDIT = '© EU, Copernicus Land Monitoring Service, EEA (CORINE 2018)';

/** CORINE 2018 land cover as an image under the data layers (D7); the landscape file loads only while the layer is on. */
export function useLandCover(map: MLMap | null, on: boolean) {
  const doc = useData(on ? LANDSCAPE_PATH : null, validateLandscape);
  useEffect(() => {
    if (!map) return;
    const d = doc.data;
    setImage(map, 'fw-landcover', on && d ? `/data/${d.image.path}` : null, d?.image.corners ?? [], { opacity: 0.55 });
  }, [map, on, doc.data]);
  return doc;
}

/** Legend rows for the ten land-cover groups. */
export const landCoverLegend = (d: LandscapeDoc | null): LegendItem[] =>
  (d ? [...d.groups.map((g) => ({ glyph: <span className="swatch" style={{ background: g.color }} />, label: g.label })),
    { glyph: <span />, label: 'Land cover', note: LANDCOVER_CREDIT }] : []);

/** EFFIS mapped burned areas (caller filters the features); fires under 30 ha get a dashed outline (D5). */
export function useBurnedLayer(map: MLMap | null, fc: GeoJSON.FeatureCollection | null) {
  useEffect(() => {
    if (!map) return;
    setGeoJSON(map, 'fw-burned', fc ?? EMPTY, 'Burned areas: EFFIS (CC BY 4.0)');
    addLayers(map, [
      { id: 'fw-burned-fill', type: 'fill', source: 'fw-burned', paint: { 'fill-color': '#FF6A00', 'fill-opacity': 0.22 } },
      { id: 'fw-burned-line', type: 'line', source: 'fw-burned', filter: ['!', ['get', 'small']], paint: { 'line-color': '#ff8a3d', 'line-width': 1.2 } },
      { id: 'fw-burned-small', type: 'line', source: 'fw-burned', filter: ['get', 'small'], paint: { 'line-color': '#ff8a3d', 'line-width': 1, 'line-dasharray': [1.5, 1.5] } },
    ]);
  }, [map, fc]);
}

export const BURNED_LEGEND: LegendItem = {
  glyph: <span className="swatch" style={{ background: 'rgba(255,106,0,0.35)', border: '1px solid #ff8a3d' }} />,
  label: 'Mapped burned area', note: 'EFFIS, from 2016; dashed = under 30 ha',
};
```

- [ ] **Step 2: Type check**

Run: `cd web && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/LandscapeLayers.tsx
git commit -m "Landscape: land-cover and burned-area map layers"
```

---

### Task 13: The Landscape page

**Files:**
- Create: `web/src/pages/Landscape.tsx`
- Modify: `web/src/styles.css` (append)

- [ ] **Step 1: Write the page** — create `web/src/pages/Landscape.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { Map as MLMap, MapLayerMouseEvent } from 'maplibre-gl';
import { validateGeoJSON } from '../lib/data';
import { useData } from '../lib/useData';
import { useExpert } from '../lib/mode';
import { download, fmt1, fmtInt } from '../lib/format';
import { MapView } from '../components/MapView';
import { Icon, IconHeading } from '../components/Icon';
import { SeriesLegend, StackedBars } from '../components/StackedBars';
import { BURNED_PATH, LANDSCAPE_PATH, useBurnedLayer, useLandCover } from '../components/LandscapeLayers';
import { burnedFor, monthlyAverage, ratioText, START_SENSORS, tableCSV, toShares, validateLandscape, yearsOf, type StartSensor } from '../lib/landscape';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SENSOR_NAME: Record<StartSensor, string> = { 'viirs-snpp': 'VIIRS S-NPP', modis: 'MODIS', 'viirs-jpss1': 'VIIRS NOAA-20' };
const pct = (v: number) => `${fmt1(v * 100)} %`;
const cell = (v: string | number) => (typeof v === 'number' ? (Number.isInteger(v) ? fmtInt(v) : fmt1(v)) : v);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** A chart's numbers as a table, with a CSV download in Expert (D23). */
function Numbers({ title = 'The numbers', name, header, rows, expert, credit, open = false }: {
  title?: string; name: string; header: string[]; rows: (string | number)[][]; expert: boolean; credit: string; open?: boolean;
}) {
  return (
    <details open={open}>
      <summary>{title}</summary>
      <div className="table-scroll"><table className="compact">
        <thead><tr>{header.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={String(r[0])}>{r.map((v, i) => (i ? <td key={i} className="num">{cell(v)}</td> : <th key={i} scope="row">{v}</th>))}</tr>)}</tbody>
      </table></div>
      {expert && <button type="button" onClick={() => download(`apexfire-${name}.csv`, tableCSV(header, rows, credit), 'text/csv')}><Icon name="download" size={16} />CSV</button>}
    </details>
  );
}

/** "More than its share" bars; the tick marks 1× (in proportion to the land). */
function ShareBars({ rows, label }: { rows: { label: string; color: string; land: number; ratio: number }[]; label: string }) {
  const max = Math.max(2, ...rows.map((r) => r.ratio));
  return (
    <ul className="share-bars" aria-label={label}>
      {rows.filter((r) => r.land > 0).map((r) => (
        <li key={r.label}>
          <span className="sb-label">{r.label}<small>{pct(r.land)} of the land</small></span>
          <span className="sb-track" aria-hidden><span className="sb-bar" style={{ width: `${(r.ratio / max) * 100}%`, background: r.color }} /><span className="sb-one" style={{ left: `${(1 / max) * 100}%` }} /></span>
          <b className="num">{ratioText(r.ratio)}</b>
        </li>
      ))}
    </ul>
  );
}

export function Landscape() {
  const expert = useExpert();
  const doc = useData(LANDSCAPE_PATH, validateLandscape);
  const burned = useData(BURNED_PATH, validateGeoJSON);
  const [map, setMap] = useState<MLMap | null>(null);
  const [show, setShow] = useState({ land: true, burned: true });
  const [year, setYear] = useState<number | 'all'>('all');
  const [sensor, setSensor] = useState<StartSensor>('viirs-snpp');
  const [source, setSource] = useState<'nasa' | 'effis'>('nasa');
  const [shares, setShares] = useState(false);
  const [picked, setPicked] = useState<Record<string, unknown> | null>(null);
  useLandCover(map, show.land);
  const fc = useMemo(() => (burned.data && show.burned ? burnedFor(burned.data, year) : null), [burned.data, show.burned, year]);
  useBurnedLayer(map, fc);
  useEffect(() => {
    if (!map) return;
    const pick = (e: MapLayerMouseEvent) => setPicked(e.features?.[0]?.properties ?? null);
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', 'fw-burned-fill', pick); map.on('mouseenter', 'fw-burned-fill', enter); map.on('mouseleave', 'fw-burned-fill', leave);
    return () => { map.off('click', 'fw-burned-fill', pick); map.off('mouseenter', 'fw-burned-fill', enter); map.off('mouseleave', 'fw-burned-fill', leave); };
  }, [map]);
  useEffect(() => setPicked(null), [year]);

  if (doc.error) return <div className="page prose"><h1 id="page-title" tabIndex={-1}>Landscape</h1><p className="error" role="alert">{doc.error}</p></div>;
  const d = doc.data;
  if (!d) return <div className="page prose"><p role="status">Loading the landscape…</p></div>;

  const credit = d.credits.join(' ');
  const groups = d.groups.map((g) => ({ label: g.label, color: g.color }));
  const fields = d.fields.map((f) => ({ label: f.label, color: f.color }));
  const st = d.starts[sensor];
  const avg = monthlyAverage(st);
  const asShares = shares && expert;
  const monthRows = asShares ? toShares(avg) : avg;
  const act = d.activity[sensor];
  const actAvg = act.by_month_group.map((r) => r.map((v) => v / (act.years[1] - act.years[0] + 1)));
  const nasaYears = yearsOf(d.nasa.years); const effisYears = yearsOf(d.effis.years);
  const burnRows = source === 'nasa' ? d.nasa.by_year_group : d.effis.ge30.by_year_field;
  const burnCats = source === 'nasa' ? nasaYears.map(String) : effisYears.map((y) => (y === d.effis.years[1] ? `${y}*` : String(y)));
  const burnClasses = source === 'nasa' ? d.groups : d.fields;
  const catches = d.shares.catches[sensor].map((r, i) => ({ ...groups[i], land: d.shares.catches_land[sensor][i], ratio: r }));
  const consumes = source === 'nasa'
    ? d.shares.consumes_nasa.map((r, i) => ({ ...groups[i], land: d.shares.consumes_nasa_land[i], ratio: r }))
    : d.shares.consumes_effis.map((r, i) => ({ ...fields[i], land: d.shares.consumes_effis_land[i], ratio: r }));
  const sum = (r: number[]) => r.reduce((a, b) => a + b, 0);
  const largest = year !== 'all' && fc ? [...fc.features].sort((a, b) => Number(b.properties?.area_ha) - Number(a.properties?.area_ha)).slice(0, 10) : [];

  return (
    <div className="page story">
      <IconHeading as="h1" icon="leaf" id="page-title">Landscape</IconHeading>
      <p className="kind-tag">What burns in North Macedonia: land cover (CORINE), mapped burned areas (EFFIS, NASA MCD64A1) and fire starts seen by satellites (NASA FIRMS).</p>
      <div className="story-grid">
        <section className="map-pane" aria-label="Map of land cover and mapped burned areas">
          <MapView label="North Macedonia land cover and mapped burned areas" onReady={setMap}>
            <ul className="legend" aria-label="Map legend">
              {show.burned && <li><span className="swatch" style={{ background: 'rgba(255,106,0,0.35)', border: '1px solid #ff8a3d' }} aria-hidden />Mapped burned area{year === 'all' ? ', 2016 to now' : `, ${year}`}</li>}
              {show.land && d.groups.map((g) => <li key={g.id}><span className="swatch" style={{ background: g.color }} aria-hidden />{g.label}</li>)}
            </ul>
          </MapView>
        </section>
        <div className="story-side">
          <section aria-labelledby="ls-take-h">
            <IconHeading icon="leaf" id="ls-take-h" className="h3">{expert ? 'Takeaways' : 'In short'}</IconHeading>
            <ul className="plain">{d.takeaways.map((t) => <li key={t.id} style={{ marginBottom: 8 }}>{t.text}</li>)}</ul>
            {expert && <p className="hint">Generated from the exported numbers on {d.export_date} by fixed templates; no figure is typed by hand.</p>}
          </section>

          <section aria-labelledby="ls-map-h">
            <IconHeading icon="map" id="ls-map-h" className="h3">On the map</IconHeading>
            <label className="check"><input type="checkbox" checked={show.land} onChange={(e) => setShow((s) => ({ ...s, land: e.target.checked }))} />Land cover (CORINE 2018)</label>
            <label className="check"><input type="checkbox" checked={show.burned} onChange={(e) => setShow((s) => ({ ...s, burned: e.target.checked }))} />Mapped burned areas (EFFIS)</label>
            <label className="stack">Year
              <select value={String(year)} onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                <option value="all">All, {d.effis.years[0]}–{d.effis.years[1]}</option>
                {effisYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            {burned.error && <p className="error small" role="alert">{burned.error}</p>}
            {picked ? <p className="small" role="status"><strong>{fmtInt(Number(picked.area_ha))} ha mapped, {String(picked.firedate)}{picked.finaldate ? ` to ${String(picked.finaldate)}` : ''}</strong>
              {picked.small ? ' · under 30 ha, so not counted in the charts' : ''}<br />
              {d.fields.filter((f) => Number(picked[f.id]) > 0).map((f) => `${f.label} ${fmt1(Number(picked[f.id]))} %`).join(' · ')}</p>
              : <p className="hint">Tap a burned area for its dates, size and what it burned.</p>}
            {largest.length > 0 && <details><summary>Largest mapped fires in {year}</summary><ul className="plain">{largest.map((f) => (
              <li key={String(f.properties?.id)}><button type="button" className="link-btn" onClick={() => setPicked(f.properties ?? null)}>{fmtInt(Number(f.properties?.area_ha))} ha from {String(f.properties?.firedate)}</button></li>))}</ul></details>}
            {expert && <Numbers title="Land cover by CORINE code (2018)" name="corine-2018" expert credit={credit} header={['CORINE code', 'Group', 'Share of land %']}
              rows={Object.entries(d.land['2018'].codes).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, d.groups.find((g) => g.codes.includes(c))?.label ?? '–', r1(v * 100)])} />}
          </section>

          <section aria-labelledby="ls-when-h">
            <IconHeading icon="calendar" id="ls-when-h" className="h3">What catches fire, and when</IconHeading>
            <div className="seg" role="group" aria-label="Satellite">{START_SENSORS.map((s) => (
              <button key={s} type="button" aria-pressed={sensor === s} onClick={() => setSensor(s)}>{SENSOR_NAME[s]} {d.starts[s].years[0]}–{d.starts[s].years[1]}</button>))}</div>
            {expert && <label className="check"><input type="checkbox" checked={shares} onChange={(e) => setShares(e.target.checked)} />Shares within each month</label>}
            <StackedBars categories={MONTHS} series={groups} values={monthRows} unit={asShares ? '' : 'starts'} fmt={asShares ? pct : fmt1}
              label={`${asShares ? 'Share of fire starts' : 'Average fire starts'} per month by land type, ${SENSOR_NAME[sensor]} ${st.years.join('–')}`} />
            <SeriesLegend series={groups} values={monthRows} />
            <p className="small">{expert
              ? `${fmtInt(st.total)} fire starts: detections joined within 2 km and ${st.gap_hours} h, each classed by the land under its first detection's footprint (the CORINE edition at or before its year). With a 48 h gap there would be ${fmtInt(st.total_48h)} (${fmt1(100 * (1 - st.total_48h / st.total))} % fewer).`
              : 'Each bar is an average month: how many fires started and on what land. A fire start is the first time satellites saw a fire, not the confirmed moment it was lit.'}</p>
            <Numbers name={`fire-starts-${sensor}`} header={['Month', ...d.groups.map((g) => g.label)]} rows={MONTHS.map((m, i) => [m, ...monthRows[i].map((v) => (asShares ? r1(v * 100) : r1(v)))])} expert={expert} credit={credit} />
            {expert && <>
              <h4 className="eyebrow">Fire activity: every detection</h4>
              <StackedBars categories={MONTHS} series={groups} values={actAvg} unit="detections" fmt={fmt1} label={`Average detections per month by land type, ${SENSOR_NAME[sensor]}`} />
              <p className="hint">{fmtInt(act.detections)} vegetation-fire detections, each shared over the land under its footprint. Long fires weigh more here than in fire starts.</p>
            </>}
          </section>

          <section aria-labelledby="ls-share-h">
            <IconHeading icon="compare" id="ls-share-h" className="h3">Burns more than its share</IconHeading>
            <p className="small">Above 1× a land type catches fire, or loses area to fire, more often than its size alone would suggest; below 1×, less.</p>
            <h4 className="eyebrow">Catches fire ({SENSOR_NAME[sensor]})</h4>
            <ShareBars rows={catches} label={`Fire starts relative to land share, ${SENSOR_NAME[sensor]}`} />
            <h4 className="eyebrow">Fire consumes ({source === 'nasa' ? 'NASA MCD64A1' : 'EFFIS, fires of 30 ha and up'})</h4>
            <ShareBars rows={consumes} label="Burned area relative to land share" />
            <Numbers name={`more-than-its-share-${sensor}`} header={['Land type', 'Share of land %', 'Catches fire ×', 'Fire starts per 100 km² per year']}
              rows={catches.map((c, i) => [c.label, r1(c.land * 100), c.ratio, d.shares.rates[sensor][i]])} expert={expert} credit={credit} />
          </section>

          <section aria-labelledby="ls-burn-h">
            <IconHeading icon="flame" id="ls-burn-h" className="h3">What burned</IconHeading>
            <div className="seg" role="group" aria-label="Burned-area source">
              <button type="button" aria-pressed={source === 'nasa'} onClick={() => setSource('nasa')}>NASA {d.nasa.years.join('–')}</button>
              <button type="button" aria-pressed={source === 'effis'} onClick={() => setSource('effis')}>EFFIS {d.effis.years.join('–')}</button>
            </div>
            <StackedBars categories={burnCats} series={source === 'nasa' ? groups : fields} values={burnRows} unit="ha" label={`Burned hectares per year by land type, ${source === 'nasa' ? 'NASA MCD64A1' : 'EFFIS'}`} />
            <SeriesLegend series={source === 'nasa' ? groups : fields} values={burnRows} />
            <p className="small">{source === 'nasa'
              ? 'NASA MODIS burned-area map (MCD64A1): 500 m cells of about 21 ha. It misses small and short fires, so its farmland figures are a floor.'
              : `EFFIS fires of 30 ha and up, as in EFFIS's own statistics, clipped to the border. *${d.effis.years[1]} runs to ${d.effis.to_date}.`}</p>
            <Numbers name={`burned-${source}`} header={['Year', ...burnClasses.map((c) => c.label)]} rows={burnCats.map((y, i) => [y, ...burnRows[i].map((v) => Math.round(v))])} expert={expert} credit={credit} />
            {expert && <Numbers title="NASA and EFFIS compared" name="burned-compared" credit={credit} expert
              header={['Year', 'NASA ha', 'EFFIS ha, 30 ha and up', 'EFFIS ha, all mapped', 'EFFIS fires (MK, 30 ha and up)', 'EFFIS annual estimate, fires', 'EFFIS annual estimate, ha']}
              rows={d.effis.cross_check.filter((c) => c.year <= d.nasa.years[1]).map((c) => [String(c.year), Math.round(sum(d.nasa.by_year_group[c.year - d.nasa.years[0]])),
                Math.round(sum(d.effis.ge30.by_year_field[c.year - d.effis.years[0]])), Math.round(sum(d.effis.all.by_year_field[c.year - d.effis.years[0]])), c.fires, c.estimate_fires ?? '–', c.estimate_ha ?? '–'])} />}
          </section>

          <section aria-labelledby="ls-spread-h">
            <IconHeading icon="spread" id="ls-spread-h" className="h3">What spreads</IconHeading>
            <p className="small">{expert
              ? 'Observed outcomes, not a model: EFFIS fire size (fires of 30 ha and up, whole fire) by the fire\'s largest land-cover field, and days from first to last detection of each fire start by the land it started on.'
              : 'How big fires got, and how long satellites kept seeing them, by the land they burned in.'}</p>
            <Numbers title="Fire size by land type (EFFIS)" open name="fire-size" expert={expert} credit={credit} header={['Land type', 'Fires', 'Median ha', '90th percentile ha', 'Largest ha']}
              rows={d.fields.filter((f) => d.effis.spread[f.id]).map((f) => { const s = d.effis.spread[f.id]; return [f.label, s.n, s.median_ha, s.p90_ha, s.max_ha]; })} />
            <Numbers title={`Days visible by land type (${SENSOR_NAME[sensor]})`} open name={`days-visible-${sensor}`} expert={expert} credit={credit} header={['Land type', 'Fire starts', 'Median days', '90th percentile days']}
              rows={d.groups.filter((g) => st.duration[g.id]).map((g) => { const s = st.duration[g.id]; return [g.label, s.n, s.median_days, s.p90_days]; })} />
          </section>

          <section aria-labelledby="ls-methods-h">
            <IconHeading icon="info" id="ls-methods-h" className="h3">Methods and limits</IconHeading>
            <details open={expert}>
              <summary>How this was worked out</summary>
              <ul className="small">
                <li>A fire start is the first satellite sighting of a group of detections, not a confirmed ignition. Detections are hot pixels, not fires.</li>
                <li>Land comes from CORINE Land Cover on a 100 m grid, using the edition at or before each fire's year (2000, 2006, 2012 or 2018); the map shows 2018. Editions differ in method, so some change between them is mapping change, not land change.</li>
                <li>Each detection's footprint (its pixel, 375 m to about 1 km wide) is shared over the land beneath it. Real footprints are not rectangles, so the shares are approximate.</li>
                <li>Factories and other fixed heat sources (FIRMS type 2) are left out. Detection charts stop at 2025 because near-real-time data cannot tell those sources apart.</li>
                <li>The archive holds only detections inside the country, so a fire that crossed the border counts from its first sighting inside.</li>
                <li>EFFIS charts count fires of 30 ha and up, as EFFIS's own statistics do; each fire's land-cover shares are applied to its part inside the border.</li>
                <li>NASA MCD64A1 maps burned 500 m cells each month and misses small and short fires.</li>
              </ul>
            </details>
            {expert && <p className="small">Download: <a href={`/data/${LANDSCAPE_PATH}`} download>what-burns.json</a> · <a href={`/data/${BURNED_PATH}`} download>burned-areas.geojson</a></p>}
            <p className="hint">{credit}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the styles** — append to `web/src/styles.css`:

```css
/* Landscape: "more than its share" bars (the tick marks 1×) and chart legends. */
.share-bars { list-style: none; margin: 8px 0 14px; padding: 0; display: grid; gap: 8px; }
.share-bars li { display: grid; grid-template-columns: minmax(0, 11rem) minmax(0, 1fr) 3.2rem; gap: 10px; align-items: center; }
.sb-label { font-size: var(--step--1); line-height: 1.25; }
.sb-label small { display: block; color: var(--faint); }
.sb-track { position: relative; height: 12px; background: var(--ink-2); border-radius: 6px; }
.sb-bar { position: absolute; inset: 0 auto 0 0; border-radius: 6px; }
.sb-one { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--text); }
.share-bars b { text-align: right; font-size: var(--step--1); }
.chart-legend { list-style: none; padding: 0; margin: 6px 0 10px; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: var(--step--1); color: var(--muted); }
.chart-legend .swatch { margin-right: 6px; }
```

- [ ] **Step 3: Type check**

Run: `cd web && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Landscape.tsx web/src/styles.css
git commit -m "Landscape: the page"
```

---

### Task 14: Route, navigation and hosting rewrite

**Files:**
- Modify: `web/src/App.tsx`, `firebase.json`

- [ ] **Step 1: Wire the route** — in `web/src/App.tsx`:
  1. Add `import { Landscape } from './pages/Landscape';` after the `Explore` import.
  2. In `NAV`, insert `['/landscape', 'Landscape', 'Landscape', 'leaf'],` right after the `/explore` entry.
  3. In `TITLES`, add `'/landscape': 'Landscape',`.
  4. In `route()`, add `case '/landscape': return <Landscape />;` after the `/explore` case.

- [ ] **Step 2: Hosting rewrite** — in `firebase.json` `rewrites`, after the `/explore` rewrite, add:

```json
      {
        "source": "/landscape",
        "destination": "/index.html"
      },
```

- [ ] **Step 3: Build**

Run: `cd web && npm run build`
Expected: `public build boundary check passed`.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx firebase.json
git commit -m "Landscape: route, navigation and hosting rewrite"
```

---

### Task 15: Layers in Fires now and Archive (D9, D22)

**Files:**
- Modify: `web/src/pages/Now.tsx`, `web/src/pages/Explore.tsx`

- [ ] **Step 1: Fires now.** In `web/src/pages/Now.tsx`:
  1. Add the import `import { landCoverLegend, useLandCover } from '../components/LandscapeLayers';`.
  2. In the `show` state (line 123), add `land: false`.
  3. Right after the `mk` line, add `const land = useLandCover(map, show.land);`.
  4. In the `useMapCleanup` call, add `'fw-landcover-layer'` to the layer list and `'fw-landcover'` to the source list.
  5. Add `...(show.land ? landCoverLegend(land.data) : []),` as the last item of the `legend` array that starts at line 229.
  6. In the `LayersDrawer` `layers` array, insert this before the `boundary` entry:

```tsx
        { id: 'land', label: 'Land cover', detail: land.error ?? (expert ? 'CORINE 2018 (Copernicus Land, EEA), ten groups' : 'Forest, scrub, grassland and farmland'),
          checked: show.land, onChange: (on) => setShow((s) => ({ ...s, land: on })) },
```

- [ ] **Step 2: Archive.** In `web/src/pages/Explore.tsx`:
  1. Add the imports `import { BURNED_LEGEND, BURNED_PATH, landCoverLegend, useBurnedLayer, useLandCover } from '../components/LandscapeLayers';` and `import { archiveBurnedYear, burnedFor } from '../lib/landscape';`.
  2. Change the `show` state (line 232) to `useState({ dets: true, boundary: true, wind: true, mkFwi: false, land: false, burned: false })`.
  3. After that line, add:

```tsx
  const land = useLandCover(map, show.land);
  const burnedAll = useData(show.burned ? BURNED_PATH : null, validateGeoJSON);
  const burnedYear = archiveBurnedYear(state.year);
  const burnedFc = useMemo(() => (show.burned && burnedAll.data && burnedYear !== null ? burnedFor(burnedAll.data, burnedYear) : null), [show.burned, burnedAll.data, burnedYear]);
  useBurnedLayer(map, burnedFc);
```

  4. In the `useMapCleanup` call, add the layers `'fw-landcover-layer', 'fw-burned-fill', 'fw-burned-line', 'fw-burned-small'` and the sources `'fw-landcover', 'fw-burned'`.
  5. Add `...(show.land ? landCoverLegend(land.data) : []), ...(show.burned && burnedYear !== null ? [BURNED_LEGEND] : []),` as the last items of the `legend` array at line 336.
  6. In the `LayersDrawer` `layers` array, insert this before the `boundary` entry:

```tsx
      { id: 'land', label: 'Land cover', detail: land.error ?? (expert ? 'CORINE 2018 (Copernicus Land, EEA), ten groups' : 'Forest, scrub, grassland and farmland'),
        checked: show.land, onChange: (on) => setShow((s) => ({ ...s, land: on })) },
      { id: 'burned', label: 'Mapped burned areas', checked: show.burned, onChange: (on) => setShow((s) => ({ ...s, burned: on })),
        detail: burnedAll.error ?? (burnedYear === null ? `EFFIS mapping starts in 2016; nothing for ${state.year}` : burnedFc ? `${fmtInt(burnedFc.features.length)} mapped by EFFIS in ${state.year}` : `EFFIS, ${state.year}`) },
```

- [ ] **Step 3: Type check and tests**

Run: `cd web && npx tsc --noEmit -p . && npx vitest run`
Expected: no type errors; all test files pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Now.tsx web/src/pages/Explore.tsx
git commit -m "Map: land-cover layer in Fires now and Archive; burned areas follow the Archive year"
```

---

### Task 16: Sources, README, website spec, PROJECT.md

**Files:**
- Modify: `web/src/pages/DataMethods.tsx`, `README.md`, `docs/website-spec.md`, `PROJECT.md` (local-only)

- [ ] **Step 1: Data & Methods.**
  1. In `SOURCES`, change the EFFIS row's `use` to `'Brvenica official perimeter; live season panel (Expert, Fires now), requested by your browser; Landscape burned areas 2016 to now (layer and charts)'`.
  2. Insert after it:

```ts
  { name: 'CORINE Land Cover 2000, 2006, 2012, 2018 (EEA, Copernicus Land Monitoring Service)', cls: 'land_cover', use: 'Landscape: land under each fire start and burned cell, land shares, land-cover layer', time: 'Editions 2000, 2006, 2012, 2018 on a 100 m grid', rights: '© European Union, Copernicus Land Monitoring Service, EEA; free with attribution', url: 'https://land.copernicus.eu/en/products/corine-land-cover' },
  { name: 'NASA MODIS MCD64A1 v061 burned area (LP DAAC)', cls: 'observed_burned_area', use: 'Landscape: burned area by land type; Mariovo evidence', time: 'Monthly 2001–2025, tile h19v04', rights: 'NASA open data', url: 'https://lpdaac.usgs.gov/products/mcd64a1v061/' },
```

- [ ] **Step 2: README.**
  1. Add a row after the Fire stories row of the "For experts" table:

     `| **Landscape** | What burns in North Macedonia: fire starts by land type and month (MODIS 2001–2025, VIIRS 2012–2025), burned area by land type from NASA MCD64A1 (2001–2025) and EFFIS (2016 to now), which land burns more than its share, fire size and duration; land-cover and burned-area map layers. |`
  2. Add to "Data sources and licences":

     `| [CORINE Land Cover](https://land.copernicus.eu/en/products/corine-land-cover) 2000–2018 (EEA) | Landscape land cover | © EU, Copernicus Land Monitoring Service; attribution |`

     `| [NASA MCD64A1](https://lpdaac.usgs.gov/products/mcd64a1v061/) v061 | Burned area 2001–2025 | NASA open data |`
  3. In the commands block, after the `fetch_fire_stories` line, add:

     `python3 tools/fetch_landscape.py` with the comment `# CORINE 2000–2018 + EFFIS burned areas (no key)`

     `uv run --python 3.14 tools/fetch_mcd64a1.py` with the comment `# NASA MCD64A1 2001–2025 (Earthdata bearer)`

- [ ] **Step 3: Website spec.** Add a row to the route table in `docs/website-spec.md` after `/explore?mode=current`:

`| /landscape | Takeaways; CORINE 2018 land cover and EFFIS burned areas with a year selector; fire starts by month and land type (sensor switch); more-than-its-share figures; burned area by year (NASA/EFFIS switch); fire size and duration; methods and downloads | Numbers match what-burns.json; failed loads show an error and no figures. Design: docs/superpowers/specs/2026-11-16-what-burns-design.md |`

- [ ] **Step 4: PROJECT.md** (git-ignored, local). Add a state paragraph after "Live Expert panels":

`**Landscape / What burns (slice 1, <today's date>):** /landscape page plus land-cover (Fires now, Archive) and burned-area (Archive) layers, built from CORINE 2000–2018, EFFIS 2016–now, NASA MCD64A1 2001–2025 and the FIRMS archive. Re-export after each fire season and whenever EFFIS revises a year (D25): .venv/bin/python tools/fetch_landscape.py; uv run --python 3.14 tools/fetch_mcd64a1.py; .venv/bin/python tools/export_web_data.py. Last run: <today's date>. Next slices: fuel and danger, living landscape, agriculture and aftermath.`

- [ ] **Step 5: Build and commit**

Run: `cd web && npm run build`
Expected: `public build boundary check passed`.

```bash
git add web/src/pages/DataMethods.tsx README.md docs/website-spec.md
git commit -m "Docs: Landscape sources, features and screen entry"
```

---

### Task 17: Verify, review takeaways, deploy, push, hand off (D18, D19)

- [ ] **Step 1: All tests**

Run: `.venv/bin/python -m unittest tests/test_landscape.py tests/test_export_web_data.py && (cd web && npx vitest run && npm run build)`
Expected: all pass, and `public build boundary check passed`.

- [ ] **Step 2: Browser check.** Build the deploy artifact with `cd web && VITE_MKFFIS_WMS= npm run build`, then `preview_start apexfire-preview`. Check:
  1. `/landscape` in Simple and in Expert.
  2. Every switch: sensor, shares, source, year.
  3. Tapping a burned area, and the "largest fires" buttons.
  4. Each CSV and download link.
  5. Fires now: the land-cover layer.
  6. Archive: 2019 shows burned areas; 2010 shows the "EFFIS mapping starts in 2016" note.
  7. 375 px touch emulation, keyboard-only navigation, reduced motion.
  8. `read_console_messages` reports no errors.

  Take one desktop screenshot of `/landscape` as proof.

- [ ] **Step 3: SAI reviews the takeaways (D18).** Send SAI the three generated sentences from `what-burns.json`, with the screenshot. Wait for their OK before deploying. If they want a template changed, change `takeaways()`, re-export and re-run Step 1.

- [ ] **Step 4: Deploy and push** (only after SAI's OK)

```bash
cd web && VITE_MKFFIS_WMS= npm run build && cd .. && firebase deploy --only hosting
git push origin main
```

Then verify on https://apexfire.web.app/landscape that the page loads `landscape/what-burns.json` and shows the takeaways.

- [ ] **Step 5: Codex handoff.** In `CODEX_HANDOFF.md` (local), add a section "Changes in candidate 9: Landscape (What burns)". Follow the MTS §5 structure. Name the deployed commit, the spec, this plan, the field-mapping check result (`effis.field_check`), and what was not verified. Then update PROJECT.md "Last run" with the date.
