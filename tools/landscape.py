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
