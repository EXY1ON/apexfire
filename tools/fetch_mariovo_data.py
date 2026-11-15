"""Fetch bounded public satellite data for the September 2024 Mariovo fire."""

import hashlib
import json
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import fetch_case_data
from fetch_case_data import get_json, save_crop


ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "Data" / "case-studies" / "mariovo-2024"
BBOX = (21.565, 41.198, 21.735, 41.345)
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
REFERENCE_URL = "https://worldfires.org/api/v1/fires/mariovo-2024-09/geometry"
SOURCES = [
    ("hls2-s30", "HLS.S30.T34TEL.2024236T093031.v2.0", "2024-08-23", "hls", ["B02", "B03", "B04", "B8A", "B12", "Fmask"]),
    ("hls2-s30", "HLS.S30.T34TEL.2024246T093031.v2.0", "2024-09-02", "hls", ["B02", "B03", "B04", "B8A", "B12", "Fmask"]),
    ("hls2-s30", "HLS.S30.T34TEL.2024256T093031.v2.0", "2024-09-12", "hls", ["B02", "B03", "B04", "B8A", "B12", "Fmask"]),
    ("modis-64A1-061", "MCD64A1.A2024245.h19v04.061.2024317180718", "2024-09", "burned-area", ["Burn_Date", "QA"]),
    ("nasadem", "NASADEM_HGT_n41e021", "nasadem", "terrain", ["elevation"]),
    ("esa-worldcover", "ESA_WorldCover_10m_2021_v200_N39E021", "worldcover-2021", "land-cover", ["map"]),
]


def main():
    assert fetch_case_data._tokenized_href("https://data.example.test/asset.tif", "se=token") == "https://data.example.test/asset.tif?se=token"
    fetch_case_data.DEST = DEST
    fetch_case_data.BBOX = BBOX
    for folder in ("reference", "hls", "burned-area", "terrain", "land-cover", "metadata"):
        (DEST / folder).mkdir(parents=True, exist_ok=True)

    reference = get_json(REFERENCE_URL)
    assert reference["type"] == "Feature" and reference["geometry"]["type"] == "MultiPolygon"
    assert reference["properties"]["source"] == "EFFIS / Copernicus EMS (CC BY 4.0)"
    reference_path = DEST / "reference" / "effis-mariovo-2024-09.geojson"
    reference_path.write_text(json.dumps(reference, indent=2) + "\n")
    manifest = {
        "retrieved_utc": datetime.now(timezone.utc).isoformat(),
        "case": "Mariovo / Prilep September 2024",
        "reported_burned_area_ha": 10265,
        "bbox_wgs84_crop": BBOX,
        "reference": {
            "path": str(reference_path.relative_to(ROOT)),
            "source_url": REFERENCE_URL,
            "attribution": reference["properties"]["source"],
            "bytes": reference_path.stat().st_size,
            "sha256": hashlib.sha256(reference_path.read_bytes()).hexdigest(),
        },
        "method": "Bounded native-grid COG crops via public STAC and HTTPS range reads. These crops are not complete source tiles.",
        "assets": [],
    }
    for collection, identifier, label, folder, bands in SOURCES:
        item = get_json(f"{STAC}/collections/{collection}/items/{identifier}")
        (DEST / "metadata" / f"{identifier}.json").write_text(json.dumps(item, indent=2) + "\n")
        for band in bands:
            filename = f"{label}-{band.lower()}.tif" if folder != "hls" else f"{label}-{band.lower()}.tif"
            print(f"Downloading {label} {band}", flush=True)
            manifest["assets"].append(save_crop(item, band, DEST / folder / filename))
            (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    weather_params = {
        "latitude": 41.27,
        "longitude": 21.65,
        "start_date": "2024-09-01",
        "end_date": "2024-09-07",
        "hourly": "wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,relative_humidity_2m,precipitation",
        "wind_speed_unit": "ms",
        "timezone": "UTC",
        "models": "ecmwf_ifs",
    }
    weather_url = "https://historical-forecast-api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(weather_params)
    weather = get_json(weather_url)
    assert len(weather.get("hourly", {}).get("time", [])) == 168
    weather_path = DEST / "weather" / "open-meteo-ecmwf-ifs-historical-forecast-2024-09-01_07.json"
    weather_record = {
        "provider": "Open-Meteo",
        "product": "Historical Forecast API",
        "model_requested": "ecmwf_ifs (ECMWF IFS HRES 9 km)",
        "source_url": weather_url,
        "retrieved_utc": datetime.now(timezone.utc).isoformat(),
        "purpose": "Retrospective forecast-model context for the Mariovo event; not ground truth.",
        "data": weather,
    }
    weather_path.parent.mkdir(parents=True, exist_ok=True)
    weather_path.write_text(json.dumps(weather_record, indent=2) + "\n")
    manifest["weather"] = {
        "path": str(weather_path.relative_to(ROOT)),
        "source_url": weather_url,
        "provider": "Open-Meteo Historical Forecast API",
        "model_requested": weather_record["model_requested"],
        "hourly_samples": len(weather["hourly"]["time"]),
        "requested_coordinate_wgs84": [weather_params["latitude"], weather_params["longitude"]],
        "model_grid_coordinate_wgs84": [weather["latitude"], weather["longitude"]],
        "bytes": weather_path.stat().st_size,
        "sha256": hashlib.sha256(weather_path.read_bytes()).hexdigest(),
    }
    manifest["retrieved_utc"] = datetime.now(timezone.utc).isoformat()
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(asset["bytes"] for asset in manifest["assets"]) + manifest["reference"]["bytes"]
    print(f"Saved {len(manifest['assets'])} raster crops plus the reference perimeter; {total / 1e6:.2f} MB", flush=True)


if __name__ == "__main__":
    main()
