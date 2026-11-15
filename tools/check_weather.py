"""Bounded Open-Meteo readiness proof; no accounts, tokens or dependencies.

Use --fetch for three public requests; --verify-saved checks retained evidence.
"""

import argparse
import copy
import csv
import hashlib
import io
import json
import math
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "Data" / "readiness" / "weather"
UNITS = {
    "temperature_2m": "°C",
    "relative_humidity_2m": "%",
    "precipitation": "mm",
    "wind_speed_10m": "m/s",
    "wind_direction_10m": "°",
    "wind_gusts_10m": "m/s",
}
CASES = (
    ("skopje-forecast-icon-global", 41.9981, 21.4254, "icon_global", None),
    ("mariovo-forecast-icon-global", 41.27, 21.65, "icon_global", None),
    ("event-12376-era5-2017-07-23_2017-08-15", 41.8, 21.1, "era5", ("2017-07-23", "2017-08-15")),
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def utc_time(value):
    parsed = datetime.fromisoformat(value)
    require(parsed.tzinfo is None, "Expected provider's offset-free ISO time under explicit UTC metadata")
    return parsed.replace(tzinfo=timezone.utc)


def validate(data, latitude, longitude, dates=None, retrieved=None):
    require(isinstance(data, dict) and not data.get("error"), "Provider returned an error or invalid document")
    require(data.get("utc_offset_seconds") == 0 and data.get("timezone") in ("GMT", "UTC", "Etc/UTC"), "UTC metadata mismatch")
    for name, expected in (("latitude", latitude), ("longitude", longitude)):
        value = data.get(name)
        require(type(value) in (float, int) and math.isfinite(value) and abs(value - expected) <= .5, "Unexpected model-grid coordinate")
    hourly, units = data.get("hourly", {}), data.get("hourly_units", {})
    require(units.get("time") == "iso8601", "Unexpected time unit")
    times = [utc_time(t) for t in hourly.get("time", [])]
    count = 24 * ((datetime.fromisoformat(dates[1]) - datetime.fromisoformat(dates[0])).days + 1) if dates else 72
    require(len(times) == count, "Unexpected hourly sample count")
    require(all(b - a == timedelta(hours=1) for a, b in zip(times, times[1:])), "Missing, duplicated or unsorted hour")
    if dates:
        require(times[0].isoformat().startswith(dates[0] + "T00:00") and times[-1].isoformat().startswith(dates[1] + "T23:00"), "Historical date bounds mismatch")
    for name, expected in UNITS.items():
        require(units.get(name) == expected, "Unexpected unit for " + name)
        values = hourly.get(name, [])
        require(len(values) == count, "Array length mismatch for " + name)
        require(all(type(v) in (int, float) and math.isfinite(v) for v in values), "Missing or invalid hourly " + name)
        low, high = ((-100, 70) if name == "temperature_2m" else (0, 100) if name == "relative_humidity_2m" else (0, 360) if name == "wind_direction_10m" else (0, 1000))
        require(all(low <= v <= high for v in values), "Out-of-range hourly " + name)
    if not dates:
        current, current_units = data.get("current", {}), data.get("current_units", {})
        stamp = utc_time(current.get("time", ""))
        require(retrieved is not None and -1800 <= (retrieved - stamp).total_seconds() <= 7200, "Stale or future current-model time")
        require(times[0].date() == retrieved.date(), "Forecast starts on an unexpected UTC day")
        for name, expected in UNITS.items():
            value = current.get(name)
            require(current_units.get(name) == expected and type(value) in (int, float) and math.isfinite(value), "Invalid current value/unit for " + name)
    return {"hourly_samples": count, "first_hour_utc": times[0].isoformat(), "last_hour_utc": times[-1].isoformat(), "null_values": 0, "current_time_utc": utc_time(data["current"]["time"]).isoformat() if not dates else None}


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".part")
    partial.write_bytes(content)
    partial.replace(path)


def fetch_case(name, lat, lon, model, dates):
    params = {"latitude": lat, "longitude": lon, "hourly": ",".join(UNITS), "wind_speed_unit": "ms", "temperature_unit": "celsius", "precipitation_unit": "mm", "timezone": "UTC", "models": model}
    if dates:
        endpoint = "https://archive-api.open-meteo.com/v1/archive"
        params.update(start_date=dates[0], end_date=dates[1])
    else:
        endpoint = "https://api.open-meteo.com/v1/forecast"
        params.update(current=",".join(UNITS), forecast_days=3)
    url = endpoint + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "ApexFire-readiness/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        require(response.status == 200, "Unexpected HTTP status")
        require(urllib.parse.urlsplit(response.url).hostname == urllib.parse.urlsplit(endpoint).hostname, "Unexpected redirect host")
        raw = response.read(2_000_001)
        require(len(raw) <= 2_000_000, "Response exceeded bounded download limit")
        headers = {key: response.headers[key] for key in ("Date", "Content-Type", "Last-Modified", "ETag") if response.headers.get(key)}
    retrieved = datetime.now(timezone.utc)
    raw_path = DEST / (name + ".json")
    # Retain the exact response even when validation fails, for diagnosis.
    atomic_write(raw_path, raw)
    data = json.loads(raw)
    summary = validate(data, lat, lon, dates, retrieved)
    record = {"path": str(raw_path.relative_to(ROOT)), "source_url": url, "retrieved_utc": retrieved.isoformat(), "http_status": 200, "response_headers": headers, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "model_requested": model, "model_identity_echoed": False, "model_run_time": None, "requested_coordinate_lat_lon": [lat, lon], "returned_coordinate_lat_lon": [data["latitude"], data["longitude"]], "returned_elevation_m": data.get("elevation"), "timezone": data["timezone"], "utc_offset_seconds": data["utc_offset_seconds"], "units": data["hourly_units"], "product": "ERA5 reanalysis" if dates else "ICON Global model current/forecast", "validation": summary}
    if not dates:
        record["current_interval_seconds"] = data["current"].get("interval")
        record["current_units"] = data["current_units"]
    if dates:
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer)
        writer.writerow(["time_utc", *UNITS])
        for index, stamp in enumerate(data["hourly"]["time"]):
            writer.writerow([utc_time(stamp).isoformat(), *(data["hourly"][key][index] for key in UNITS)])
        csv_path = DEST / (name + ".csv")
        csv_bytes = buffer.getvalue().encode()
        atomic_write(csv_path, csv_bytes)
        record["csv"] = {"path": str(csv_path.relative_to(ROOT)), "sha256": hashlib.sha256(csv_bytes).hexdigest(), "bytes": len(csv_bytes), "transformation": "Hourly columns unchanged; ISO timestamps explicitly marked +00:00"}
    atomic_write(DEST / (name + ".metadata.json"), (json.dumps(record, indent=2) + "\n").encode())
    return record


def self_test():
    times = [(datetime(2017, 7, 23) + timedelta(hours=i)).isoformat(timespec="minutes") for i in range(24)]
    data = {"latitude": 41.8, "longitude": 21.1, "timezone": "GMT", "utc_offset_seconds": 0, "hourly_units": {"time": "iso8601", **UNITS}, "hourly": {"time": times, **{key: [10.] * 24 for key in UNITS}}}
    assert validate(data, 41.8, 21.1, ("2017-07-23", "2017-07-23"))["hourly_samples"] == 24
    for kind in ("units", "gap", "null", "humidity", "coordinate", "timezone"):
        bad = copy.deepcopy(data)
        if kind == "units": bad["hourly_units"]["wind_speed_10m"] = "km/h"
        if kind == "gap": bad["hourly"]["time"][1] = bad["hourly"]["time"][0]
        if kind == "null": bad["hourly"]["precipitation"][1] = None
        if kind == "humidity": bad["hourly"]["relative_humidity_2m"][1] = 101
        if kind == "coordinate": bad["latitude"] = 5
        if kind == "timezone": bad["utc_offset_seconds"] = 3600
        try:
            validate(bad, 41.8, 21.1, ("2017-07-23", "2017-07-23"))
        except ValueError:
            continue
        raise AssertionError("Bad " + kind + " was accepted")
    forecast = copy.deepcopy(data)
    forecast["hourly"] = {"time": [(datetime(2017, 7, 23) + timedelta(hours=i)).isoformat(timespec="minutes") for i in range(72)], **{key: [10.] * 72 for key in UNITS}}
    forecast["current_units"] = UNITS
    forecast["current"] = {"time": "2017-07-23T12:00", **{key: 10. for key in UNITS}}
    now = datetime(2017, 7, 23, 12, 10, tzinfo=timezone.utc)
    assert validate(forecast, 41.8, 21.1, retrieved=now)["hourly_samples"] == 72
    try:
        validate(forecast, 41.8, 21.1, retrieved=now + timedelta(hours=3))
    except ValueError:
        pass
    else:
        raise AssertionError("Stale current weather was accepted")
    print("Self-check passed: valid UTC data; units, gaps, nulls, ranges, coordinates, timezone and stale-current errors rejected")


def verify_saved():
    for name, lat, lon, model, dates in CASES:
        metadata = json.loads((DEST / (name + ".metadata.json")).read_text())
        raw = (DEST / (name + ".json")).read_bytes()
        require(hashlib.sha256(raw).hexdigest() == metadata["sha256"], "Saved response hash mismatch")
        summary = validate(json.loads(raw), lat, lon, dates, datetime.fromisoformat(metadata["retrieved_utc"]))
        if dates:
            csv_bytes = (ROOT / metadata["csv"]["path"]).read_bytes()
            require(hashlib.sha256(csv_bytes).hexdigest() == metadata["csv"]["sha256"], "Saved CSV hash mismatch")
            rows = list(csv.DictReader(io.StringIO(csv_bytes.decode())))
            require(len(rows) == summary["hourly_samples"], "Saved CSV row mismatch")
        print(name, summary["hourly_samples"], "hours verified")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    operations = parser.add_mutually_exclusive_group(required=True)
    for operation in ("--fetch", "--self-test", "--verify-saved"):
        operations.add_argument(operation, dest="operation", action="store_const", const=operation)
    args = parser.parse_args()
    if args.operation == "--self-test": self_test()
    elif args.operation == "--verify-saved": verify_saved()
    else:
        records = []
        for case in CASES:
            records.append(fetch_case(*case))
            print(case[0], records[-1]["validation"]["hourly_samples"], "hours fetched and validated", flush=True)
        manifest = {"schema": "firewatch-weather-proof-1", "retrieved_utc": datetime.now(timezone.utc).isoformat(), "attribution": "Weather data: Open-Meteo; DWD ICON Global forecasts and Copernicus/ECMWF ERA5 reanalysis. CC BY 4.0; see provider terms.", "records": records}
        atomic_write(DEST / "manifest.json", (json.dumps(manifest, indent=2) + "\n").encode())


if __name__ == "__main__":
    main()
