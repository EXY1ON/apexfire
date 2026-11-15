"""Fetch one dated 10 m wind forecast grid over North Macedonia from Open-Meteo (explicit ECMWF IFS model).

A single bounded request (77 points, 48 hourly steps); the response and its metadata are saved under
Data/readiness/weather/ and exported to the website by tools/export_web_data.py. No key is used.

    python3 tools/fetch_wind_grid.py             # fetch and save
    python3 tools/fetch_wind_grid.py --self-test
"""

import argparse
import hashlib
import json
import math
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "Data" / "readiness" / "weather"
LATS = [40.875 + 0.25 * i for i in range(7)]   # 40.875 .. 42.375
LONS = [20.5 + 0.25 * j for j in range(11)]    # 20.5 .. 23.0
MODEL = "ecmwf_ifs"
HOURS = 48
VARS = ("wind_speed_10m", "wind_direction_10m", "wind_gusts_10m")
MAX_BYTES = 2_000_000


def grid():
    return [(lat, lon) for lat in LATS for lon in LONS]


def request_url(points):
    query = {
        "latitude": ",".join(f"{lat:g}" for lat, _ in points),
        "longitude": ",".join(f"{lon:g}" for _, lon in points),
        "hourly": ",".join(VARS), "models": MODEL, "wind_speed_unit": "ms", "timezone": "UTC",
        "forecast_hours": str(HOURS),
    }
    return "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(query, safe=",")


def validate(body, points):
    if not isinstance(body, list) or len(body) != len(points):
        raise ValueError("Expected one response object per grid point")
    times = body[0]["hourly"]["time"]
    if len(times) != HOURS:
        raise ValueError(f"Expected {HOURS} hourly steps, got {len(times)}")
    for item in body:
        h = item["hourly"]
        if h["time"] != times or item["hourly_units"]["wind_speed_10m"] != "m/s":
            raise ValueError("Inconsistent times or units across grid points")
        for v in VARS:
            values = h[v]
            if len(values) != HOURS or any(x is None or not math.isfinite(x) for x in values):
                raise ValueError(f"Missing or non-finite {v}")
        if not all(0 <= d <= 360 for d in h["wind_direction_10m"]) or min(h["wind_speed_10m"]) < 0:
            raise ValueError("Wind direction/speed out of range")
    return times


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--self-test", action="store_true")
    if parser.parse_args().self_test:
        pts = grid()
        assert len(pts) == 77 and pts[0] == (40.875, 20.5) and pts[-1] == (42.375, 23.0)
        assert "models=ecmwf_ifs" in request_url(pts) and "forecast_hours=48" in request_url(pts)
        fake = [{"hourly": {"time": [f"t{i}" for i in range(HOURS)], **{v: [1.0] * HOURS for v in VARS}},
                 "hourly_units": {"wind_speed_10m": "m/s"}} for _ in pts]
        assert len(validate(fake, pts)) == HOURS
        fake[3]["hourly"]["wind_gusts_10m"][5] = None
        try:
            validate(fake, pts)
        except ValueError:
            return print("self-test passed")
        raise AssertionError("accepted a null value")
    pts = grid()
    url = request_url(pts)
    req = urllib.request.Request(url, headers={"User-Agent": "ApexFire-readiness/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as response:
        raw = response.read(MAX_BYTES + 1)
        status, ctype = response.status, response.headers.get("Content-Type", "")
    if len(raw) > MAX_BYTES or "json" not in ctype:
        raise ValueError("Unexpected response size or content type")
    body = json.loads(raw)
    times = validate(body, pts)
    retrieved = datetime.now(timezone.utc).isoformat()
    stamp = retrieved[:10]
    data_path = DEST / f"wind-grid-mk-{stamp}.json"
    data_path.write_bytes(raw)
    (DEST / f"wind-grid-mk-{stamp}.metadata.json").write_text(json.dumps({
        "path": str(data_path.relative_to(ROOT)), "source_url": url, "retrieved_utc": retrieved, "http_status": status,
        "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "model_requested": MODEL, "model_run_time": None,
        "grid": {"lats": LATS, "lons": LONS, "spacing_deg": 0.25, "points": len(pts)},
        "first_valid_utc": times[0], "last_valid_utc": times[-1], "hours": len(times),
        "units": {"wind_speed_10m": "m/s", "wind_direction_10m": "degrees FROM", "wind_gusts_10m": "m/s"},
        "notes": "Model forecast at snapped ~9 km grid points; requested coordinates differ from returned ones. Not station observations.",
    }, indent=2))
    print(f"saved {len(pts)} points x {len(times)} h ({times[0]} .. {times[-1]}) to {data_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
