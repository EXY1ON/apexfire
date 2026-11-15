"""Export compact, attributed North Macedonia data for the ApexFire website.

Reads only selected local inputs (the 35 MK detection CSVs named by the audit inventory and
named readiness/case files) and writes sanitized JSON/GeoJSON/images to web/public/data.
History parsing uses the standard library; geometry/raster steps need the project .venv
(rasterio, shapely, Pillow).

    .venv/bin/python tools/export_web_data.py            # write web/public/data
    .venv/bin/python tools/export_web_data.py --self-test
"""

import argparse
import csv
import hashlib
import io
import json
import math
import re
import shutil
import zipfile
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data"
INVENTORY = ROOT / "docs" / "data-audit" / "file-inventory.csv"
COUNTRY = "Macedonia_Former_Yugoslav_Republic_of"
TRANSFORM_VERSION = "firewatch-export-1"
READY = ROOT / "Data" / "readiness"
CASE = ROOT / "Data" / "case-studies" / "mariovo-2024"
ADDED = READY / "additional-sources"

# Sensor identity for the three local archive families; record starts come from FIRMS archive
# documentation cited in docs/data-research.md, not from the local files.
SENSORS = {
    "modis": {"label": "MODIS (Terra/Aqua)", "instrument": "MODIS", "confidence_scale": "modis_0_100",
              "record_start": "2000-11-01", "id_prefix": "MOD"},
    "viirs-jpss1": {"label": "VIIRS NOAA-20", "instrument": "VIIRS", "confidence_scale": "viirs_lnh",
                    "record_start": "2018-04-01", "id_prefix": "N20"},
    "viirs-snpp": {"label": "VIIRS S-NPP", "instrument": "VIIRS", "confidence_scale": "viirs_lnh",
                   "record_start": "2012-01-20", "id_prefix": "NPP"},
    "viirs-noaa21": {"label": "VIIRS NOAA-21", "instrument": "VIIRS", "confidence_scale": "viirs_lnh",
                     "record_start": "2023-03-01", "id_prefix": "N21"},
}
API = ROOT / "Data" / "firms-api"
PLACES = []  # filled by export_places, reused for fire summaries
NO_TYPE = 9  # near-real-time files carry no algorithm type; kept distinct instead of guessing a label
COLUMNS = ["id", "t", "lat", "lon", "conf", "frp", "scan", "track", "bt", "bt2", "dn", "type", "sat", "ver"]
FIRMS_CREDIT = ("NASA FIRMS (Fire Information for Resource Management System), MODIS Collection 6/6.1 "
                "and VIIRS 375 m active fire detections; NASA data are openly shared without restriction. "
                "Cite LANCE/FIRMS as requested by NASA.")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def utc_time(acq_date, acq_time):
    """FIRMS HHMM may drop leading zeros ("32" = 00:32). Reject impossible clock values."""
    if not re.fullmatch(r"\d{1,4}", acq_time):
        raise ValueError(f"Invalid acq_time {acq_time!r}")
    hhmm = acq_time.zfill(4)
    hour, minute = int(hhmm[:2]), int(hhmm[2:])
    if hour > 23 or minute > 59:
        raise ValueError(f"Invalid acq_time {acq_time!r}")
    day = date.fromisoformat(acq_date)
    return f"{day.isoformat()}T{hour:02d}:{minute:02d}Z"


def parse_row(row, family, year):
    lat, lon, frp = float(row["latitude"]), float(row["longitude"]), float(row["frp"])
    if not all(math.isfinite(v) for v in (lat, lon, frp)) or not (-90 <= lat <= 90 and -180 <= lon <= 180) or frp < 0:
        raise ValueError("Invalid coordinates or FRP")
    t = utc_time(row["acq_date"], row["acq_time"])
    if int(t[:4]) != year:
        raise ValueError(f"Row year {t[:4]} outside file year {year}")
    conf = row["confidence"]
    if SENSORS[family]["confidence_scale"] == "modis_0_100":
        conf = int(conf)
        if not 0 <= conf <= 100:
            raise ValueError("MODIS confidence outside 0-100")
    elif conf not in ("l", "n", "h"):
        raise ValueError(f"VIIRS confidence {conf!r} not l/n/h")
    kind = row.get("type")
    if row["daynight"] not in ("D", "N") or kind not in ("0", "1", "2", "3", None, ""):
        raise ValueError("Invalid daynight/type")
    bt = row.get("brightness") or row.get("bright_ti4")
    bt2 = row.get("bright_t31") or row.get("bright_ti5")
    return [t, lat, lon, conf, frp, float(row["scan"]), float(row["track"]), float(bt), float(bt2),
            row["daynight"], int(kind) if kind else NO_TYPE, row["satellite"], row["version"]]


def select_mk_files():
    with open(INVENTORY, newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["country"] == COUNTRY]
    if len(rows) != 35:
        raise ValueError(f"Expected 35 MK inventory rows, found {len(rows)}")
    return sorted(rows, key=lambda r: (r["family"], int(r["year"])))


def export_history():
    files = []
    total = 0
    for inv in select_mk_files():
        family, year = inv["family"], int(inv["year"])
        path = ROOT / inv["path"]
        digest = sha256(path)
        if digest != inv["sha256"]:
            raise ValueError(f"{inv['path']} hash differs from audit inventory")
        with open(path, newline="", encoding="utf-8") as f:
            source_rows = list(csv.DictReader(f))
        if len(source_rows) != int(inv["records"]):
            raise ValueError(f"{inv['path']} record count differs from inventory")
        prefix = SENSORS[family]["id_prefix"]
        rows = [[f"{prefix}-{year}-{i:05d}", *parse_row(r, family, year)] for i, r in enumerate(source_rows, 1)]
        files.append(write_partition(family, year, rows, Path(inv["path"]).name, digest, "archive"))
        total += len(rows)
    if total != 47046:
        raise ValueError(f"Expected 47,046 MK detections, exported {total}")
    archive_total = total
    total += export_api_history(files)
    coverage = {}
    for family in SENSORS:
        years = sorted(f["year"] for f in files if f["sensor"] == family)
        coverage[family] = {"years": years,
                            "missing_internal_years": [y for y in range(years[0], years[-1] + 1) if y not in years] if years else []}
    return {"files": files, "coverage": coverage, "records": total, "archive_records": archive_total}


def write_partition(family, year, rows, source_file, digest, origin, products=None):
    name = f"{family}-{year}.json"
    write_json(OUT / "history" / name, {
        "schema": "firewatch.history.v1", "data_class": "satellite_detection",
        "sensor": family, "year": year, "source_file": source_file, "source_sha256": digest,
        "confidence_scale": SENSORS[family]["confidence_scale"], "records": len(rows),
        "columns": COLUMNS, "rows": rows,
    })
    idx = {c: i for i, c in enumerate(COLUMNS)}
    return {
        "sensor": family, "year": year, "data": f"history/{name}", "origin": origin, "products": products or [],
        "source_file": source_file, "source_sha256": digest, "records": len(rows),
        "date_min": min(r[idx["t"]][:10] for r in rows) if rows else None,
        "date_max": max(r[idx["t"]][:10] for r in rows) if rows else None,
        "monthly": dict(sorted(Counter(r[idx["t"]][:7] for r in rows).items())),
        "types": dict(sorted(Counter(str(r[idx["type"]]) for r in rows).items())),
        "versions": dict(Counter(r[idx["ver"]] for r in rows)),
        "satellites": dict(Counter(r[idx["sat"]] for r in rows)),
    }


def mk_polygon():
    from shapely.geometry import shape
    from shapely.prepared import prep
    src = json.loads((ADDED / "geoboundaries-mkd-adm0.geojson").read_text())
    return prep(shape(src["features"][0]["geometry"]))


def api_rows(path, family):
    """Parse one FIRMS API product file (bounding box, all rows) without clipping. Files are named by the
    year their 5-day requests started, so a late-December chunk can hold early-January rows: use each row's own year.
    Exact duplicate rows (a chunk re-appended after an interrupted run) are dropped."""
    with open(path, newline="", encoding="utf-8") as f:
        rows = [parse_row(r, family, int(r["acq_date"][:4])) for r in csv.DictReader(f)]
    seen, out = set(), []
    for r in rows:
        k = tuple(r)
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def export_api_history(files):
    """Gap years fetched by tools/fetch_firms_archive.py, clipped to the 2016 MK polygon (archive years use FIRMS' own country cut)."""
    from shapely.geometry import Point
    if not API.exists():
        return 0
    poly = mk_polygon()
    have = {(f["sensor"], f["year"]) for f in files}
    groups = {}  # (family, row year) -> {"rows": [...], "paths": set()}
    for path in sorted(API.glob("*/*.csv")):
        family = path.parent.name
        for r in api_rows(path, family):
            if poly.covers(Point(r[2], r[1])):
                g = groups.setdefault((family, int(r[0][:4])), {"rows": [], "paths": set()})
                g["rows"].append(r)
                g["paths"].add(path)
    total = 0
    for (family, year), g in sorted(groups.items()):
        if (family, year) in have:
            raise ValueError(f"API data overlaps archive file for {family} {year}")
        paths = sorted(g["paths"])
        rows = [[f"{SENSORS[family]['id_prefix']}-{year}-A{i:05d}", *r] for i, r in enumerate(sorted(g["rows"], key=lambda r: (r[0], r[1], r[2])), 1)]
        digest = hashlib.sha256(b"".join(p.read_bytes() for p in paths)).hexdigest()
        label = " + ".join(p.name for p in paths) + " (FIRMS API, clipped to MK)"
        files.append(write_partition(family, year, rows, label, digest, "firms_api", sorted({p.stem.rsplit("_", 1)[0] for p in paths})))
        total += len(rows)
    return total


def export_recent(places, days=7):
    """Latest near-real-time window (bounding box incl. neighbours) and its detection groups for the tracker."""
    from shapely.geometry import Point
    import firelib
    poly = mk_polygon()
    progress = json.loads((API / "progress.json").read_text()) if (API / "progress.json").exists() else {}
    nrt = [k for k in progress if "_NRT/" in k]
    if not nrt:
        return 0
    retrieved = max(progress[k]["retrieved_utc"] for k in nrt)
    end = datetime.fromisoformat(retrieved)
    start = (end - timedelta(days=days)).strftime("%Y-%m-%dT%H:%MZ")
    dets = []
    for path in sorted(API.glob("*/*_NRT_*.csv")):
        family, product = path.parent.name, path.stem.rsplit("_", 1)[0]
        for i, r in enumerate(api_rows(path, family), 1):
            if r[0] >= start:
                dets.append({"id": f"{product}-{r[0]}-{i}", "sensor": family, "product": product, "t": r[0], "lat": r[1], "lon": r[2],
                             "conf": r[3], "frp": r[4], "dn": r[9], "ver": r[12], "inside": poly.covers(Point(r[2], r[1]))})
    dets.sort(key=lambda d: d["t"])
    groups = firelib.cluster(dets)
    fires = [firelib.summarize(dets, g, places) for g in groups]
    for f in fires:
        for m in f["members"]:
            next(d for d in dets if d["id"] == m)["fire"] = f["id"]
    write_json(OUT / "current" / "recent.json", {
        "schema": "firewatch.current.recent.v1", "data_class": "satellite_detection", "delivery": "saved_sample",
        "retrieved_utc": retrieved, "window_start": start, "window_end": end.strftime("%Y-%m-%dT%H:%MZ"),
        "latest_acquisition": dets[-1]["t"] if dets else None, "bbox_wgs84": [20.4, 40.8, 23.1, 42.5],
        "products": sorted({d["product"] for d in dets}),
        "grouping": f"Detections within {firelib.LINK_KM} km and {firelib.LINK_HOURS:.0f} h of each other form one group (single linkage).",
        "credit": FIRMS_CREDIT, "detections": dets, "fires": fires,
    })
    return len(fires)


def export_places():
    with zipfile.ZipFile(ADDED / "geonames-mk.zip") as z:
        info = z.getinfo("MK.txt")
        if info.file_size > 10_000_000:
            raise ValueError("MK.txt larger than expected bound")
        text = z.read("MK.txt").decode("utf-8")
    records = [line.split("\t") for line in text.splitlines() if line]
    if len(records) != 25482 or any(len(r) != 19 for r in records):
        raise ValueError("GeoNames MK.txt record/column count changed")
    cyrillic = re.compile(r"[Ѐ-ӿ]")
    rows = []
    for r in records:
        if r[6] != "P":
            continue
        alts = [a for a in r[3].split(",") if a and cyrillic.search(a)][:3]
        rows.append([int(r[0]), r[1], r[2], alts, round(float(r[4]), 5), round(float(r[5]), 5), r[7], int(r[14] or 0)])
    if len(rows) != 2773:
        raise ValueError(f"Expected 2,773 populated places, found {len(rows)}")
    PLACES[:] = [{"name": r[1], "cyr": r[3][0] if r[3] else None, "lat": r[4], "lon": r[5], "pop": r[7]} for r in rows]
    write_json(OUT / "places.json", {
        "schema": "firewatch.places.v1", "data_class": "gazetteer_place",
        "source": "GeoNames MK.zip country dump, feature class P (populated places)",
        "source_url": "https://download.geonames.org/export/dump/MK.zip", "source_sha256": sha256(ADDED / "geonames-mk.zip"),
        "license": "CC BY 4.0, GeoNames (www.geonames.org)",
        "notes": "Populations are GeoNames attributes, not live counts. A nearby place is not an incident name.",
        "columns": ["geonameid", "name", "asciiname", "cyrillic_alternates", "lat", "lon", "feature_code", "population"],
        "rows": rows,
    })
    return len(rows)


def round_coords(value, nd=5):
    if isinstance(value, (int, float)):
        return round(value, nd)
    return [round_coords(v, nd) for v in value]


def feature(geometry, properties):
    return {"type": "Feature", "properties": properties,
            "geometry": {"type": geometry["type"], "coordinates": round_coords(geometry["coordinates"])}}


def export_boundary():
    meta = json.loads((ADDED / "geoboundaries-mkd-adm0-metadata.json").read_text())
    src = json.loads((ADDED / "geoboundaries-mkd-adm0.geojson").read_text())
    if len(src["features"]) != 1:
        raise ValueError("Expected one ADM0 feature")
    write_json(OUT / "boundary-mk.geojson", {
        "type": "FeatureCollection", "data_class": "reference_boundary",
        "source": f"geoBoundaries {meta['boundaryID']} ({meta['boundarySource']})",
        "represented_year": meta["boundaryYearRepresented"], "license": meta["boundaryLicense"],
        "notes": "Dated 2016 reference geometry for context and masking; not legal border authority.",
        "features": [feature(src["features"][0]["geometry"], {"name": "North Macedonia", "represented_year": meta["boundaryYearRepresented"]})],
    })


def export_brvenica():
    p = READY / "progression-2017"
    manifest = json.loads((p / "manifest.json").read_text())
    frames = json.loads((p / "observed-perimeters.geojson").read_text())["features"]
    prefire = json.loads((p / "prefire-reference.geojson").read_text())["features"]
    missing = json.loads((p / "missing-observations.json").read_text())
    official = json.loads((p / "effis-official-event-query.json").read_text())["features"]
    if len(frames) != 8 or len(missing) != 15 or len(prefire) != 1 or len(official) != 1:
        raise ValueError("Brvenica counts changed: expected 8 frames, 15 missing, 1 prefire, 1 official")
    keep = ["Prop_step", "Acqu_date", "Acqu_time", "acquisition_utc", "BA (ha)", "Quality", "Clouds", "Smoke",
            "geometry_area_ha_equal_area", "timezone_basis"]
    land = ["Crop", "Crop/Veg", "Tree-Broad", "Tree-Needl", "Tree-Mixed", "Veg-Mixed", "Shrub", "Sparse Veg", "Urban", "Bare", "Grassland"]
    weather = list(csv.DictReader(open(READY / "weather" / "event-12376-era5-2017-07-23_2017-08-15.csv")))
    if len(weather) != 576:
        raise ValueError("Expected 576 ERA5 hours")
    daily = {}
    for w in weather:
        d = daily.setdefault(w["time_utc"][:10], {"t": [], "rh": [], "ws": [], "wg": [], "p": 0.0})
        d["t"].append(float(w["temperature_2m"])); d["rh"].append(float(w["relative_humidity_2m"]))
        d["ws"].append(float(w["wind_speed_10m"])); d["wg"].append(float(w["wind_gusts_10m"]))
        d["p"] += float(w["precipitation"])
    wmeta = json.loads((READY / "weather" / "event-12376-era5-2017-07-23_2017-08-15.metadata.json").read_text())
    write_json(OUT / "stories" / "brvenica-2017.json", {
        "schema": "firewatch.story.brvenica.v1", "event_id": manifest["event_id"],
        "data_class": "observed_burned_area",
        "source": "FireSpread_MedEU v2 (Zenodo record 18200075), Planet-derived burned-area progression",
        "source_url": manifest["source"], "source_zip_sha256": manifest["source_zip_sha256"],
        "license": "CC BY 4.0 (FireSpread_MedEU); EFFIS data CC BY 4.0",
        "timezone_assumption": manifest["timezone_assumption"], "limitations": manifest["limitations"],
        "frames": [feature(f["geometry"], {**{k: f["properties"][k] for k in keep},
                                            "land_cover_pct": {k: f["properties"][k] for k in land}}) for f in frames],
        "prefire": feature(prefire[0]["geometry"], {k: prefire[0]["properties"][k] for k in ("Acqu_date", "acquisition_utc", "Info", "Quality")}),
        "missing": [{"date": m["Acqu_date"], "info": m["Info"]} for m in missing],
        "intervals": json.loads((p / "observed-growth-intervals.json").read_text()),
        "official": {
            "data_class": "incident_reference", "source": "EFFIS burned-area WFS layer ms:modis.ba.poly.2017",
            "query": manifest["official_event_query"], "query_sha256": manifest["official_event_query_sha256"],
            "identity": {k: manifest["official_event_identity"][k] for k in ("id", "FIREDATE", "FINALDATE", "LASTUPDATE", "COUNTRY", "PROVINCE", "COMMUNE", "AREA_HA")},
            "final_observation_vs_official_iou": manifest["final_observation_vs_official_iou"],
            "final_observation_minus_official_reported_area_ha": manifest["final_observation_minus_official_reported_area_ha"],
            "feature": feature(official[0]["geometry"], {"AREA_HA": official[0]["properties"]["AREA_HA"]}),
        },
        "weather": {
            "product": wmeta["product"], "provider": "Open-Meteo Historical Weather API (ERA5)",
            "requested_lat_lon": wmeta["requested_coordinate_lat_lon"], "returned_lat_lon": wmeta["returned_coordinate_lat_lon"],
            "returned_elevation_m": wmeta["returned_elevation_m"], "hours": len(weather),
            "note": "Retrospective reanalysis at one grid point; not an as-issued forecast or station record.",
            "daily_utc": [{"date": k, "t_max_c": max(v["t"]), "rh_min_pct": min(v["rh"]), "wind_max_ms": max(v["ws"]),
                           "gust_max_ms": max(v["wg"]), "precip_mm": round(v["p"], 1)} for k, v in sorted(daily.items())],
        },
    })


def raster_cells_geojson(path, keep, props, max_cells):
    """Polygonize raster cells (one square per kept cell) into WGS84 GeoJSON features."""
    import numpy as np
    import rasterio
    from rasterio.warp import transform_geom
    with rasterio.open(path) as src:
        band = src.read(1)
        mask = keep(band, src)
        if int(mask.sum()) > max_cells:
            raise ValueError(f"{path.name}: {int(mask.sum())} cells exceeds bound {max_cells}")
        feats = []
        for r, c in zip(*np.nonzero(mask)):
            x0, y0 = src.transform * (c, r)
            x1, y1 = src.transform * (c + 1, r + 1)
            ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
            geom = transform_geom(src.crs, "EPSG:4326", {"type": "Polygon", "coordinates": [ring]})
            feats.append(feature(geom, props(band[r, c])))
    return feats


def export_mariovo():
    import numpy as np
    import rasterio
    from shapely.geometry import Point, shape
    metrics = json.loads((ROOT / "docs" / "case-studies" / "mariovo-2024" / "metrics.json").read_text())
    ref = json.loads((CASE / "reference" / "effis-mariovo-2024-09.geojson").read_text())
    with rasterio.open(CASE / "burned-area" / "2024-09-qa.tif") as q:
        qa, qa_nodata = q.read(1), q.nodata

    def keep(band, src):
        valid = ((qa & 2) != 0) & ((qa != qa_nodata) if qa_nodata is not None else True)
        return valid & (band >= 245) & (band <= 251)

    cells = raster_cells_geojson(CASE / "burned-area" / "2024-09-burn_date.tif", keep,
                                 lambda v: {"burn_doy": int(v), "burn_date": (date(2024, 1, 1).toordinal() + int(v) - 1)}, 2000)
    for c in cells:
        c["properties"]["burn_date"] = date.fromordinal(c["properties"]["burn_date"]).isoformat()
    # Recompute the case's inside-reference detection counts from the exported partitions; they must match metrics.
    polygon = shape(ref["geometry"])
    counts = Counter()
    for family in SENSORS:
        part = OUT / "history" / f"{family}-2024.json"
        if not part.exists():
            continue
        data = json.loads(part.read_text())
        for row in data["rows"]:
            if "2024-09-01" <= row[1][:10] <= "2024-09-07" and polygon.covers(Point(row[3], row[2])):
                counts[family] += 1
    expected = {k: v["detections"] for k, v in metrics["firms_active_fire_detections_inside_reference_sep1_7"].items()}
    if {k: counts[k] for k in expected} != expected:  # sensors added later (NOAA-21) are reported, not compared
        raise ValueError(f"Inside-reference counts {dict(counts)} differ from case metrics {expected}")
    image = ROOT / "docs" / "case-studies" / "mariovo-2024" / "evidence-overview.png"
    from PIL import Image
    (OUT / "stories").mkdir(parents=True, exist_ok=True)
    with Image.open(image) as im:
        im = im.convert("RGB")
        im.thumbnail((1800, 1800))
        im.save(OUT / "stories" / "mariovo-evidence-overview.jpg", quality=82, optimize=True)
    write_json(OUT / "stories" / "mariovo-2024.json", {
        "schema": "firewatch.story.mariovo.v1",
        "reference": {
            "data_class": "incident_reference", "status": "unconfirmed_secondary_geometry",
            "source": "WorldFires public API geometry attributed to EFFIS / Copernicus EMS",
            "source_url": "https://worldfires.org/api/v1/fires/mariovo-2024-09/geometry",
            "attribution_claimed": ref["properties"].get("source"), "reported_area_ha": metrics["reference"]["reported_area_ha"],
            "projected_polygon_area_ha": metrics["reference"]["projected_polygon_area_ha"],
            "provenance_gap": "An original EFFIS 2024 regional WFS query (387 features, 206 marked MK) returned no geometry intersecting this reference. Absence there does not establish no fire; it leaves this extent unconfirmed.",
            "feature": feature(ref["geometry"], {"status": "unconfirmed_secondary_geometry"}),
        },
        "mcd64a1": {
            "data_class": "observed_burned_area", "product": "MODIS MCD64A1 Collection 6.1, September 2024 Burn_Date",
            "granule": "MCD64A1.A2024245.h19v04.061.2024317180718", "cell_m": 463, "window_doy": [245, 251],
            "note": "Valid-QA cells (QA bit 1) with burn day 1-7 Sep 2024 in the case crop, drawn as native ~463 m cells; coarse product, not an incident edge.",
            "cells": {"type": "FeatureCollection", "features": cells},
        },
        "inside_reference_detection_check": dict(counts),
        "metrics": metrics,
        "evidence_image": {"path": "stories/mariovo-evidence-overview.jpg",
                           "alt": "Mariovo evidence overview: HLS pre/post scenes, dNBR, MODIS burn dates, terrain and land cover around the reference perimeter."},
        "crop_bbox_wgs84": json.loads((CASE / "manifest.json").read_text())["bbox_wgs84_crop"],
        "gibs": {
            "data_class": "imagery_context", "layer": "MODIS_Terra_CorrectedReflectance_TrueColor", "date": "2024-09-02",
            "tile_matrix_set": "GoogleMapsCompatible_Level9", "max_zoom": 9,
            "template": "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2024-09-02/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
            "credit": "NASA EOSDIS GIBS / Worldview; MODIS Terra Corrected Reflectance",
            "note": "Daily browse composite; not numeric reflectance, severity or a perimeter. Clouds and smoke may obscure the surface.",
        },
    })
    return len(cells), dict(counts)


def export_spread():
    import numpy as np
    s = READY / "spread-scenario"
    manifest = json.loads((s / "manifest.json").read_text())
    perims = json.loads((s / "mariovo-perimeters.geojson").read_text())
    areas = [f["properties"]["burned_area_ha"] for f in perims["features"]]
    if areas != [2.0, 4.0, 11.0, 17.0] or any(f["properties"]["calibrated"] for f in perims["features"]):
        raise ValueError("Scenario steps changed from the verified 2/4/11/17 ha uncalibrated run")
    cells = raster_cells_geojson(s / "mariovo-arrival-minutes.tif",
                                 lambda band, src: np.isfinite(band) & (band >= 0) & ((band != src.nodata) if src.nodata is not None else True),
                                 lambda v: {"arrival_minutes": round(float(v), 1)}, 1000)
    if len(cells) != manifest["results"]["burned_cells"]:
        raise ValueError(f"Arrival raster has {len(cells)} burned cells; manifest says {manifest['results']['burned_cells']}")
    write_json(OUT / "spread" / "mariovo-scenario.json", {
        "schema": "firewatch.spread.v1", "data_class": "experimental_spread_scenario", "calibrated": False,
        "engine": manifest["engine"], "grid": manifest["grid"], "ignition": manifest["ignition"],
        "weather": {k: manifest["weather"][k] for k in ("selected_hours", "wind_conversion", "spatial_assumption")},
        "weather_source": "Open-Meteo Historical Forecast API, ECMWF IFS HRES (archived forecast) for 2 Sep 2024",
        "assumptions": manifest["assumptions"], "results": manifest["results"], "checks": manifest["checks"],
        "created_utc": manifest["created_utc"],
        "perimeters": {"type": "FeatureCollection", "features": [feature(f["geometry"], f["properties"]) for f in perims["features"]]},
        "arrival_cells": {"type": "FeatureCollection", "features": cells},
    })
    shutil.copyfile(s / "PYRETECHNICS-LICENSE.md", OUT / "spread" / "PYRETECHNICS-LICENSE.txt")
    from PIL import Image
    with Image.open(s / "mariovo-scenario.png") as im:
        im.convert("RGB").save(OUT / "spread" / "mariovo-scenario.jpg", quality=85, optimize=True)
    # Spread Lab: precomputed by tools/run_spread_lab.py in the separate Pyretechnics environment; copied, not recomputed.
    lab = READY / "spread-lab" / "web"
    index = json.loads((lab / "index.json").read_text())
    names = {"index.json", *(b["file"] for b in index["backtests"]), *(s["file"] for s in index["situations"]),
             *(c["file"] for runs in index["matrix"].values() for c in runs.values())}
    original = next(s for s in index["situations"] if s["id"] == "original")
    if index["calibrated"] is not False or original["runs"]["centre"]["final_ha"] != 17 or names != {p.name for p in lab.glob("*.json")}:
        raise ValueError("Spread Lab output is not the expected uncalibrated set; rerun tools/run_spread_lab.py")
    (OUT / "spread" / "lab").mkdir(parents=True, exist_ok=True)
    for name in sorted(names):
        shutil.copyfile(lab / name, OUT / "spread" / "lab" / name)


def export_current():
    firms_manifest = json.loads((READY / "firms" / "manifest.json").read_text())
    sources = []
    for src in firms_manifest["sources"]:
        records = json.loads((ROOT / src["normalized_path"]).read_text())
        if len(records) != src["detections"]:
            raise ValueError(f"{src['source']} count differs from manifest")
        sources.append({"source": src["source"], "http_status": src["http_status"], "status": src["status"],
                        "requested_days": src["requested_days"], "detections": records,
                        "latest_observed_utc": src["latest_observed_utc"], "sha256": src["sha256"]})
    write_json(OUT / "current" / "firms-sample.json", {
        "schema": "firewatch.current.firms.v1", "data_class": "satellite_detection", "delivery": "saved_sample",
        "retrieved_utc": firms_manifest["retrieved_utc"], "bbox_wgs84": firms_manifest["bbox_wgs84"],
        "scope": firms_manifest["scope"],
        "request": "FIRMS area API, CSV, VIIRS NRT, 1 day, bbox 20.4,40.8,23.1,42.5 (MAP_KEY withheld)",
        "credit": FIRMS_CREDIT, "sources": sources,
    })
    # Named-point weather is fetched live by the browser (Now.tsx WeatherPanel), so no weather sample is exported.
    added = {a["path"].split("/")[-1]: a for a in json.loads((ADDED / "manifest.json").read_text())["assets"]}
    # Air quality is fetched live by the browser (web/src/lib/openmeteo.ts), so no CAMS sample is exported.
    weekly = json.loads((ADDED / "effis-weekly-mkd-2026.json").read_text())
    annual = json.loads((ADDED / "effis-annual-mkd.json").read_text())
    nonnull = [r for r in weekly["banfcumulative"] if r["area_ha"] is not None]
    latest = nonnull[-1]
    if (latest["area_ha"], latest["events"], str(latest["mddate"])) != (25323, 69, "20261111"):
        raise ValueError("EFFIS latest cumulative row changed from verified 11 Nov 2026 25,323 ha / 69 events")
    write_json(OUT / "current" / "effis-season.json", {
        "schema": "firewatch.effis.season.v1", "data_class": "seasonal_burned_area_statistics", "delivery": "saved_sample",
        "retrieved_utc": added["effis-weekly-mkd-2026.json"]["retrieved_utc"], "country": "MKD", "year": 2026,
        "product": "EFFIS Rapid Damage Assessment mapped burned areas (weekly and cumulative statistics)",
        "source_url": added["effis-weekly-mkd-2026.json"]["source_url"], "annual_source_url": added["effis-annual-mkd.json"]["source_url"],
        "credit": "European Forest Fire Information System (EFFIS), Copernicus Emergency Management Service, CC BY 4.0",
        "units": {"area_ha": "hectares mapped", "events": "mapped burned-area events"},
        "reference_note": "avg/min/max are EFFIS-supplied reference fields for the same week; min_year in source is 2006.",
        "weekly": weekly["banfweekly"], "cumulative": weekly["banfcumulative"], "annual": annual,
    })


def export_wind():
    """Latest saved Open-Meteo wind grid (tools/fetch_wind_grid.py) as compact per-point hourly arrays."""
    metas = sorted((READY / "weather").glob("wind-grid-mk-*.metadata.json"))
    if not metas:
        raise ValueError("No saved wind grid; run tools/fetch_wind_grid.py")
    meta = json.loads(metas[-1].read_text())
    raw = (ROOT / meta["path"]).read_bytes()
    if hashlib.sha256(raw).hexdigest() != meta["sha256"]:
        raise ValueError("Wind grid hash differs from its metadata")
    body = json.loads(raw)
    requested = [(lat, lon) for lat in meta["grid"]["lats"] for lon in meta["grid"]["lons"]]
    if len(body) != len(requested):
        raise ValueError("Wind grid point count changed")
    write_json(OUT / "current" / "wind-grid.json", {
        "schema": "firewatch.current.wind.v1", "data_class": "modeled_weather", "delivery": "saved_sample",
        "provider": "Open-Meteo Forecast API", "model_requested": meta["model_requested"], "model_run_time": meta["model_run_time"],
        "retrieved_utc": meta["retrieved_utc"], "units": meta["units"], "spacing_deg": meta["grid"]["spacing_deg"],
        "credit": "Weather data by Open-Meteo.com (CC BY 4.0); ECMWF IFS HRES model (CC BY 4.0)",
        "note": meta["notes"],
        "times": [f"{x}Z" for x in body[0]["hourly"]["time"]],
        "points": [{"requested": list(rq), "grid": [round(b["latitude"], 4), round(b["longitude"], 4)], "elevation_m": b["elevation"],
                    "speed": [round(v, 1) for v in b["hourly"]["wind_speed_10m"]],
                    "dir": [int(v) for v in b["hourly"]["wind_direction_10m"]],
                    "gust": [round(v, 1) for v in b["hourly"]["wind_gusts_10m"]]} for rq, b in zip(requested, body)],
    })
    return len(body)


def export_power_weather():
    """NASA POWER daily weather (tools/fetch_power_weather.py) as one compact file per year: values x10 as integers, null for gaps."""
    meta_path = READY / "weather" / "power-daily" / "power-daily.metadata.json"
    if not meta_path.exists():
        print("no NASA POWER daily weather saved; run tools/fetch_power_weather.py (archive weather omitted)")
        return None
    meta = json.loads(meta_path.read_text())
    lats, lons = meta["grid"]["lats"], meta["grid"]["lons"]
    bodies = {}
    for f in meta["files"]:
        raw = (ROOT / f["path"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != f["sha256"]:
            raise ValueError(f"{f['path']} differs from its metadata hash")
        bodies[(f["lat"], f["lon"])] = json.loads(raw)
    order = [(lat, lon) for lat in lats for lon in lons]  # lat-major, both ascending: index = i * len(lons) + j
    if sorted(bodies) != sorted(order):
        raise ValueError("NASA POWER nodes do not form the recorded grid")
    keys = {"u": "U10M", "v": "V10M", "ws": "WS10M", "wsmax": "WS10M_MAX", "tmax": "T2M_MAX", "rh": "RH2M", "rain": "PRECTOTCORR"}
    start, end = (int(x[:4]) for x in meta["period"])
    for year in range(start, end + 1):
        days = sorted(d for d in bodies[order[0]]["properties"]["parameter"]["U10M"] if d.startswith(str(year)))
        doc = {"schema": "firewatch.history.weather.v1", "data_class": "reanalysis_weather", "year": year,
               "provider": meta["provider"], "source": meta["source"], "credit": meta["credit"], "notes": meta["notes"],
               "retrieved_utc": meta["retrieved_utc"], "lats": lats, "lons": lons, "start": f"{days[0][:4]}-{days[0][4:6]}-{days[0][6:]}", "days": len(days),
               "elevation_m": [round(bodies[k]["geometry"]["coordinates"][2]) for k in order], "scale": 10,
               "units": {"u": "m/s towards east", "v": "m/s towards north", "ws": "m/s daily mean", "wsmax": "m/s daily max", "tmax": "degC daily max",
                         "rh": "% daily mean", "rain": "mm/day bias-corrected"}}
        for short, param in keys.items():
            doc[short] = []
            for k in order:
                b = bodies[k]
                fill, col = b["header"]["fill_value"], b["properties"]["parameter"][param]
                doc[short].append([None if col[d] == fill else round(col[d] * 10) for d in days])
        write_json(OUT / "weather" / f"weather-{year}.json", doc)
    return {"years": list(range(start, end + 1)), "provider": meta["provider"], "source": meta["source"], "credit": meta["credit"],
            "grid": {"lats": lats, "lons": lons}, "note": meta["notes"]}


COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
COMPASS_WORD = {"N": "north", "NE": "north-east", "E": "east", "SE": "south-east", "S": "south", "SW": "south-west", "W": "west", "NW": "north-west"}


def export_fire_stories():
    """Fire stories from tools/fire_stories.json: EFFIS perimeter, archive detections inside it, daily progression and ERA5 weather.
    Reads the history partitions written by export_history; output goes to stories/fires/ (outside history/, so harmonize ignores it)."""
    from shapely.geometry import MultiPoint, Point, shape
    import shapely
    from shapely.prepared import prep
    cfg = json.loads((ROOT / "tools" / "fire_stories.json").read_text())
    dflt = cfg["defaults"]
    parts = {}
    for path in sorted((OUT / "history").glob("*.json")):
        h = json.loads(path.read_text())
        parts.setdefault(h["year"], []).append(h)
    index = []
    for s in cfg["stories"]:
        src = READY / "stories" / s["id"]
        meta = json.loads((src / "metadata.json").read_text())
        files = {f["path"]: f for f in meta["files"]}
        for name, f in files.items():
            if sha256(src / name) != f["sha256"]:
                raise ValueError(f"{s['id']}/{name} hash differs from its metadata")
        feat = json.loads((src / "effis-feature.geojson").read_text())
        p = feat["properties"]
        if str(p["id"]) != s["effis_id"] or p["COUNTRY"] != "MK":
            raise ValueError(f"{s['id']}: unexpected EFFIS feature")
        geom = shape(feat["geometry"])
        lat0, lon0 = meta["centroid"]
        kx, ky = 111.32 * math.cos(math.radians(lat0)), 110.57  # local equirectangular km, ample at fire scale
        to_km = lambda x, y, z=None: ((x - lon0) * kx, (y - lat0) * ky)  # noqa: E731
        zone = prep(shapely.transform(geom, lambda c: (c - [lon0, lat0]) * [kx, ky]).buffer(s.get("buffer_km", dflt["buffer_km"])))
        firedate = date.fromisoformat(p["FIREDATE"][:10])
        start = firedate - timedelta(days=dflt["days_before"])
        limit = start + timedelta(days=s.get("max_days", dflt["max_days"]) - 1)
        dets = []
        for h in parts.get(start.year, []) + (parts.get(limit.year, []) if limit.year != start.year else []):
            ix = {c: i for i, c in enumerate(h["columns"])}
            for r in h["rows"]:
                day = date.fromisoformat(r[ix["t"]][:10])
                if r[ix["type"]] == 2 or not start <= day <= limit:  # type 2 = static land source
                    continue
                if zone.contains(Point(to_km(r[ix["lon"]], r[ix["lat"]]))):
                    dets.append({"t": r[ix["t"]], "lat": r[ix["lat"]], "lon": r[ix["lon"]], "frp": r[ix["frp"]],
                                 "sensor": h["sensor"], "conf": r[ix["conf"]], "dn": r[ix["dn"]]})
        # The fire's run: detections from FIREDATE on, with at most gap_days empty days between detection days.
        last = firedate - timedelta(days=1)
        for day in sorted({date.fromisoformat(d["t"][:10]) for d in dets}):
            if day >= firedate and (day - last).days <= dflt["gap_days"] + 1:
                last = day
        if last < firedate:
            last = date.fromisoformat(p["FINALDATE"][:10])
        end = min(last + timedelta(days=1), limit)
        dets = sorted((d for d in dets if d["t"][:10] <= end.isoformat()), key=lambda d: (d["t"], d["lat"], d["lon"]))
        if not dets:
            raise ValueError(f"{s['id']}: no detections in the window")
        n_days = (end - start).days + 1
        days, seen = [], []
        for k in range(n_days):
            d = (start + timedelta(days=k)).isoformat()
            today = [x for x in dets if x["t"][:10] == d]
            seen += [to_km(x["lon"], x["lat"]) for x in today]
            hull = MultiPoint(seen).convex_hull.area if len(seen) >= 3 else 0.0
            days.append({"date": d, "detections": len(today), "by_sensor": dict(sorted(Counter(x["sensor"] for x in today).items())),
                         "frp_sum": round(sum(x["frp"] for x in today), 1), "frp_max": max((x["frp"] for x in today), default=0),
                         "centroid": [round(sum(x["lat"] for x in today) / len(today), 5), round(sum(x["lon"] for x in today) / len(today), 5)] if today else None,
                         "hull_km2": round(hull, 2)})
        w = json.loads((src / "era5-hourly.json").read_text())
        hr = w["hourly"]
        times = hr["time"]
        pos = {t: i for i, t in enumerate(times)}
        i0, i1 = pos[f"{start}T00:00"], pos[f"{end}T23:00"] + 1
        hourly = {"time": [t + "Z" for t in times[i0:i1]], "wind_kmh": hr["wind_speed_10m"][i0:i1], "wind_dir": hr["wind_direction_10m"][i0:i1],
                  "gust_kmh": hr["wind_gusts_10m"][i0:i1], "t": hr["temperature_2m"][i0:i1], "rh": hr["relative_humidity_2m"][i0:i1],
                  "rain": hr["precipitation"][i0:i1]}
        noon = []
        for k in range(-60, n_days):
            d = (start + timedelta(days=k)).isoformat()
            j = pos[f"{d}T11:00"]
            if j < 23:
                raise ValueError(f"{s['id']}: weather starts too late for a 24 h rain total on {d}")
            noon.append({"date": d, "t": hr["temperature_2m"][j], "rh": hr["relative_humidity_2m"][j], "wind": hr["wind_speed_10m"][j],
                         "rain": round(sum(hr["precipitation"][j - 23:j + 1]), 1)})
        # Windiest window day by mean hourly wind; its direction is the vector mean (direction the wind comes from).
        best = None
        for k in range(n_days):
            sl = slice(24 * k, 24 * k + 24)
            sp, dr = hourly["wind_kmh"][sl], hourly["wind_dir"][sl]
            mean = sum(sp) / 24
            u = sum(v * math.sin(math.radians(a)) for v, a in zip(sp, dr)); vv = sum(v * math.cos(math.radians(a)) for v, a in zip(sp, dr))
            if best is None or mean > best[1]:
                best = (days[k]["date"], mean, COMPASS[round((math.degrees(math.atan2(u, vv)) % 360) / 45) % 8], max(hourly["gust_kmh"][sl]))
        peak = max(days, key=lambda d: d["detections"])
        active = sum(1 for d in days if d["detections"])
        area = round(float(p["AREA_HA"]))
        summary = [
            f"EFFIS maps {area:,} ha burned in {s['municipality']} and dates the fire from {p['FIREDATE'][:10]} to {p['FINALDATE'][:10]}.",
            f"Satellites recorded {len(dets)} hotspot detections inside the mapped area on {active} of the {n_days} days shown, the most on {peak['date']} ({peak['detections']}).",
            f"The windiest day in ERA5 was {best[0]}, averaging {best[1]:.0f} km/h from the {COMPASS_WORD[best[2]]} with gusts to {best[3]:.0f} km/h.",
        ]
        perimeter = {"type": "Feature", "properties": {"effis_id": str(p["id"]), "area_ha": area},
                     "geometry": {"type": feat["geometry"]["type"], "coordinates": round_coords(feat["geometry"]["coordinates"])}}
        if len(json.dumps(perimeter)) > 200_000:
            g = geom.simplify(0.0002, preserve_topology=True).__geo_interface__
            perimeter["geometry"] = {"type": g["type"], "coordinates": round_coords(g["coordinates"])}
            perimeter["properties"]["simplified_deg"] = 0.0002
        landcover = {"broadleaf": "BROADLEA", "conifer": "CONIFER", "mixed": "MIXED", "sclerophyll": "SCLEROPH", "transitional": "TRANSIT",
                     "other_natural": "OTHERNATLC", "agricultural": "AGRIAREAS", "artificial": "ARTIFSURF", "other": "OTHERLC"}
        eff, era = files["effis-feature.geojson"], files["era5-hourly.json"]
        minx, miny, maxx, maxy = geom.bounds
        buffer_km = s.get("buffer_km", dflt["buffer_km"])
        doc = {
            "schema": "firewatch.story.fire.v1", "id": s["id"], "title": s["title"], "place": s["place"], "place_mk": s["place_mk"],
            "municipality": s["municipality"], "year": firedate.year, "summary": summary, "context": s.get("context", []),
            "official": {"source": "EFFIS burned area", "effis_id": str(p["id"]), "firedate": p["FIREDATE"], "finaldate": p["FINALDATE"],
                         "lastupdate": p["LASTUPDATE"], "area_ha": area,
                         "landcover_pct": {k: round(float(p[v]), 1) for k, v in landcover.items() if p.get(v) not in (None, "")},
                         "natura2000_pct": round(float(p["PERCNA2K"]), 1) if p.get("PERCNA2K") not in (None, "") else None,
                         "query_url": eff["url"]},
            "perimeter": perimeter, "center": [round(lat0, 5), round(lon0, 5)], "bbox": [round(v, 5) for v in (minx, miny, maxx, maxy)],
            "window": {"start": start.isoformat(), "end": end.isoformat()},
            "detections": dets,
            "selection": (f"Archive detections (MODIS and VIIRS, algorithm type 2 static sources excluded) inside the EFFIS perimeter buffered by "
                          f"{buffer_km:g} km, from two days before the EFFIS fire date to one day after the last detection day of the fire's run "
                          f"(at most {dflt['gap_days']} empty days in between), {n_days} days at most {dflt['max_days']}."),
            "days": days,
            "weather": {"source": "ERA5 reanalysis via Open-Meteo archive API", "grid": [w["latitude"], w["longitude"]], "elevation_m": w["elevation"],
                        "hourly": hourly, "noon": noon,
                        "notes": "Hourly values at the ERA5 cell nearest the perimeter centroid (about 25 km grid): regional weather, not the fire's own valley. "
                                 "Noon = 11:00 UTC; noon rain is the 24 h total up to that hour."},
            "sources": [{"label": f"EFFIS burned area {firedate.year}, feature {p['id']}", "url": eff["url"]},
                        {"label": "ERA5 hourly via Open-Meteo archive API", "url": era["url"]},
                        {"label": "NASA FIRMS active fire archive (MODIS, VIIRS)", "url": "https://firms.modaps.eosdis.nasa.gov/"}],
            "credits": ("Burned area: EFFIS, European Commission Joint Research Centre (CC BY 4.0). Weather: ERA5 (ECMWF / Copernicus Climate Change Service) "
                        "via Open-Meteo (CC BY 4.0). " + FIRMS_CREDIT),
            "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        write_json(OUT / "stories" / "fires" / f"{s['id']}.json", doc)
        index.append({"id": s["id"], "title": s["title"], "place": s["place"], "place_mk": s["place_mk"], "municipality": s["municipality"],
                      "year": firedate.year, "start": start.isoformat(), "end": end.isoformat(), "area_ha": area, "detections": len(dets),
                      "peak_day": peak["date"], "center": doc["center"]})
    write_json(OUT / "stories" / "fires" / "index.json", {"schema": "firewatch.story.fire.index.v1", "stories": index})
    return len(index)


def sync_functions():
    """The ingestion function ships its own copies of the grouping code, country polygon and places (one source: tools/ and Data/)."""
    fn = ROOT / "functions"
    if not fn.exists():
        return
    shutil.copyfile(ROOT / "tools" / "firelib.py", fn / "firelib.py")
    geom = json.loads((ADDED / "geoboundaries-mkd-adm0.geojson").read_text())["features"][0]["geometry"]
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    (fn / "data").mkdir(exist_ok=True)
    write_json(fn / "data" / "boundary.json", round_coords(polys))
    write_json(fn / "data" / "places.json", PLACES)


def write_catalog(history, places, mariovo_cells, mariovo_counts, weather=None):
    files = sorted(p for p in OUT.rglob("*") if p.is_file() and p.name != "catalog.json")
    write_json(OUT / "catalog.json", {
        "schema": "firewatch.catalog.v1", "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "transformation_version": TRANSFORM_VERSION, "credit": FIRMS_CREDIT,
        "history": {"sensors": {k: {x: v[x] for x in ("label", "instrument", "confidence_scale", "record_start")} for k, v in SENSORS.items()},
                    "records": history["records"], "files": history["files"], "coverage": history["coverage"],
                    "archive_records": history["archive_records"],
                    "source_selection": "35 original North Macedonia CSVs named by docs/data-audit/file-inventory.csv (SHA-256 and counts re-verified), plus gap years from the FIRMS area API clipped to the geoBoundaries 2016 polygon.",
                    "quality_policy": "All rows exported unchanged in meaning; no confidence/type exclusion at export. Times are UTC from acq_date + zero-padded acq_time."},
        "weather": weather,
        "places": places, "mariovo": {"mcd64a1_cells": mariovo_cells, "inside_reference_detections_sep1_7": mariovo_counts},
        "files": [{"path": str(p.relative_to(OUT)), "bytes": p.stat().st_size, "sha256": sha256(p)} for p in files],
    })


def self_test():
    assert utc_time("2026-11-14", "32") == "2026-11-14T00:32Z"
    assert utc_time("2024-01-05", "1147") == "2024-01-05T11:47Z"
    assert utc_time("2024-01-05", "5") == "2024-01-05T00:05Z"
    for bad in ("1260", "2400", "12:00", "", "12345"):
        try:
            utc_time("2024-01-05", bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad!r}")
    base = {"latitude": "41.5", "longitude": "21.5", "acq_date": "2024-09-04", "acq_time": "103", "satellite": "N20",
            "confidence": "h", "version": "2", "frp": "3.1", "daynight": "D", "type": "0", "scan": "0.4", "track": "0.4",
            "bright_ti4": "330.1", "bright_ti5": "290.0"}
    assert parse_row(base, "viirs-jpss1", 2024)[0] == "2024-09-04T01:03Z"
    for change, family in (({"confidence": "55"}, "viirs-jpss1"), ({"confidence": "n"}, "modis"),
                           ({"acq_date": "2023-12-31"}, "viirs-jpss1"), ({"latitude": "nan"}, "viirs-jpss1"), ({"type": "4"}, "viirs-jpss1")):
        try:
            parse_row({**base, **change, "brightness": "300", "bright_t31": "290"}, family, 2024)
        except ValueError:
            continue
        raise AssertionError(f"accepted {change}")
    assert round_coords([[21.1234567, 41.7654321]]) == [[21.12346, 41.76543]]
    print("self-test passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--self-test", action="store_true")
    if parser.parse_args().self_test:
        return self_test()
    if OUT.exists():
        shutil.rmtree(OUT)  # generated directory only; sources live under Data/ and docs/
    history = export_history()
    places = export_places()
    export_boundary()
    export_brvenica()
    cells, counts = export_mariovo()
    export_spread()
    export_current()
    export_wind()
    weather = export_power_weather()
    fires = export_recent(PLACES)
    print(f"recent window: {fires} detection groups")
    sync_functions()
    import harmonize  # reads the partitions just written; regenerated here because this export clears its folder
    harmonize.main()
    print(f"fire stories: {export_fire_stories()}")
    write_catalog(history, places, cells, counts, weather)
    size = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"exported {history['records']} detections ({history['archive_records']} archive) in {len(history['files'])} partitions, {places} places, "
          f"{cells} MCD64A1 cells; inside-reference check {counts}; {size / 1e6:.2f} MB in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
