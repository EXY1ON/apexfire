"""Fetch daily weather 2000-2025 over North Macedonia from NASA POWER (MERRA-2 reanalysis), for the archive.

One request per MERRA-2 grid node (0.5 deg lat x 0.625 deg lon, 5 x 6 = 30 nodes covering the country with a margin),
each covering the whole period. Raw responses and a metadata file with their hashes go to Data/readiness/weather/power-daily/;
tools/export_web_data.py turns them into one compact file per year for the website. No key is needed.

    python3 tools/fetch_power_weather.py             # fetch (skips nodes already saved)
    python3 tools/fetch_power_weather.py --self-test
"""

import argparse
import hashlib
import json
import math
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "Data" / "readiness" / "weather" / "power-daily"
LATS = [40.5 + 0.5 * i for i in range(5)]       # 40.5 .. 42.5, MERRA-2 node latitudes
LONS = [20.0 + 0.625 * j for j in range(6)]     # 20.0 .. 23.125, MERRA-2 node longitudes
START, END = "20000101", "20251231"
PARAMS = ("U10M", "V10M", "WS10M", "WS10M_MAX", "T2M_MAX", "RH2M", "PRECTOTCORR")
API = "https://power.larc.nasa.gov/api/temporal/daily/point"
CREDIT = ("NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth Science Applied Science Program; "
          "MERRA-2 reanalysis by NASA GMAO")


def grid():
    return [(lat, lon) for lat in LATS for lon in LONS]


def request_url(lat, lon):
    q = {"parameters": ",".join(PARAMS), "community": "AG", "latitude": f"{lat:g}", "longitude": f"{lon:g}",
         "start": START, "end": END, "format": "JSON", "time-standard": "UTC"}
    return f"{API}?{urllib.parse.urlencode(q, safe=',')}"


def n_days():
    return (date(int(END[:4]), int(END[4:6]), int(END[6:])) - date(int(START[:4]), int(START[4:6]), int(START[6:]))).days + 1


def validate(body):
    """Every parameter has one value per day of the period (fill value allowed, nothing else missing) in plausible ranges."""
    p = body["properties"]["parameter"]
    fill = body["header"]["fill_value"]
    days = n_days()
    for k in PARAMS:
        if k not in p or len(p[k]) != days:
            raise ValueError(f"{k}: expected {days} daily values")
        vals = [v for v in p[k].values() if v != fill]
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in vals):
            raise ValueError(f"{k}: non-numeric value")
        lo, hi = {"T2M_MAX": (-40, 50), "RH2M": (0, 100.5), "PRECTOTCORR": (0, 500)}.get(k, (-60, 80))
        if vals and (min(vals) < lo or max(vals) > hi):
            raise ValueError(f"{k}: value out of range")
    if list(p[PARAMS[0]])[0] != START or list(p[PARAMS[0]])[-1] != END:
        raise ValueError("Unexpected period")
    return days


def fetch(lat, lon):
    with urllib.request.urlopen(urllib.request.Request(request_url(lat, lon), headers={"User-Agent": "ApexFire-prototype"}), timeout=180) as r:
        raw = r.read()
    validate(json.loads(raw))
    return raw


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    files = []
    for lat, lon in grid():
        path = DEST / f"power-daily-{lat:g}_{lon:g}.json"
        if not path.exists():
            for attempt in range(2):  # two strikes, then stop and report
                try:
                    path.write_bytes(fetch(lat, lon))
                    break
                except Exception as e:  # noqa: BLE001 - reported, not swallowed
                    if attempt:
                        raise SystemExit(f"Failed at {lat},{lon}: {e}")
                    time.sleep(5)
            time.sleep(1)  # be gentle with the free service
        raw = path.read_bytes()
        validate(json.loads(raw))
        files.append({"lat": lat, "lon": lon, "path": str(path.relative_to(ROOT)), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                      "source_url": request_url(lat, lon)})
        print(f"{lat:g},{lon:g} ok")
    meta = {"schema": "firewatch.readiness.power-daily.v1", "retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "provider": "NASA POWER Daily API", "source": "MERRA-2 (POWER native resolution, 0.5 x 0.625 deg)", "period": [START, END],
            "parameters": PARAMS, "grid": {"lats": LATS, "lons": LONS}, "credit": CREDIT,
            "notes": "Daily means (wind components, speed, humidity), daily maximum (temperature, wind speed) and daily total (precipitation, bias-corrected), UTC days. "
                     "Reanalysis about 50 km apart: regional weather, not station or valley-scale observations.",
            "files": files}
    (DEST / "power-daily.metadata.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"{len(files)} nodes, metadata written")


def self_test():
    assert len(grid()) == 30 and LATS[0] < 40.85 and LATS[-1] > 42.37 and LONS[0] < 20.45 and LONS[-1] > 23.04, "grid must cover the country"
    assert n_days() == 9497
    day0 = date(2000, 1, 1).toordinal()
    keys = [date.fromordinal(day0 + i).strftime("%Y%m%d") for i in range(n_days())]
    good = {"header": {"fill_value": -999.0}, "properties": {"parameter": {k: {d: 1.0 for d in keys} for k in PARAMS}}}
    assert validate(good) == 9497
    bad = json.loads(json.dumps(good)); bad["properties"]["parameter"]["RH2M"][keys[5]] = 140.0
    try:
        validate(bad)
        raise AssertionError("out-of-range humidity accepted")
    except ValueError:
        pass
    print("self-test ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    (self_test if ap.parse_args().self_test else main)()
