#!/usr/bin/env python3
"""Spread Lab precompute: genuine Pyretechnics runs for what-if wind/dryness/ignition choices on the Mariovo landscape,
real ERA5 afternoons and one comparison with a mapped fire. Experimental and uncalibrated, never a forecast.

Inputs are cached under Data/readiness/spread-lab; `--fetch` downloads missing ones (Open-Meteo ERA5, EFFIS fuel WCS/WMS,
NASADEM and ESA WorldCover crops from Planetary Computer). Without it the run is offline. Output: Data/readiness/spread-lab/web,
which tools/export_web_data.py validates and copies to web/public/data/spread/lab.
Run with the isolated Pyretechnics environment described in docs/readiness/spread-scenario.md."""

import argparse
import base64
import hashlib
import importlib.metadata
import json
import math
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform as transform_coords, transform_bounds, transform_geom

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import run_spread_scenario as rs  # noqa: E402

ROOT = TOOLS.parent
WORK = ROOT / "Data/readiness/spread-lab"
OUT = WORK / "web"
FUELS = ROOT / "Data/readiness/fuels"
EFFIS = "https://maps.effis.emergency.copernicus.eu/effis"
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
ERA5_POINT = (41.27, 21.65)  # the Mariovo case weather point; Open-Meteo snaps it to the ERA5 cell it reports
ERA5_FILE = WORK / "era5-mariovo-2016-2025.json"
ECMWF_FILE = ROOT / "Data/case-studies/mariovo-2024/weather/open-meteo-ecmwf-ifs-historical-forecast-2024-09-01_07.json"

RUNS_SCHEMA = "firewatch.spread.lab.runs.v1"
DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
SPEEDS = [0, 8, 15, 25, 40]  # km/h at 10 m; labels come from the local climatology below
HORIZON = 360                # what-if and real-day runs: a six-hour afternoon
STEP = 2                     # minutes per stored arrival step (uint8, 255 = not reached)
CHECKPOINTS = [30, 60, 120, 180, 240, 300, 360]
# Andrews & Rothermel (1982) hauling-chart flame-length breaks: 4, 8 and 11 ft.
FLAME_BREAKS_M = [1.2, 2.4, 3.4]

# Scott & Burgan (2005, RMRS-GTR-153) fuel-moisture scenarios, kg/kg; foliar moisture is unused (no canopy).
DRYNESS = [
    ("very-dry", "Very dry", "D1L1", (.03, .04, .05, .30, .60)),
    ("dry", "Dry", "D2L2", (.06, .07, .08, .60, .90)),
    ("moderate", "Moderate", "D3L3", (.09, .10, .11, .90, 1.20)),
    ("damp", "Damp", "D4L4", (.12, .13, .14, 1.20, 1.50)),
]
MOISTURE_KEYS = ["fuel_moisture_dead_1hr", "fuel_moisture_dead_10hr", "fuel_moisture_dead_100hr",
                 "fuel_moisture_live_herbaceous", "fuel_moisture_live_woody"]
SUMMER_LIVE = (.60, .90)  # L2 live herbaceous/woody for real summer days: an assumption, not measured

# Anderson (1982) / NFFL names; colours are the EFFIS fuel-map legend swatches (models 1-10).
FUEL_MODELS = {
    1: ("Short grass", "grass", "#10f060"), 2: ("Timber with grass understory", "open woodland", "#10c040"),
    3: ("Tall grass", "tall grass", "#108010"), 4: ("Chaparral", "dense shrub", "#e0e000"),
    5: ("Brush", "brush", "#ffff00"), 6: ("Dormant brush", "dormant brush", "#ffcc00"),
    7: ("Southern rough", "rough shrub", "#ff6600"), 8: ("Closed timber litter", "conifer litter", "#c08040"),
    9: ("Hardwood litter", "oak litter", "#a04000"), 10: ("Timber with litter and understory", "heavy timber", "#703030"),
}
IGNITIONS = [  # north-up (row, col) on the Mariovo grid; the first is the original verified run's ignition
    ("centre", "Valley brush (original start)", (83, 72)),
    ("grass", "Dry pasture, south-east", (117, 98)),
    ("oak", "Oak woodland, north", (39, 83)),
]
# Mapped fires in mostly natural vegetation; crops reach about 6 km beyond the EFFIS perimeter. step: stored arrival
# minutes per uint8 code, so the run from first to last detection fits 254 steps.
BACKTESTS = [
    dict(id="negotino-2022", story="negotino-2022", name="Negotino, July 2022", bbox=(22.05, 41.50, 22.23, 41.64),
         nasadem="NASADEM_HGT_n41e022", worldcover="ESA_WorldCover_10m_2021_v200_N39E021", step=15),
    dict(id="makedonski-brod-2019", story="makedonski-brod-2019", name="Makedonski Brod, September 2019", bbox=(21.22, 41.43, 21.43, 41.61),
         nasadem="NASADEM_HGT_n41e021", worldcover="ESA_WorldCover_10m_2021_v200_N39E021", step=30),
]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n")


def get(url, timeout=90):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def emc_percent(t_c, rh):
    """Simard (1968) equilibrium moisture content as used in the NFDRS; T converted to °F, RH in %."""
    t, rh = np.asarray(t_c, float) * 9 / 5 + 32, np.asarray(rh, float)
    return np.where(rh < 10, 0.03229 + 0.281073 * rh - 0.000578 * rh * t,
                    np.where(rh < 50, 2.22749 + 0.160107 * rh - 0.014784 * t,
                             21.0606 + 0.005565 * rh ** 2 - 0.00035 * rh * t - 0.483199 * rh))


def weather_moisture(t, rh, history_emc):
    """Hourly dead moisture from the NFDRS rules (1-h = 1.03 EMC, 10-h = 1.28 EMC without fuel sticks); 100-h is the
    previous four days' mean EMC, a stand-in for the NFDRS 24-h boundary method. Live values are the L2 assumption."""
    e = emc_percent(t, rh)
    # Floor at 1 %: the regressions approach zero at extreme dryness and the engine needs positive moisture.
    return dict(fuel_moisture_dead_1hr=np.maximum(1.03 * e, 1) / 100, fuel_moisture_dead_10hr=np.maximum(1.28 * e, 1) / 100,
                fuel_moisture_dead_100hr=np.full(len(e), max(float(np.mean(history_emc)), 1) / 100),
                fuel_moisture_live_herbaceous=SUMMER_LIVE[0], fuel_moisture_live_woody=SUMMER_LIVE[1], foliar_moisture=1.)


def preset_moisture(values):
    return dict(zip(MOISTURE_KEYS, values), foliar_moisture=1.)


# ---------- inputs ----------

def era5(fetch):
    if not ERA5_FILE.exists():
        if not fetch:
            raise SystemExit(f"{ERA5_FILE} missing: rerun with --fetch")
        q = urllib.parse.urlencode(dict(latitude=ERA5_POINT[0], longitude=ERA5_POINT[1], start_date="2016-01-01", end_date="2025-12-31",
                                        hourly="temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation",
                                        wind_speed_unit="kmh", timezone="UTC", models="era5"))
        ERA5_FILE.parent.mkdir(parents=True, exist_ok=True)
        ERA5_FILE.write_bytes(get("https://archive-api.open-meteo.com/v1/archive?" + q))
    d = json.loads(ERA5_FILE.read_text())
    if d["hourly_units"]["wind_speed_10m"] != "km/h" or d["utc_offset_seconds"] != 0:
        raise ValueError("expected UTC hourly ERA5 with km/h winds")
    h = d["hourly"]
    if any(v is None for k in h for v in h[k]):
        raise ValueError("ERA5 series has gaps")
    return d, {k: np.asarray(v) if k != "time" else v for k, v in h.items()}


def read_grid(paths):
    arrays, profile = {}, None
    for name, path in paths.items():
        with rasterio.open(path) as src:
            if profile and (src.shape != arrays[next(iter(arrays))].shape or src.transform != profile["transform"] or src.crs != profile["crs"]):
                raise ValueError("site inputs must share one grid")
            arrays[name] = src.read(1)
            profile = profile or src.profile.copy()
    return arrays, profile


def make_site(site_id, name, arrays, profile):
    grid = rs.engine_inputs(arrays["fuel"], arrays["cover"], arrays["elevation"])
    t, (rows, cols) = profile["transform"], arrays["fuel"].shape
    xs = [t.c, t.c + cols * t.a, t.c + cols * t.a, t.c]
    ys = [t.f, t.f, t.f + rows * t.e, t.f + rows * t.e]
    lons, lats = transform_coords(profile["crs"], "EPSG:4326", xs, ys)
    north_up_fuel = np.where(grid["excluded"], 0, arrays["fuel"]).astype("uint8")
    return dict(id=site_id, name=name, profile=profile, rows=rows, cols=cols, fuel_north_up=north_up_fuel,
                corners=[[round(lo, 6), round(la, 6)] for lo, la in zip(lons, lats)], **grid)


def mariovo_site():
    d = FUELS / "mariovo"
    arrays, profile = read_grid({"fuel": d / "fuel-model.tif", "cover": d / "worldcover.tif", "elevation": d / "elevation.tif"})
    if profile["crs"].to_epsg() != 32634 or profile["transform"].a != 100:
        raise ValueError("expected the 100 m UTM34N Mariovo grid")
    return make_site("mariovo", "Mariovo", arrays, profile)


def backtest_site(b, fetch):
    """EFFIS fuel categories (crosswalked through the official style, as for Mariovo), NASADEM and WorldCover on a 100 m UTM grid."""
    import fetch_case_data
    import prepare_spread_inputs as psi
    d = WORK / b["id"]
    d.mkdir(parents=True, exist_ok=True)
    merc = transform_bounds("EPSG:4326", "EPSG:3857", *b["bbox"])
    wcs, style = d / "effis-fuel.tif", d / "effis-fuel-style.png"
    if not (wcs.exists() and style.exists()):
        if not fetch:
            raise SystemExit(f"{d} inputs missing: rerun with --fetch")
        wcs.write_bytes(get(EFFIS + "?" + urllib.parse.urlencode([
            ("service", "WCS"), ("version", "2.0.1"), ("request", "GetCoverage"), ("coverageId", "fuel_map"),
            ("format", "image/tiff"), ("subset", f"x({merc[0]},{merc[2]})"), ("subset", f"y({merc[1]},{merc[3]})")])))
        with rasterio.open(wcs) as ds:
            w, h = ds.width, ds.height
            merc = ds.bounds  # style the exact returned raster footprint, pixel for pixel
        style.write_bytes(get(EFFIS + "?" + urllib.parse.urlencode([
            ("service", "WMS"), ("version", "1.3.0"), ("request", "GetMap"), ("layers", "fuel_map"), ("styles", "default"),
            ("crs", "EPSG:3857"), ("bbox", f"{merc[0]},{merc[1]},{merc[2]},{merc[3]}"), ("width", w), ("height", h), ("format", "image/png")])))
    fetch_case_data.BBOX = b["bbox"]
    crops = {}
    for key, collection, item_id, asset in [("elevation", "nasadem", b["nasadem"], "elevation"),
                                            ("cover", "esa-worldcover", b["worldcover"], "map")]:
        path = d / f"{key}-source.tif"
        if not path.exists():
            if not fetch:
                raise SystemExit(f"{path} missing: rerun with --fetch")
            item = json.loads(get(f"{STAC}/collections/{collection}/items/{item_id}"))
            fetch_case_data.save_crop(item, asset, path)
        crops[key] = path
    from PIL import Image
    legend = np.asarray(Image.open(FUELS / "source/effis-fuel-legend.png").convert("RGB"))
    with rasterio.open(wcs) as ds:
        raw = ds.read(1)
        crosswalk, purity = majority_crosswalk(raw, np.asarray(Image.open(style).convert("RGB")), legend, psi.COLORS)
        bounds = transform_bounds("EPSG:4326", "EPSG:32634", *b["bbox"])
        left, bottom = [math.floor(v / 100) * 100 for v in bounds[:2]]
        right, top = [math.ceil(v / 100) * 100 for v in bounds[2:]]
        grid, shape = from_origin(left, top, 100, 100), (int((top - bottom) / 100), int((right - left) / 100))
        codes = np.full(shape, 255, "uint8")
        reproject(raw.astype("uint8"), codes, src_transform=ds.transform, src_crs=ds.crs, src_nodata=255, dst_transform=grid,
                  dst_crs="EPSG:32634", dst_nodata=255, resampling=Resampling.nearest)
    fuel = np.zeros(shape, "uint8")
    for value, model in crosswalk.items():
        fuel[codes == value] = model
    arrays = {"fuel": fuel}
    for key, nodata, dtype, resampling in [("elevation", -9999, "float32", Resampling.bilinear), ("cover", 255, "uint8", Resampling.nearest)]:
        target = np.full(shape, nodata, dtype)
        with rasterio.open(crops[key]) as ds:
            reproject(rasterio.band(ds, 1), target, dst_transform=grid, dst_crs="EPSG:32634", dst_nodata=nodata, resampling=resampling)
        arrays[key] = target
    profile = dict(crs=rasterio.crs.CRS.from_epsg(32634), transform=grid)
    site = make_site(b["id"], b["name"], arrays, profile)
    site["crosswalk"] = dict(nffl=crosswalk, majority_colour_share=purity)
    site["inputs"] = [dict(path=str(p.relative_to(ROOT)), sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in (wcs, style, *crops.values())]
    return site


def majority_crosswalk(raw, rendered, legend, colors, min_share=.85):
    """EFFIS code -> NFFL model from the official style. This crop's WMS rendering is offset at class edges, so each code takes
    its majority colour: a code already crosswalked exactly elsewhere must agree with it, a new code needs >= 85 % of its pixels."""
    for i, color in enumerate(colors):
        if tuple(legend[9 + 15 * i, 10]) != color:
            raise ValueError("Official legend changed; inspect it before assigning models")
    verified = {}
    for area in json.loads((FUELS / "manifest.json").read_text())["areas"].values():
        verified.update({int(k): v for k, v in area["crosswalk_internal_to_nffl"].items()})
    crosswalk, share = {}, {}
    for value in np.unique(raw):
        cols, counts = np.unique(rendered[raw == value], axis=0, return_counts=True)
        top = tuple(int(c) for c in cols[np.argmax(counts)])
        share[int(value)] = round(float(counts.max() / counts.sum()), 3)
        model = 0 if top == (255, 255, 255) else colors.index(top) + 1 if top in colors else None
        known = int(value) in verified
        if model is None or share[int(value)] < (.5 if known else min_share):
            raise ValueError(f"EFFIS code {value}: no clear legend colour ({top}, {share[int(value)]:.0%})")
        if known and verified[int(value)] != model:
            raise ValueError(f"EFFIS code {value} disagrees with the verified crosswalk")
        crosswalk[int(value)] = model
    return crosswalk, share


# ---------- runs ----------

def engine_rc(site, rc):
    r, c = rc
    if site["excluded"][r, c]:
        raise ValueError(f"ignition {rc} is not a burnable cell")
    return site["rows"] - 1 - r, c


def run(site, rc, wind_kph, wind_from, moisture, minutes, start_minutes=0.):
    layers, stats = rs.simulate(site["fuel"], site["slope"], site["aspect"], wind_kph, wind_from, engine_rc(site, rc),
                                minutes=minutes, cell_m=100, moisture=moisture, start_minutes=start_minutes,
                                band_minutes=float(minutes) if np.size(wind_kph) == 1 else 60.)  # constant what-if wind: one band
    out = {k: np.flipud(v).copy() for k, v in layers.items()}
    burned = np.isfinite(out["time_of_arrival"])
    if burned[site["excluded"]].any():
        raise RuntimeError("engine burned an excluded cell")
    return out, stats


def summarize(site, rc, layers, horizon):
    a, fl, ros = layers["time_of_arrival"], layers["flame_length"], layers["spread_rate"]
    burned = np.isfinite(a)
    rows, cols = np.indices(a.shape)
    ring = np.minimum.reduce([rows, cols, site["rows"] - 1 - rows, site["cols"] - 1 - cols]) <= 4
    edge = float(a[burned & ring].min()) if (burned & ring).any() else None
    limit = min(horizon, edge) if edge is not None else horizon
    shown = burned & (a <= limit)
    ys, xs = np.where(shown)
    dist = np.hypot(ys - rc[0], xs - rc[1]) * .1
    k = int(np.argmax(dist))
    bearing = (math.degrees(math.atan2(xs[k] - rc[1], rc[0] - ys[k])) + 360) % 360
    f = fl[shown]
    classes = np.digitize(f, FLAME_BREAKS_M)
    return dict(
        area_ha=[int((burned & (a <= t)).sum()) if t <= limit else None for t in CHECKPOINTS if t <= horizon],
        final_ha=int(shown.sum()), edge_minute=None if edge is None else round(edge, 1),
        run_km=round(float(dist[k]), 2), run_bearing=round(bearing) if dist[k] >= .2 else None,
        max_flame_m=round(float(f.max()), 2), max_ros_m_min=round(float(ros[shown].max()), 2),
        flame_class_pct=[round(float((classes == i).mean() * 100), 1) for i in range(4)],
        spread=bool(shown.sum() > 1))


def encode(layers, horizon, edge, step):
    a, fl = layers["time_of_arrival"], layers["flame_length"]
    limit = min(horizon, edge) if edge is not None else horizon
    shown = np.isfinite(a) & (a <= limit)
    if limit / step > 254:
        raise ValueError("horizon does not fit the uint8 arrival code")
    ys, xs = np.where(shown)
    r0, r1, c0, c1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub = shown[r0:r1, c0:c1]
    arr = np.full(sub.shape, 255, "uint8")
    arr[sub] = np.round(a[r0:r1, c0:c1][sub] / step).astype("uint8")
    fla = np.full(sub.shape, 255, "uint8")
    fla[sub] = np.minimum(254, np.round(fl[r0:r1, c0:c1][sub] * 10)).astype("uint8")
    b64 = lambda x: base64.b64encode(x.tobytes()).decode()
    return dict(w=[int(r0), int(c0), int(r1 - r0), int(c1 - c0)], a=b64(arr), f=b64(fla))


def check_reproduction(site, ecmwf):
    """The refactored pipeline must reproduce the verified 17 ha run cell for cell."""
    h = ecmwf["data"]["hourly"]
    i = h["time"].index("2024-09-02T12:00")
    layers, _ = run(site, IGNITIONS[0][2], np.array(h["wind_speed_10m"][i:i + 3]) * 3.6, h["wind_direction_10m"][i:i + 3], rs.MOISTURE, 180)
    with rasterio.open(ROOT / "Data/readiness/spread-scenario/mariovo-arrival-minutes.tif") as src:
        saved = src.read(1)
    saved = np.where(saved == -9999, np.nan, saved)
    a = layers["time_of_arrival"]
    if not (np.array_equal(np.isfinite(a), np.isfinite(saved)) and np.allclose(a[np.isfinite(a)], saved[np.isfinite(saved)], atol=1e-3)):
        raise RuntimeError("pipeline no longer reproduces the verified Mariovo run")
    return h, i


def climatology(h):
    hour = np.array([int(t[11:13]) for t in h["time"]])
    month = np.array([int(t[5:7]) for t in h["time"]])
    sel = (month >= 6) & (month <= 9) & (hour >= 10) & (hour <= 15)
    ws, wd, gust = h["wind_speed_10m"][sel], h["wind_direction_10m"][sel], h["wind_gusts_10m"][sel]
    e1 = 1.03 * emc_percent(h["temperature_2m"][sel], h["relative_humidity_2m"][sel])
    sector = ((wd + 22.5) % 360 // 45).astype(int)
    windy = ws >= 5
    pct = lambda x, p: round(float(np.percentile(x, p)), 1)
    return dict(
        hours=int(sel.sum()), window="June–September, 12:00–18:00 local summer time (10–15 UTC hours), 2016–2025",
        calm_pct=round(float((~windy).mean() * 100), 1),
        rose_pct=[round(float((sector[windy] == i).mean() * 100), 1) for i in range(8)],
        speed_at_least_pct=[round(float((ws >= s).mean() * 100), 1) for s in SPEEDS],
        gust_at_least_pct=[round(float((gust >= s).mean() * 100), 1) for s in SPEEDS],
        wind_kmh=dict(p50=pct(ws, 50), p90=pct(ws, 90), p99=pct(ws, 99), max=round(float(ws.max()), 1)),
        gust_kmh=dict(p50=pct(gust, 50), p90=pct(gust, 90), max=round(float(gust.max()), 1)),
        dead_1h_pct=dict(p10=pct(e1, 10), p50=pct(e1, 50), p90=pct(e1, 90)),
        dryness_at_or_below_pct=[round(float((e1 <= v[0] * 100).mean() * 100), 1) for *_, v in DRYNESS])


def afternoons(h):
    """Per date (June–September): afternoon means and the hourly 10–15 UTC rows."""
    idx = {}
    for i, t in enumerate(h["time"]):
        if 6 <= int(t[5:7]) <= 9 and 10 <= int(t[11:13]) <= 15:
            idx.setdefault(t[:10], []).append(i)
    days = []
    for date, ii in idx.items():
        if len(ii) != 6:
            continue
        first = ii[0]
        u = -np.mean(h["wind_speed_10m"][ii] * np.sin(np.radians(h["wind_direction_10m"][ii])))
        v = -np.mean(h["wind_speed_10m"][ii] * np.cos(np.radians(h["wind_direction_10m"][ii])))
        days.append(dict(date=date, i=ii, t=float(np.mean(h["temperature_2m"][ii])), tmax=float(np.max(h["temperature_2m"][ii])),
                         rh=float(np.mean(h["relative_humidity_2m"][ii])), rhmin=float(np.min(h["relative_humidity_2m"][ii])),
                         wind=float(np.mean(h["wind_speed_10m"][ii])), gust=float(np.max(h["wind_gusts_10m"][ii])),
                         rain=float(np.sum(h["precipitation"][max(0, first - 24):ii[-1] + 1])),
                         dir_from=float((math.degrees(math.atan2(-u, -v)) + 360) % 360)))
    return days


def pick_days(days):
    dry = [d for d in days if d["rain"] < .2]
    mid = [d for d in dry if d["date"][5:7] in ("07", "08")]
    med = {k: np.median([d[k] for d in mid]) for k in ("t", "rh", "wind")}
    sd = {k: np.std([d[k] for d in mid]) for k in med}
    chosen, picks = set(), []

    def take(sid, label, blurb, pool, key, story=None):
        for d in sorted(pool, key=key):
            if d["date"] not in chosen:
                chosen.add(d["date"])
                picks.append(dict(id=sid, label=label, blurb=blurb, story=story, day=d))
                return
    take("typical", "Typical summer afternoon", "The July–August afternoon closest to the median temperature, humidity and wind.", mid,
         lambda d: sum(((d[k] - med[k]) / sd[k]) ** 2 for k in med))
    take("hottest", "Hottest afternoon", "The hottest summer afternoon at this point in 2016–2025.", dry, lambda d: -d["tmax"])
    take("windiest", "Windiest dry afternoon", "The strongest mean afternoon wind with humidity below 30 % at some hour.",
         [d for d in dry if d["rhmin"] < 30], lambda d: -d["wind"])
    take("driest", "Driest air", "The summer afternoon with the lowest mean relative humidity.", dry, lambda d: d["rh"])
    take("novaci", "Novaci fire day", "9 August 2024, when the 11,224 ha Novaci fire was burning about 25 km to the south.",
         [d for d in days if d["date"] == "2024-08-09"], lambda d: 0, story="novaci-2024")
    take("humid", "Cool, humid afternoon", "The most humid rain-free summer afternoon (June–September) in 2016–2025.", dry, lambda d: -d["rh"])
    return picks


def day_run_inputs(h, idx):
    hist = emc_percent(h["temperature_2m"][max(0, idx[0] - 96):idx[0]], h["relative_humidity_2m"][max(0, idx[0] - 96):idx[0]])
    return h["wind_speed_10m"][idx], h["wind_direction_10m"][idx], weather_moisture(h["temperature_2m"][idx], h["relative_humidity_2m"][idx], hist)


def iso(t):
    return t if t.endswith("Z") else t + "Z"


# ---------- backtest ----------

def backtest(b, site, files):
    story = json.loads((ROOT / f"web/public/data/stories/fires/{b['story']}.json").read_text())
    det = sorted(story["detections"], key=lambda x: x["t"])
    first_t = det[0]["t"]
    first = [x for x in det if x["t"] == first_t]
    t0 = datetime.strptime(first_t, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
    # Ignite in the burnable cell nearest the mean position of the first overpass's detections.
    x, y = transform_coords("EPSG:4326", "EPSG:32634", [np.mean([p["lon"] for p in first])], [np.mean([p["lat"] for p in first])])
    col, row = ~site["profile"]["transform"] * (x[0], y[0])
    ys, xs = np.where(~site["excluded"])
    k = int(np.argmin((ys - row) ** 2 + (xs - col) ** 2))
    rc = (int(ys[k]), int(xs[k]))
    wx = story["weather"]["hourly"]
    times = [datetime.strptime(t, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc) for t in wx["time"]]
    start = times.index(t0.replace(minute=0))
    end_t = datetime.strptime(det[-1]["t"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
    minutes = int(math.ceil((end_t - t0).total_seconds() / 3600)) * 60
    bands = slice(start, start + minutes // 60 + 2)
    t, rh = np.array(wx["t"][bands]), np.array(wx["rh"][bands])
    # 100-h history: the story's weather starts two days before the mapped fire date, so up to 96 h are available.
    hist = slice(max(0, start - 96), max(1, start))
    moisture = weather_moisture(t, rh, emc_percent(wx["t"][hist], wx["rh"][hist]))
    layers, stats = run(site, rc, np.array(wx["wind_kmh"][bands]), np.array(wx["wind_dir"][bands]), moisture, minutes, start_minutes=t0.minute)
    summary = summarize(site, rc, layers, minutes)
    a = layers["time_of_arrival"]
    perim = transform_geom("EPSG:4326", "EPSG:32634", story["perimeter"]["geometry"])
    mapped = rasterize([(perim, 1)], out_shape=a.shape, transform=site["profile"]["transform"], fill=0, dtype="uint8").astype(bool)
    limit = minutes if summary["edge_minute"] is None else min(minutes, summary["edge_minute"])
    model = np.isfinite(a) & (a <= limit)
    both = int((model & mapped).sum())
    hits = []
    for p in det:
        px, py = transform_coords("EPSG:4326", "EPSG:32634", [p["lon"]], [p["lat"]])
        c, r = ~site["profile"]["transform"] * (px[0], py[0])
        r, c = int(r), int(c)
        dt = (datetime.strptime(p["t"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc) - t0).total_seconds() / 60
        reached = bool(0 <= r < a.shape[0] and 0 <= c < a.shape[1] and np.isfinite(a[r, c]) and a[r, c] <= dt + 1e-6)
        hits.append(dict(t=p["t"], lon=p["lon"], lat=p["lat"], sensor=p["sensor"], reached=reached, after_min=round(dt)))
    weather = dict(time=[iso(x) for x in wx["time"][bands]], wind_kmh=wx["wind_kmh"][bands], wind_from=wx["wind_dir"][bands],
                   t=wx["t"][bands], rh=wx["rh"][bands],
                   dead_1h_pct=[round(float(v) * 100, 1) for v in moisture["fuel_moisture_dead_1hr"]])
    fuel_share = {str(m): round(float((site["fuel_north_up"][mapped] == m).mean() * 100), 1) for m in np.unique(site["fuel_north_up"][mapped]).tolist()}
    file = f"backtest-{b['id']}.json"
    files[file] = dict(schema=RUNS_SCHEMA, step_minutes=b["step"], runs={"backtest": encode(layers, minutes, summary["edge_minute"], b["step"])})
    return dict(
        id=b["id"], name=b["name"], story=b["story"], effis_id=story["official"]["effis_id"], mapped_ha=story["official"]["area_ha"],
        mapped_grid_ha=int(mapped.sum()), perimeter=story["perimeter"]["geometry"], file=file, step_minutes=b["step"],
        ignition=dict(time_utc=t0.isoformat().replace("+00:00", "Z"), row=rc[0], col=rc[1], fuel_model=int(site["fuel_north_up"][rc]),
                      lon=round(float(np.mean([p["lon"] for p in first])), 5), lat=round(float(np.mean([p["lat"] for p in first])), 5),
                      detections=len(first)),
        horizon_minutes=minutes, summary=summary, weather=weather,
        metrics=dict(model_ha=int(model.sum()), overlap_ha=both,
                     # minutes until the model's fire is as large as the whole mapped burn (one cell = 1 ha)
                     model_matches_mapped_min=round(float(np.sort(a[model])[mapped.sum() - 1])) if model.sum() >= mapped.sum() else None, mapped_reached_pct=round(both / mapped.sum() * 100, 1),
                     model_outside_pct=round((model.sum() - both) / max(1, model.sum()) * 100, 1),
                     detections=len(hits), detections_reached_pct=round(sum(h["reached"] for h in hits) / len(hits) * 100, 1)),
        detections=hits, mapped_fuel_pct=fuel_share,
        site=site_meta(site), inputs=site["inputs"], crosswalk=site["crosswalk"], engine_stats=stats)


def site_meta(site):
    burnable = site["fuel_north_up"][site["fuel_north_up"] > 0]
    return dict(id=site["id"], name=site["name"], rows=site["rows"], cols=site["cols"], cell_m=100, crs="EPSG:32634",
                corners=site["corners"], fuel_b64=base64.b64encode(site["fuel_north_up"].tobytes()).decode(),
                fuel_share_pct={str(m): round(float((burnable == m).mean() * 100), 1) for m in np.unique(burnable).tolist()},
                excluded_pct=round(float((site["fuel_north_up"] == 0).mean() * 100), 1))


# ---------- main ----------

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="download missing cached inputs")
    args = parser.parse_args()
    site = mariovo_site()
    ecmwf = json.loads(ECMWF_FILE.read_text())
    eh, ei = check_reproduction(site, ecmwf)
    meta, h = era5(args.fetch)
    files = {}

    ignitions = []
    for iid, label, rc in IGNITIONS:
        engine_rc(site, rc)
        x, y = rasterio.transform.xy(site["profile"]["transform"], *rc)
        lon, lat = transform_coords("EPSG:32634", "EPSG:4326", [x], [y])
        ignitions.append(dict(id=iid, label=label, row=rc[0], col=rc[1], lon=round(lon[0], 5), lat=round(lat[0], 5),
                              fuel_model=int(site["fuel_north_up"][rc]), elevation_m=round(float(site["elevation"][rc])),
                              slope_pct=round(float(np.flipud(site["slope"])[rc]) * 100)))

    matrix = {}
    for iid, _, rc in IGNITIONS:
        for did, _, _, values in DRYNESS:
            file, runs, summ = f"runs-{iid}-{did}.json", {}, {}
            for speed in SPEEDS:
                for di, dname in enumerate(DIRECTIONS if speed else ["calm"]):
                    layers, _ = run(site, rc, [float(speed)], [45. * di], preset_moisture(values), HORIZON)
                    s = summarize(site, rc, layers, HORIZON)
                    key = f"{speed}-{dname}"
                    runs[key] = encode(layers, HORIZON, s["edge_minute"], STEP)
                    summ[key] = s
            files[file] = dict(schema=RUNS_SCHEMA, step_minutes=STEP, runs=runs)
            matrix.setdefault(iid, {})[did] = dict(file=file, runs=summ)

    situations = []
    original_moisture = {k: round(v, 3) for k, v in rs.MOISTURE.items()}
    orig = dict(id="original", label="2 Sep 2024 (original verified run)", blurb="The first Spread Lab run: an archived ECMWF forecast for the Mariovo fire week with fixed dry fuel moisture. The valley-brush start reproduces the verified 17 ha.",
                date="2024-09-02", source="Open-Meteo Historical Forecast API, ECMWF IFS HRES", horizon_minutes=180,
                weather=dict(time=[iso(t) for t in eh["time"][ei:ei + 3]], wind_kmh=[round(v * 3.6, 1) for v in eh["wind_speed_10m"][ei:ei + 3]],
                             wind_from=eh["wind_direction_10m"][ei:ei + 3], t=eh["temperature_2m"][ei:ei + 3], rh=eh["relative_humidity_2m"][ei:ei + 3],
                             dead_1h_pct=[original_moisture["fuel_moisture_dead_1hr"] * 100] * 3), moisture="fixed", runs={})
    days = [orig] + [dict(id=p["id"], label=p["label"], blurb=p["blurb"], story=p["story"], date=p["day"]["date"],
                          source="ERA5 reanalysis via Open-Meteo archive API", horizon_minutes=HORIZON, moisture="weather", runs={},
                          stats={k: round(p["day"][k], 1) for k in ("t", "tmax", "rh", "rhmin", "wind", "gust", "dir_from")}, idx=p["day"]["i"])
                     for p in pick_days(afternoons(h))]
    for sday in days:
        if sday["id"] == "original":
            wind, frm, moist, minutes = np.array(sday["weather"]["wind_kmh"]), sday["weather"]["wind_from"], rs.MOISTURE, 180
            wind = np.array(eh["wind_speed_10m"][ei:ei + 3]) * 3.6  # exact verified forcing, unrounded
        else:
            idx = sday.pop("idx")
            wind, frm, moist = day_run_inputs(h, idx)
            minutes = HORIZON
            sday["weather"] = dict(time=[iso(h["time"][i]) for i in idx], wind_kmh=h["wind_speed_10m"][idx].tolist(),
                                   wind_from=h["wind_direction_10m"][idx].tolist(), t=h["temperature_2m"][idx].tolist(),
                                   rh=h["relative_humidity_2m"][idx].tolist(), gust_kmh=h["wind_gusts_10m"][idx].tolist(),
                                   dead_1h_pct=[round(float(v) * 100, 1) for v in moist["fuel_moisture_dead_1hr"]],
                                   dead_10h_pct=[round(float(v) * 100, 1) for v in moist["fuel_moisture_dead_10hr"]],
                                   dead_100h_pct=round(float(moist["fuel_moisture_dead_100hr"][0]) * 100, 1))
        file, runs = f"day-{sday['id']}.json", {}
        for iid, _, rc in IGNITIONS:
            layers, _ = run(site, rc, wind, frm, moist, minutes)
            s = summarize(site, rc, layers, minutes)
            runs[iid] = encode(layers, minutes, s["edge_minute"], STEP)
            sday["runs"][iid] = s
        if sday["id"] == "original" and sday["runs"]["centre"]["final_ha"] != 17:
            raise RuntimeError("original situation no longer gives 17 ha")
        sday["file"] = file
        files[file] = dict(schema=RUNS_SCHEMA, step_minutes=STEP, runs=runs)
        situations.append(sday)

    bts = [backtest(b, backtest_site(b, args.fetch), files) for b in BACKTESTS]

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    for name, body in files.items():
        write_json(OUT / name, body)
    index = dict(
        schema="firewatch.spread.lab.v1", data_class="experimental_spread_scenarios", calibrated=False,
        created_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        engine=dict(name="Pyretechnics", version=importlib.metadata.version("pyretechnics"),
                    propagation="Eulerian level set with Rothermel surface fire behaviour"),
        site=site_meta(site), horizon_minutes=HORIZON, checkpoints=CHECKPOINTS, flame_breaks_m=FLAME_BREAKS_M,
        fuel_models={str(k): dict(name=v[0], short=v[1], color=v[2]) for k, v in FUEL_MODELS.items()},
        ignitions=ignitions, speeds=SPEEDS, directions=DIRECTIONS,
        dryness=[dict(id=i, label=l, scenario=s, moisture=dict(zip(MOISTURE_KEYS, v))) for i, l, s, v in DRYNESS],
        climate=dict(source="ERA5 reanalysis via Open-Meteo archive API", cell=[meta["latitude"], meta["longitude"]],
                     cell_elevation_m=meta["elevation"], **climatology(h)),
        matrix=matrix, situations=situations, backtests=bts,
        assumptions=dict(
            surface="Surface fire only: canopy inputs zero, no crown fire, spotting or suppression.",
            fuels="EFFIS European fuel map (ver. 2017) crosswalked to Anderson/NFFL models; generalized and coarse (about 290 m), not field-measured.",
            exclusions="Unclassified fuel, WorldCover built-up/bare/water and missing terrain act as barriers; they are not all measured nonburnable.",
            wind="One wind value over the whole area, at 10 m, held for each hour; no gusts, terrain channelling or valley winds.",
            dryness="What-if dryness uses the Scott & Burgan (2005) moisture scenarios. Real days derive dead fuel moisture from hourly temperature and humidity (Simard 1968 equilibrium moisture, NFDRS rules); live moisture is assumed (L2).",
            edge="Runs stop being shown when the modeled fire reaches the edge of the mapped area."),
        inputs=[dict(path=str(p.relative_to(ROOT)), sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in
                [FUELS / "mariovo" / f for f in ("fuel-model.tif", "worldcover.tif", "elevation.tif")] + [ERA5_FILE, ECMWF_FILE]],
        checks=json.loads((ROOT / "Data/readiness/spread-scenario/controlled-checks.json").read_text()),
        credits=["PYRETECHNICS developed by Spatial Informatics Group, LLC and contributors (community licence).",
                 "EFFIS / Copernicus Emergency Management Service: European fuel map and burned areas, CC BY 4.0.",
                 "NASA JPL NASADEM; ESA WorldCover 2021, CC BY 4.0.",
                 "ERA5: Copernicus Climate Change Service (C3S) / ECMWF, via Open-Meteo (CC BY 4.0); ECMWF IFS archived forecast via Open-Meteo.",
                 "Satellite detections: NASA FIRMS (MODIS, VIIRS)."])
    write_json(OUT / "index.json", index)
    sizes = {p.name: p.stat().st_size for p in OUT.glob("*.json")}
    print(json.dumps(dict(files=len(sizes), total_kb=round(sum(sizes.values()) / 1024), largest_kb=round(max(sizes.values()) / 1024),
                          backtests={b["id"]: dict(b["metrics"], mapped_ha=b["mapped_ha"], edge_minute=b["summary"]["edge_minute"], horizon=b["horizon_minutes"]) for b in bts}, situations={s["id"]: [s["date"], s["runs"]["centre"]["final_ha"]] for s in situations}), indent=1))


if __name__ == "__main__":
    main()
