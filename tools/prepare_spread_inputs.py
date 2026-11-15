#!/usr/bin/env python3
"""Prepare bounded EFFIS fuels and observed 2017 progression; never fit a forecast."""
import argparse
import csv
import hashlib
import json
import math
import struct
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from zipfile import ZipFile

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds, transform_geom
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.validation import explain_validity

ROOT = Path(__file__).resolve().parents[1]
FUEL_DIR = ROOT / "Data/readiness/fuels"
PROGRESSION_DIR = ROOT / "Data/readiness/progression-2017"
BBOXES = {"mariovo": (21.565, 41.198, 21.735, 41.345),
          "event-12376": (21.0, 41.735, 21.18, 41.875)}
SERVICE = "https://maps.effis.emergency.copernicus.eu/effis"
# Exact official legend swatches, in NFFL/Anderson 1..10 order.
COLORS = [(16, 240, 96), (16, 192, 64), (16, 128, 16), (224, 224, 0),
          (255, 255, 0), (255, 204, 0), (255, 102, 0), (192, 128, 64),
          (160, 64, 0), (112, 48, 48)]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_raster(path, data, transform, crs, nodata, description):
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", count=1, height=data.shape[0],
                       width=data.shape[1], dtype=data.dtype, crs=crs,
                       transform=transform, nodata=nodata, compress="deflate") as ds:
        ds.write(data, 1)
        ds.set_band_description(1, description)


def infer_crosswalk(raw, rendered, legend):
    """Require exact pixel alignment and one official legend colour per numeric class."""
    if rendered.shape != (*raw.shape, 3):
        raise ValueError("Raw and styled validation images have different dimensions")
    for i, color in enumerate(COLORS):
        if tuple(legend[9 + 15 * i, 10]) != color:
            raise ValueError("Official legend changed; inspect it before assigning models")
    crosswalk = {}
    for value in np.unique(raw):
        if not np.isfinite(value) or value != int(value):
            raise ValueError("Fuel category is not a finite integer")
        colors = np.unique(rendered[raw == value], axis=0)
        if len(colors) != 1:
            raise ValueError(f"Category {value} maps to multiple rendered colours")
        color = tuple(int(c) for c in colors[0])
        if color == (255, 255, 255):
            model = 0  # Exclusion, not a claim of measured nonburnable land.
        elif color in COLORS:
            model = COLORS.index(color) + 1
        else:
            raise ValueError(f"Category {value} has no recognised legend colour: {color}")
        crosswalk[int(value)] = model
    return crosswalk


def prepare_fuels():
    legend = np.asarray(Image.open(FUEL_DIR / "source/effis-fuel-legend.png").convert("RGB"))
    manifest = {"source": SERVICE, "product": "effis.fuel_map; WMS abstract Fuel Map - ver. 2017",
                "license": "CC BY 4.0, subject to individual source notices",
                "license_url": "https://forest-fire.emergency.copernicus.eu/about-effis/data-license",
                "interpretation": "Numeric WCS categories; engine crosswalk verified against official style and NFFL legend",
                "limitations": ["Generalized regional classification, not field-measured fuels",
                    "White/unclassified source codes excluded as model 0, not measured nonburnable",
                    "100 m resampling does not improve approximately 290 m local source detail",
                    "No live/dead moisture or canopy measurements supplied",
                    "WCS range metadata incorrectly labels categories as radiance; not physical radiance data"],
                "areas": {}}
    for name, bbox in BBOXES.items():
        source = FUEL_DIR / f"source/effis-fuel-{name}.tif"
        with rasterio.open(source) as ds:
            raw = ds.read(1)
            if ds.count != 1:
                raise ValueError("Expected one-band numeric WCS coverage")
            rendered = np.asarray(Image.open(FUEL_DIR / f"source/effis-fuel-{name}-style.png").convert("RGB"))
            crosswalk = infer_crosswalk(raw, rendered, legend)
            bounds = transform_bounds("EPSG:4326", "EPSG:32634", *bbox)
            left, bottom = [math.floor(v / 100) * 100 for v in bounds[:2]]
            right, top = [math.ceil(v / 100) * 100 for v in bounds[2:]]
            grid = from_origin(left, top, 100, 100)
            shape_ = (int((top - bottom) / 100), int((right - left) / 100))
            out = FUEL_DIR / name / "fuel-model.tif"
            raw_dest = np.full(shape_, 255, dtype="uint8")
            reproject(raw.astype("uint8"), raw_dest, src_transform=ds.transform, src_crs=ds.crs,
                      src_nodata=255, dst_transform=grid, dst_crs="EPSG:32634", dst_nodata=255,
                      resampling=Resampling.nearest)
            # Map after resampling: zero is an exclusion, never a value GDAL may fill.
            dest = np.zeros(shape_, dtype="uint8")
            for value, target in crosswalk.items():
                dest[raw_dest == value] = target
            if np.any(dest[np.isin(raw_dest, [v for v, m in crosswalk.items() if m == 0])] != 0):
                raise ValueError("Excluded source classes became burnable")
            write_raster(out, dest, grid, "EPSG:32634", 0, "NFFL model; 0 excluded/unknown")
            write_raster(out.with_name("effis-source-code.tif"), raw_dest, grid,
                         "EPSG:32634", 255, "EFFIS internal source categories; 255 outside")
            counts = {str(int(v)): int(n) for v, n in zip(*np.unique(raw, return_counts=True))}
            coverage_url = SERVICE + "?" + urlencode([
                ("service", "WCS"), ("version", "2.0.1"), ("request", "GetCoverage"),
                ("coverageId", "fuel_map"), ("format", "image/tiff"),
                ("subset", f"x({ds.bounds.left},{ds.bounds.right})"),
                ("subset", f"y({ds.bounds.bottom},{ds.bounds.top})")])
            original_bounds = transform_bounds("EPSG:4326", "EPSG:3857", *bbox)
            original_query = SERVICE + "?" + urlencode([
                ("service", "WCS"), ("version", "2.0.1"), ("request", "GetCoverage"),
                ("coverageId", "fuel_map"), ("format", "image/tiff"),
                ("subset", f"x({original_bounds[0]},{original_bounds[2]})"),
                ("subset", f"y({original_bounds[1]},{original_bounds[3]})")])
            style_path = source.with_name(f"effis-fuel-{name}-style.png")
            style_query = SERVICE + "?" + urlencode([
                ("service", "WMS"), ("version", "1.3.0"), ("request", "GetMap"),
                ("layers", "fuel_map"), ("styles", "default"), ("crs", "EPSG:3857"),
                ("bbox", ",".join(str(v) for v in original_bounds)), ("width", ds.width),
                ("height", ds.height), ("format", "image/png")])
            info = {"bbox_wgs84": bbox,
                    "source_request_reconstructed_from_raster_bounds": coverage_url,
                    "source_download_query_used": original_query,
                    "download_completed_utc_from_local_file_mtime": datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat(),
                    "style_comparison_url": style_query, "style_comparison_sha256": sha256(style_path),
                    "legend_url": SERVICE + "?service=WMS&version=1.1.1&request=GetLegendGraphic&layer=fuel_map&format=image/png",
                    "legend_sha256": sha256(FUEL_DIR / "source/effis-fuel-legend.png"),
                    "source_sha256": sha256(source), "source_shape": list(raw.shape),
                    "source_resolution_mercator_m": list(ds.res), "source_counts": counts,
                    "crosswalk_internal_to_nffl": crosswalk, "output": str(out.relative_to(ROOT)),
                    "output_sha256": sha256(out), "crs": "EPSG:32634", "resolution_m": 100,
                    "shape": list(shape_), "transform": list(grid)[:6],
                    "excluded_output_cells": int(np.sum(dest == 0)), "total_output_cells": int(dest.size)}
        if name == "mariovo":
            base = ROOT / "Data/case-studies/mariovo-2024/derived"
            valid = dest != 0
            for src_name, filename, dtype, nodata, resampling in [
                ("elevation-utm30m.tif", "elevation.tif", "float32", -9999, Resampling.bilinear),
                ("land-cover-utm30m.tif", "worldcover.tif", "uint8", 255, Resampling.nearest)]:
                target = np.full(shape_, nodata, dtype=dtype)
                with rasterio.open(base / src_name) as ds:
                    reproject(rasterio.band(ds, 1), target, dst_transform=grid, dst_crs="EPSG:32634",
                              dst_nodata=nodata, resampling=resampling)
                write_raster(out.with_name(filename), target, grid, "EPSG:32634", nodata, filename)
                valid &= target != nodata
                info[filename] = {"source": str((base / src_name).relative_to(ROOT)),
                                  "nodata_cells": int(np.sum(target == nodata)),
                                  "sha256": sha256(out.with_name(filename))}
            write_raster(out.with_name("valid-input-mask.tif"), valid.astype("uint8"), grid,
                         "EPSG:32634", None, "1 all three inputs valid; 0 excluded")
            info["joint_valid_input_cells"] = int(np.sum(valid))
        manifest["areas"][name] = info
    write_json(FUEL_DIR / "manifest.json", manifest)
    return manifest


def dbf_records(data):
    count, header, length = struct.unpack_from("<IHH", data, 4)
    fields = []
    for pos in range(32, header - 1, 32):
        f = data[pos:pos + 32]
        fields.append((f[:11].split(b"\0")[0].decode(), chr(f[11]), f[16], f[17]))
    for i in range(count):
        row = data[header + i * length:header + (i + 1) * length]
        if len(row) != length or row[:1] != b" ":
            raise ValueError("Truncated or deleted DBF row")
        result, offset = {}, 1
        for name, kind, width, decimals in fields:
            value = row[offset:offset + width].decode("utf-8").strip()
            offset += width
            if not value or set(value) == {"*"}:
                value = None
            elif kind == "N":
                value = float(value) if decimals else int(value)
            result[name] = value
        yield result


def shp_geometries(data):
    if struct.unpack_from(">i", data)[0] != 9994:
        raise ValueError("Not a shapefile")
    pos = 100
    while pos < len(data):
        _, words = struct.unpack_from(">ii", data, pos)
        part = data[pos + 8:pos + 8 + words * 2]
        pos += 8 + words * 2
        kind = struct.unpack_from("<i", part)[0]
        if kind == 0:
            yield None
            continue
        if kind != 5:
            raise ValueError(f"Unsupported shapefile geometry: {kind}")
        nrings, npoints = struct.unpack_from("<ii", part, 36)
        starts = list(struct.unpack_from(f"<{nrings}i", part, 44)) + [npoints]
        points = np.asarray(struct.unpack_from(f"<{npoints * 2}d", part, 44 + nrings * 4)).reshape(-1, 2)
        rings = [points[starts[i]:starts[i + 1]] for i in range(nrings)]
        shells, holes = [], []
        for ring in rings:
            poly = Polygon(ring)
            (holes if poly.exterior.is_ccw else shells).append(poly)
        if not shells:
            raise ValueError("Polygon has no clockwise exterior ring")
        polygons = []
        interior_by_shell = [[] for _ in shells]
        for hole in holes:
            owners = [i for i, shell in enumerate(shells) if shell.contains(hole.representative_point())]
            if not owners:
                raise ValueError("Unassigned interior ring")
            owner = min(owners, key=lambda i: shells[i].area)
            interior_by_shell[owner].append(hole.exterior.coords)
        for shell, interior in zip(shells, interior_by_shell):
            polygons.append(Polygon(shell.exterior.coords, interior))
        yield polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)


def prepare_progression():
    source = ROOT / "Data/reference/fire-spread-medeu/FireSpread_MedEU.zip"
    original_manifest = json.loads(source.with_name("manifest.json").read_text())
    if sha256(source) != original_manifest["sha256"]:
        raise ValueError("Source ZIP checksum differs from original verified download")
    with ZipFile(source) as z:
        records = list(dbf_records(z.read("FireSpread_MedEU.dbf")))
        geometries = list(shp_geometries(z.read("FireSpread_MedEU.shp")))
        if len(records) != len(geometries):
            raise ValueError("SHP/DBF record count differs")
        PROGRESSION_DIR.mkdir(parents=True, exist_ok=True)
        (PROGRESSION_DIR / "feature_description.pdf").write_bytes(z.read("feature_description.pdf"))
    features, missing, prefire, intervals = [], [], [], []
    previous = None
    for i, (record, geom) in enumerate(zip(records, geometries)):
        if record["EFFIS_id"] != 12376:
            continue
        props = dict(record, source_row_zero_based=i)
        if record["Acqu_time"]:
            # Planet acquisition timestamps are UTC; source DBF has no timezone suffix.
            props["acquisition_utc"] = record["Acqu_date"] + "T" + record["Acqu_time"] + "Z"
            props["timezone_basis"] = "Planet acquisition convention; source DBF has no explicit zone"
        else:
            props["acquisition_utc"] = None
        if record["Prop_step"] is None:
            if geom is not None:
                raise ValueError("Missing-date row unexpectedly contains geometry")
            missing.append(props)
            continue
        if geom is None or geom.is_empty or not geom.is_valid:
            raise ValueError(f"Invalid observed geometry at row {i}: {explain_validity(geom)}")
        props["geometry_area_ha_equal_area"] = geom.area / 10000
        props["geometry_valid"] = True
        wgs84 = transform_geom("EPSG:3035", "EPSG:4326", mapping(geom), precision=8)
        feature = {"type": "Feature", "geometry": wgs84, "properties": props}
        if record["Prop_step"] == 0:
            props["use_as_burned_area"] = False
            prefire.append(feature)
            continue
        props["use_as_burned_area"] = True
        props["area_minus_reported_ha"] = geom.area / 10000 - record["BA (ha)"]
        features.append(feature)
        if previous:
            prior, prior_props = previous
            elapsed = (datetime.fromisoformat(props["acquisition_utc"]) -
                       datetime.fromisoformat(prior_props["acquisition_utc"])).total_seconds() / 3600
            if elapsed <= 0:
                raise ValueError("Observation acquisition times are not strictly increasing")
            lost = prior.difference(geom).area / 10000
            gain = geom.difference(prior).area / 10000
            intervals.append({"from_step": int(prior_props["Prop_step"]),
                "to_step": int(props["Prop_step"]), "from_acquisition_utc": prior_props["acquisition_utc"],
                "to_acquisition_utc": props["acquisition_utc"], "elapsed_hours": elapsed,
                "area_gain_ha": gain, "previous_area_missing_ha": lost,
                "net_geometry_area_change_ha": gain - lost,
                "interval_mean_net_growth_ha_per_hour": (gain - lost) / elapsed,
                "interpretation": "Interval average only; no hourly progression observations",
                "quality_from": prior_props["Quality"], "quality_to": props["Quality"]})
        previous = geom, props
    if len(features) != 8 or len(prefire) != 1 or len(missing) != 15:
        raise ValueError(f"Event inventory changed: {len(features)}, {len(prefire)}, {len(missing)}")
    for name, value in [("observed-perimeters.geojson", {"type": "FeatureCollection", "features": features}),
                        ("prefire-reference.geojson", {"type": "FeatureCollection", "features": prefire}),
                        ("missing-observations.json", missing), ("observed-growth-intervals.json", intervals)]:
        write_json(PROGRESSION_DIR / name, value)
    with (PROGRESSION_DIR / "observed-growth-intervals.csv").open("w") as f:
        writer = csv.DictWriter(f, fieldnames=list(intervals[0]))
        writer.writeheader()
        writer.writerows(intervals)
    with (PROGRESSION_DIR / "observations.csv").open("w") as f:
        rows = [x["properties"] for x in features]
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    result = {"event_id": 12376, "source": "https://zenodo.org/records/18200075",
        "source_zip_sha256": sha256(source), "license": "CC BY 4.0; see original reference manifest",
        "source_crs": "EPSG:3035", "output_crs": "EPSG:4326", "source_total_rows": len(records),
        "observed_steps": len(features), "missing_date_rows": len(missing), "prefire_rows": len(prefire),
        "max_absolute_area_discrepancy_ha": max(abs(x["properties"]["area_minus_reported_ha"]) for x in features),
        "max_previous_area_missing_ha": max(x["previous_area_missing_ha"] for x in intervals),
        "timezone_assumption": "Planet acquisition UTC convention; DBF/PDF don't explicitly state timezone",
        "timezone_convention_source": "https://docs.planet.com/data/imagery/mosaics/",
        "official_event_identity": "EFFIS identifier supplied by dataset; independent event-name match pending",
        "limitations": ["Eight satellite observations are not hourly progression or operational fire fronts",
            "First two burn steps have low subjective quality; smoke/cloud and missing days retained",
            "Prefire tiny geometry is preserved separately and never treated as burned area",
            "Source geometry is not silently repaired or forced monotonic"]}
    official_path = PROGRESSION_DIR / "effis-official-event-query.json"
    if official_path.exists():
        official = json.loads(official_path.read_text())
        matches = [f for f in official["features"] if str(f["properties"]["id"]) == "12376"]
        if len(matches) != 1:
            raise ValueError("Official source does not uniquely match the progression event")
        props = matches[0]["properties"]
        if props["COUNTRY"] != "MK":
            raise ValueError("Official event country is not MK")
        result["official_event_identity"] = props
        result["official_event_query"] = SERVICE + "?service=WFS&version=2.0.0&request=GetFeature&typeNames=ms:modis.ba.poly.2017&count=10&srsName=EPSG:4326&bbox=41.735,21.0,41.875,21.18,EPSG:4326&outputFormat=geojson"
        result["official_event_query_sha256"] = sha256(official_path)
        official_geom = shape(transform_geom("EPSG:4326", "EPSG:3035", matches[0]["geometry"]))
        final_geom = previous[0]
        result["final_observation_vs_official_iou"] = final_geom.intersection(official_geom).area / final_geom.union(official_geom).area
        result["final_observation_minus_official_reported_area_ha"] = features[-1]["properties"]["BA (ha)"] - float(props["AREA_HA"])
        result["limitations"].append("EFFIS dates/area differ from Planet progression; neither source overwritten")
    write_json(PROGRESSION_DIR / "manifest.json", result)
    return result


def render_progression():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    data = json.loads((PROGRESSION_DIR / "observed-perimeters.geojson").read_text())
    fig, ax = plt.subplots(figsize=(9, 9))
    for i, feature in enumerate(data["features"]):
        geom = shape(transform_geom("EPSG:4326", "EPSG:32634", feature["geometry"]))
        polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
        label = feature["properties"]["acquisition_utc"].replace("T", " ")
        for j, poly in enumerate(polys):
            xy = np.asarray(poly.exterior.coords) / 1000
            ax.plot(xy[:, 0], xy[:, 1], color=plt.cm.plasma(i / 8), linewidth=1.2,
                    label=label if j == 0 else None)
    ax.set_aspect("equal")
    ax.set(xlabel="UTM 34N easting (km)", ylabel="UTM 34N northing (km)",
           title="Observed burned-area outlines · EFFIS event 12376 · Brvenica")
    ax.legend(loc="upper right", fontsize=8)
    fig.text(.1, .035, "FireSpread_MedEU v2 / CC BY 4.0 · exact observation times; no interpolated fronts\n"
             "First two outlines have low quality. UTC follows Planet convention; raw source has no zone suffix.", fontsize=8)
    fig.subplots_adjust(bottom=.12)
    fig.savefig(PROGRESSION_DIR / "observed-progression.png", dpi=150)
    plt.close(fig)


def self_test():
    legend = np.zeros((158, 141, 3), dtype="uint8")
    for i, c in enumerate(COLORS):
        legend[9 + 15 * i, 10] = c
    assert infer_crosswalk(np.array([[3, 50]]), np.array([[COLORS[0], (255, 255, 255)]]), legend) == {3: 1, 50: 0}
    try:
        infer_crosswalk(np.array([[3, 3]]), np.array([[COLORS[0], COLORS[1]]]), legend)
    except ValueError:
        pass
    else:
        raise AssertionError("Ambiguous source mapping was accepted")
    outer = [(0, 0), (0, 10), (10, 10), (10, 0), (0, 0)]
    hole = [(2, 2), (4, 2), (4, 4), (2, 4), (2, 2)]
    points = outer + hole
    header = bytearray(100)
    struct.pack_into(">i", header, 0, 9994)
    body = struct.pack("<i4d2i2i", 5, 0., 0., 10., 10., 2, len(points), 0, len(outer))
    body += struct.pack(f"<{len(points) * 2}d", *(v for p in points for v in p))
    record = struct.pack(">ii", 1, len(body) // 2) + body
    geom = list(shp_geometries(bytes(header) + record))[0]
    assert geom.is_valid and geom.area == 96 and len(geom.interiors) == 1
    source = np.array([[1, 0], [0, 2]], dtype="uint8")
    dest = np.zeros((4, 4), dtype="uint8")
    reproject(source, dest, src_transform=from_origin(0, 2, 1, 1), src_crs="EPSG:32634",
              src_nodata=255, dst_transform=from_origin(0, 2, .5, .5), dst_crs="EPSG:32634",
              dst_nodata=255, resampling=Resampling.nearest)
    assert np.array_equal(dest, np.repeat(np.repeat(source, 2, axis=0), 2, axis=1))
    print("self-test passed: ambiguity rejected; zero exclusions survive reprojection; SHP hole preserved")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--fuels-only", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        fuels = prepare_fuels()
        print(json.dumps({name: area["shape"] for name, area in fuels["areas"].items()}))
        if not args.fuels_only:
            print(json.dumps(prepare_progression(), indent=2))
            render_progression()
