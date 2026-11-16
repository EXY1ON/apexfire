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

OTHER = ["331", "332", "333", "334", "335"] + URBAN + WATER  # hardly burns: folded into one grey series (D27)

# Eight chart groups (D8 as amended by D27). Colours are the dataviz skill's validated dark-mode hues in an order that
# passes every check for stacked charts (worst adjacent colour-blind delta E 9.4); "Other land" is the grey de-emphasis.
GROUPS = [
    {"id": "broadleaf", "label": "Broadleaf forest", "color": "#0ca30c", "codes": ["311"]},
    {"id": "conifer", "label": "Conifer forest", "color": "#3987e5", "codes": ["312"]},
    {"id": "mixed", "label": "Mixed forest", "color": "#199e70", "codes": ["313"]},
    {"id": "shrub", "label": "Shrubland and young woodland", "color": "#d95926", "codes": ["322", "323", "324"]},
    {"id": "grass", "label": "Grassland and pasture", "color": "#9085e9", "codes": ["231", "321"]},
    {"id": "arable", "label": "Arable land", "color": "#c98500", "codes": ["211", "212", "213"]},
    {"id": "orchards", "label": "Orchards, vineyards and mixed farming", "color": "#d55181",
     "codes": ["221", "222", "223", "241", "242", "243", "244"]},
    {"id": "other", "label": "Other land (bare, urban, water)", "color": "#7d7c76", "codes": OTHER},
]
# EFFIS per-fire land-cover fields as charted (D27 folds sclerophyll + transitional, and artificial + water). The code
# lists are inferred from the field names; export() checks them against EFFIS's own shares (check_field_mapping).
FIELDS = [
    {"props": ["BROADLEA"], "id": "broadleaf", "label": "Broadleaf forest", "color": "#0ca30c", "codes": ["311"]},
    {"props": ["CONIFER"], "id": "conifer", "label": "Conifer forest", "color": "#3987e5", "codes": ["312"]},
    {"props": ["MIXED"], "id": "mixed", "label": "Mixed forest", "color": "#199e70", "codes": ["313"]},
    {"props": ["SCLEROPH", "TRANSIT"], "id": "shrub", "label": "Shrubland and young woodland", "color": "#d95926", "codes": ["323", "324"]},
    {"props": ["OTHERNATLC"], "id": "other_natural", "label": "Other natural land", "color": "#9085e9",
     "codes": ["321", "322", "331", "332", "333", "334", "335"]},
    {"props": ["AGRIAREAS"], "id": "agricultural", "label": "Agricultural land", "color": "#c98500", "codes": FARMLAND},
    {"props": ["ARTIFSURF", "OTHERLC"], "id": "other", "label": "Other land (urban, water)", "color": "#7d7c76", "codes": URBAN + WATER},
]
# EFFIS's own nine fields, kept per burned area for the tap details (full detail, D27).
RAW_FIELDS = [("BROADLEA", "broadleaf", "Broadleaf forest"), ("CONIFER", "conifer", "Conifer forest"), ("MIXED", "mixed", "Mixed forest"),
              ("SCLEROPH", "sclerophyll", "Sclerophyllous scrub"), ("TRANSIT", "transitional", "Transitional woodland-shrub"),
              ("OTHERNATLC", "other_natural", "Other natural land"), ("AGRIAREAS", "agricultural", "Agricultural land"),
              ("ARTIFSURF", "artificial", "Artificial surfaces"), ("OTHERLC", "other", "Water, wetland and other")]
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
        raw = [float(p[k] or 0) for k, _, _ in RAW_FIELDS]
        sh = np.array([sum(float(p[k] or 0) for k in x["props"]) for x in FIELDS])
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
                                   **{fid: round(v, 1) for (_, fid, _), v in zip(RAW_FIELDS, raw)}}})
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
        "raw_fields": [{"id": fid, "label": label} for _, fid, label in RAW_FIELDS],
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
