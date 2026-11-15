"""Bounded, credential-free source proofs; no website or cloud changes.

Run --self-test offline, --fetch for explicit public samples, --verify-saved
to check retained bytes/contracts. Failures are recorded, never called data.
"""

import argparse
import csv
import hashlib
import io
import json
import math
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "Data/readiness/additional-sources"
UA = "ApexFire-NorthMacedonia-research/2026.11 (bounded public API evaluation)"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def boundary(data):
    require(data.get("type") == "FeatureCollection" and data.get("features"), "No boundary features")
    points = []

    def visit(coords):
        if len(coords) >= 2 and type(coords[0]) in (int, float):
            require(all(math.isfinite(n) for n in coords[:2]), "Nonfinite coordinate")
            points.append(coords[:2])
        else:
            for value in coords:
                visit(value)

    for feature in data["features"]:
        geom = feature.get("geometry", {})
        require(geom.get("type") in ("Polygon", "MultiPolygon"), "Unexpected boundary geometry")
        visit(geom["coordinates"])
    require(points, "Empty boundary coordinates")
    bounds = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
    require(20 < bounds[0] < bounds[2] < 24 and 40 < bounds[1] < bounds[3] < 43, "Boundary outside MK envelope")
    return {"features": len(data["features"]), "vertices": len(points), "bbox_wgs84": bounds}


def validate(kind, raw):
    if kind == "geonames":
        with ZipFile(io.BytesIO(raw)) as archive:
            info = archive.getinfo("MK.txt")
            require(info.file_size <= 10_000_000, "Gazetteer expands beyond bound")
            rows = list(csv.reader(io.StringIO(archive.read(info).decode("utf-8")), delimiter="\t"))
        require(rows and all(len(r) == 19 and r[8] == "MK" for r in rows), "Invalid MK gazetteer columns/country")
        require(all(40 < float(r[4]) < 43 and 20 < float(r[5]) < 24 for r in rows), "Invalid gazetteer coordinates")
        return {"records": len(rows), "populated_places": sum(r[6] == "P" for r in rows), "format": "GeoNames 19-column UTF-8", "live_population": False}
    if kind == "jpeg":
        require(raw.startswith(b"\xff\xd8") and raw.endswith(b"\xff\xd9"), "Not a complete JPEG")
        return {"format": "JPEG", "numeric_science_data": False}
    if kind == "gibs-capabilities":
        root = ElementTree.fromstring(raw)
        selected = next((el for el in root.iter() if el.tag.endswith("}Layer") and any(c.tag.endswith("}Identifier") and c.text == "MODIS_Terra_CorrectedReflectance_TrueColor" for c in el)), None)
        require(selected is not None, "Selected GIBS layer absent")
        matrices = [el.text for el in selected.iter() if el.tag.endswith("}TileMatrixSet")]
        require("GoogleMapsCompatible_Level9" in matrices, "Unexpected GIBS tile matrix")
        return {"layer": "MODIS_Terra_CorrectedReflectance_TrueColor", "tile_matrix_sets": matrices}
    data = json.loads(raw)
    if kind.startswith("boundary-meta"):
        level = kind.rsplit("-", 1)[1]
        require(data.get("boundaryISO") == "MKD" and data.get("boundaryType") == level, "Wrong boundary metadata")
        require("CC BY 4.0" in data.get("boundaryLicense", ""), "Unexpected boundary license")
        require(urllib.parse.urlsplit(data["gjDownloadURL"]).hostname == "github.com", "Unexpected boundary download host")
        return {"boundary_id": data["boundaryID"], "year_represented": data["boundaryYearRepresented"], "license": data["boundaryLicense"], "expected_features": int(data["admUnitCount"])}
    if kind == "boundary":
        return boundary(data)
    if kind == "air-quality":
        require(data.get("utc_offset_seconds") == 0, "AQ time is not UTC")
        hourly = data.get("hourly", {})
        times = [datetime.fromisoformat(t) for t in hourly.get("time", [])]
        require(len(times) == 48 and all((b - a).total_seconds() == 3600 for a, b in zip(times, times[1:])), "Invalid AQ hourly window")
        for name in ("pm10", "pm2_5", "carbon_monoxide", "european_aqi"):
            values = hourly.get(name, [])
            require(len(values) == len(times) and all(type(x) in (int, float) and math.isfinite(x) and x >= 0 for x in values), "Invalid AQ values: " + name)
            unit = data.get("hourly_units", {}).get(name)
            require(unit in ("μg/m³", "µg/m³") if name != "european_aqi" else unit == "EAQI", "Unexpected AQ unit: " + name)
        return {"hourly_samples": len(times), "start_utc": times[0].isoformat() + "+00:00", "end_utc": times[-1].isoformat() + "+00:00", "units": data["hourly_units"], "requested_domain": "cams_europe", "fire_attribution": False}
    if kind == "met":
        require(data.get("type") == "Feature", "Invalid MET feature")
        meta = data["properties"]["meta"]
        times = data["properties"]["timeseries"]
        require(len(times) >= 24, "Insufficient MET forecast")
        datetime.fromisoformat(meta["updated_at"].replace("Z", "+00:00"))
        for row in times:
            require(row["time"].endswith("Z"), "MET time missing UTC")
            values = row["data"]["instant"]["details"]
            for name in ("air_temperature", "relative_humidity", "wind_speed", "wind_from_direction"):
                require(type(values.get(name)) in (int, float) and math.isfinite(values[name]), "Invalid MET variable")
        return {"forecast_samples": len(times), "updated_at": meta["updated_at"], "first_valid_utc": times[0]["time"], "last_valid_utc": times[-1]["time"], "units": meta["units"], "station_observation": False}
    if kind == "eonet":
        require(isinstance(data.get("events"), list), "Invalid EONET event response")
        return {"curated_events": len(data["events"]), "complete_incident_register": False}
    if kind == "effis-perimeters":
        require(data.get("type") == "FeatureCollection" and isinstance(data.get("features"), list), "Invalid EFFIS perimeters")
        require(len(data["features"]) < 500, "Perimeter query may be truncated")
        matched = data.get("numberMatched")
        require(matched == len(data["features"]) if data["features"] else matched in (None, 0), "Incomplete perimeter query")
        require(all(f.get("geometry", {}).get("type") in ("Polygon", "MultiPolygon") for f in data["features"]), "Nonpolygon burned area")
        return {"features": len(data["features"]), "bbox_includes_neighbors": True, "confirmed_active_incidents": False}
    if kind == "effis-weekly":
        require(isinstance(data.get("banfweekly"), (list, dict)) and isinstance(data.get("banfcumulative"), (list, dict)), "Unexpected EFFIS weekly schema")
        return {"keys": sorted(data), "product": "weekly mapped burned area / fire statistics", "same_as_firms_detections": False}
    if kind == "effis-thermal":
        require(all(isinstance(data.get(k), list) and len(data[k]) == 52 for k in ("taweekly", "tacumulative")), "Unexpected thermal aggregate schema")
        require(all(row.get("iso3") == "MKD" and all(key in row for key in ("ta_viirs_suomi_count", "ta_viirs_noaa_count", "ta_modis_count")) for row in data["taweekly"]), "Thermal sensor fields missing")
        return {"weekly_rows": 52, "cumulative_rows": 52, "scientific_harmonization": False}
    if kind == "effis-annual":
        require(isinstance(data, (dict, list)) and bool(data), "Empty EFFIS annual response")
        return {"root_type": type(data).__name__, "product": "annual estimates by country", "reconcile_with_weekly_before_comparison": True}
    raise ValueError("Unknown source kind")


def fetch(name, url, kind, limit=4_000_000):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=30) as response:
        require(response.status == 200, "Non-success response")
        require(urllib.parse.urlsplit(response.url).scheme == "https", "Unexpected non-HTTPS redirect")
        raw = response.read(limit + 1)
        require(len(raw) <= limit, "Source exceeds bounded download")
        headers = {k: response.headers[k] for k in ("Content-Type", "Date", "Last-Modified", "Expires", "ETag") if response.headers.get(k)}
        final_url = response.url
    check = validate(kind, raw)
    path = DEST / name
    path.write_bytes(raw)
    return {"path": str(path.relative_to(ROOT)), "source_url": url, "final_url": final_url, "kind": kind, "retrieved_utc": datetime.now(timezone.utc).isoformat(), "http_status": 200, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "headers": headers, "validation": check}


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    manifest = {"created_utc": datetime.now(timezone.utc).isoformat(), "purpose": "Bounded additional-source access/contract proofs; no website, scheduled service or incident validation", "assets": [], "failures": []}
    specs = [
        ("cams-europe-skopje-48h.json", "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=41.9981&longitude=21.4254&hourly=pm10,pm2_5,carbon_monoxide,european_aqi&domains=cams_europe&forecast_days=2&timezone=UTC", "air-quality"),
        ("met-norway-skopje.json", "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=41.9981&lon=21.4254", "met"),
        ("eonet-mk-2024.json", "https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=all&start=2024-01-01&end=2024-12-31&bbox=20.4,42.5,23.1,40.8&limit=100", "eonet"),
        ("effis-weekly-mkd-2026.json", "https://api2.effis.emergency.copernicus.eu/statistics/v2/effis/weekly?country=MKD&year=2026", "effis-weekly"),
        ("effis-annual-mkd.json", "https://api2.effis.emergency.copernicus.eu/statistics/v2/effis/estimatesbycountry?country=MKD", "effis-annual"),
        ("effis-thermal-weekly-mkd-2026.json", "https://api2.effis.emergency.copernicus.eu/statistics/v2/ta/weekly?country=MKD&year=2026", "effis-thermal"),
        ("geonames-mk.zip", "https://download.geonames.org/export/dump/MK.zip", "geonames"),
        ("gibs-epsg3857-capabilities.xml", "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml", "gibs-capabilities"),
        ("gibs-mariovo-2024-09-02-z9-y191-x286.jpg", "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2024-09-02/GoogleMapsCompatible_Level9/9/191/286.jpg", "jpeg"),
    ]
    for suffix, layer in (("2024", "modis.ba.poly.2024"), ("recent-week", "modis.ba.poly.week")):
        query = urllib.parse.urlencode({"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": "ms:" + layer, "count": 500, "srsName": "EPSG:4326", "bbox": "40.8,20.4,42.5,23.1,EPSG:4326", "outputFormat": "geojson"})
        specs.append(("effis-mk-region-burned-areas-" + suffix + ".geojson", "https://maps.effis.emergency.copernicus.eu/effis?" + query, "effis-perimeters"))
    for level in ("ADM0", "ADM1"):
        specs.append(("geoboundaries-mkd-" + level.lower() + "-metadata.json", "https://www.geoboundaries.org/api/current/gbOpen/MKD/" + level + "/", "boundary-meta-" + level))
    for name, url, kind in specs:
        try:
            record = fetch(name, url, kind, 20_000_000 if kind == "gibs-capabilities" else 4_000_000)
            manifest["assets"].append(record)
            if kind.startswith("boundary-meta"):
                data = json.loads((ROOT / record["path"]).read_bytes())
                shape = fetch(name.replace("-metadata.json", ".geojson"), data["gjDownloadURL"], "boundary")
                require(shape["validation"]["features"] == record["validation"]["expected_features"], "Boundary count mismatch")
                manifest["assets"].append(shape)
            print(name, "verified", flush=True)
        except Exception as error:
            # This is an experiment report, not a production fallback.
            manifest["failures"].append({"name": name, "source_url": url, "error_type": type(error).__name__, "error": str(error)})
            print(name, "FAILED", type(error).__name__, flush=True)
        (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return 1 if manifest["failures"] else 0


def verify_saved():
    manifest = json.loads((DEST / "manifest.json").read_text())
    for asset in manifest["assets"]:
        raw = (ROOT / asset["path"]).read_bytes()
        require(hashlib.sha256(raw).hexdigest() == asset["sha256"], "Hash mismatch: " + asset["path"])
        require(validate(asset["kind"], raw) == asset["validation"], "Contract drift: " + asset["path"])
    for asset in manifest.get("derived", []):
        require(hashlib.sha256((ROOT / asset["path"]).read_bytes()).hexdigest() == asset["sha256"], "Derived proof hash mismatch")
    national_path = DEST / "mkffis-research-manifest.json"
    national = json.loads(national_path.read_text())["assets"] if national_path.exists() else []
    for asset in national:
        require(hashlib.sha256((ROOT / asset["path"]).read_bytes()).hexdigest() == asset["sha256"], "National research hash mismatch")
    print("Verified", len(manifest["assets"]), "saved source assets and", len(national), "national research hashes; recorded failures:", len(manifest["failures"]))


def self_test():
    shape = {"type": "FeatureCollection", "features": [{"geometry": {"type": "Polygon", "coordinates": [[[21, 41], [22, 41], [22, 42], [21, 41]]]}}]}
    assert boundary(shape)["features"] == 1
    assert validate("effis-perimeters", b'{"type":"FeatureCollection","features":[]}')["features"] == 0
    try:
        validate("effis-perimeters", b'{"type":"FeatureCollection","features":[],"numberMatched":1}')
    except ValueError:
        pass
    else:
        raise AssertionError("Incomplete perimeter query accepted")
    row = ["1", "Example", "Example", "", "41.5", "21.5", "P", "PPL", "MK", "", "", "", "", "", "0", "", "", "Europe/Skopje", "2026-11-14"]
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("MK.txt", "\t".join(row) + "\n")
    assert validate("geonames", buffer.getvalue())["populated_places"] == 1
    from datetime import timedelta
    aq = {"utc_offset_seconds": 0, "hourly": {"time": [(datetime(2026, 11, 14) + timedelta(hours=i)).isoformat(timespec="minutes") for i in range(48)]}, "hourly_units": {"pm10": "μg/m³", "pm2_5": "μg/m³", "carbon_monoxide": "μg/m³", "european_aqi": "EAQI"}}
    aq["hourly"].update({key: [0.] * 48 for key in aq["hourly_units"]})
    assert validate("air-quality", json.dumps(aq).encode())["hourly_samples"] == 48
    aq["hourly_units"]["pm2_5"] = "mg/m³"
    try:
        validate("air-quality", json.dumps(aq).encode())
    except ValueError:
        pass
    else:
        raise AssertionError("Wrong particulate units accepted")
    for kind, raw in (("boundary", b'{"type":"FeatureCollection","features":[]}'), ("jpeg", b'not an image'), ("effis-weekly", b'{"error":"not data"}'), ("air-quality", b'{"utc_offset_seconds":3600}'), ("eonet", b'{"events":null}')):
        try:
            validate(kind, raw)
        except ValueError:
            continue
        raise AssertionError("Invalid input accepted: " + kind)
    print("Additional-source validation self-test passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--verify-saved", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    if args.verify_saved:
        verify_saved()
    if args.fetch:
        raise SystemExit(main())
