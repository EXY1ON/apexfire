"""Fetch the official perimeter and ERA5 weather for each fire story listed in tools/fire_stories.json.

Per story, Data/readiness/stories/<id>/ receives the EFFIS burned-area feature (one GetFeature request per EFFIS year,
country bounding box, the story's feature picked by id), an ERA5 hourly response from the Open-Meteo archive API at the
perimeter centroid (61 days before the window start to the longest possible window end), and a metadata file with
retrieval time, URLs and sha256 per file. tools/export_web_data.py turns these into web/public/data/stories/fires/.
No key is needed. Saved stories are skipped.

    python3 tools/fetch_fire_stories.py
    python3 tools/fetch_fire_stories.py --self-test
"""

import argparse
import hashlib
import json
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIST = ROOT / "tools" / "fire_stories.json"
DEST = ROOT / "Data" / "readiness" / "stories"
EFFIS = "https://maps.effis.emergency.copernicus.eu/effis"
METEO = "https://archive-api.open-meteo.com/v1/archive"
HOURLY = ("temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "precipitation")
UA = {"User-Agent": "ApexFire-prototype"}
SPINUP_DAYS = 61  # 60 noon days before the window, plus one day so the first 24 h rain total is complete


def effis_url(year):
    q = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": f"ms:modis.ba.poly.{year}",
         "srsName": "EPSG:4326", "bbox": "40.85,20.45,42.37,23.04,EPSG:4326", "outputFormat": "geojson"}
    return f"{EFFIS}?{urllib.parse.urlencode(q, safe=':,')}"


def weather_url(lat, lon, start, end):
    q = {"latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "start_date": start, "end_date": end, "hourly": ",".join(HOURLY),
         "models": "era5", "timezone": "UTC", "wind_speed_unit": "kmh"}
    return f"{METEO}?{urllib.parse.urlencode(q, safe=',')}"


def centroid(geometry):
    """Area-weighted planar centroid (lon, lat) of a Polygon/MultiPolygon; holes subtract. Fine at fire scale."""
    polys = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    a_sum = x_sum = y_sum = 0.0
    for rings in polys:
        for k, ring in enumerate(rings):
            a = cx = cy = 0.0
            for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
                c = x0 * y1 - x1 * y0
                a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
            a /= 2
            if a == 0:
                continue
            sign = 1 if k == 0 else -1  # exterior adds, holes subtract, whatever the winding
            a_sum += sign * abs(a); x_sum += sign * abs(a) * cx / (6 * a); y_sum += sign * abs(a) * cy / (6 * a)
    return x_sum / a_sum, y_sum / a_sum


def weather_span(firedate, defaults):
    start = date.fromisoformat(firedate[:10]) - timedelta(days=defaults["days_before"])
    end = min(start + timedelta(days=defaults["max_days"] - 1), datetime.now(timezone.utc).date() - timedelta(days=7))
    return (start - timedelta(days=SPINUP_DAYS)).isoformat(), end.isoformat()


def validate_weather(body, start, end):
    h = body["hourly"]
    hours = ((date.fromisoformat(end) - date.fromisoformat(start)).days + 1) * 24
    if h["time"][0] != f"{start}T00:00" or len(h["time"]) != hours:
        raise ValueError("Unexpected weather period")
    for k in HOURLY:
        vals = h[k]
        if len(vals) != hours or any(v is None for v in vals):
            raise ValueError(f"{k}: missing hourly values")
        lo, hi = {"temperature_2m": (-40, 50), "relative_humidity_2m": (0, 100.5), "wind_direction_10m": (0, 360),
                  "precipitation": (0, 200)}.get(k, (0, 250))
        if min(vals) < lo or max(vals) > hi:
            raise ValueError(f"{k}: value out of range")
    return hours


def get(url, timeout=120):
    for attempt in range(2):  # two strikes, then stop and report
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - reported, not swallowed
            if attempt:
                raise SystemExit(f"Failed: {url}: {e}")
            time.sleep(5)


def main():
    cfg = json.loads(LIST.read_text())
    years = {}
    for s in cfg["stories"]:
        out = DEST / s["id"]
        if (out / "metadata.json").exists():
            print(f"{s['id']}: saved, skipped")
            continue
        out.mkdir(parents=True, exist_ok=True)
        year = s["effis_year"]
        if year not in years:
            raw = get(effis_url(year))
            years[year] = (raw, datetime.now(timezone.utc).isoformat(timespec="seconds"))
            time.sleep(1)
        raw, effis_time = years[year]
        found = [f for f in json.loads(raw)["features"] if str(f["properties"]["id"]) == s["effis_id"]]
        if len(found) != 1 or found[0]["properties"]["COUNTRY"] != "MK":
            raise SystemExit(f"{s['id']}: EFFIS {year} feature {s['effis_id']} not found once in MK")
        feat = json.dumps(found[0], ensure_ascii=False).encode()
        (out / "effis-feature.geojson").write_bytes(feat)
        lon, lat = centroid(found[0]["geometry"])
        start, end = weather_span(found[0]["properties"]["FIREDATE"], cfg["defaults"])
        wurl = weather_url(lat, lon, start, end)
        wraw = get(wurl)
        validate_weather(json.loads(wraw), start, end)
        (out / "era5-hourly.json").write_bytes(wraw)
        meta = {"schema": "firewatch.readiness.story.v1", "story": s["id"], "centroid": [round(lat, 5), round(lon, 5)],
                "files": [
                    {"path": "effis-feature.geojson", "source": "EFFIS burned area WFS", "url": effis_url(year), "retrieved_utc": effis_time,
                     "response_sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(feat), "sha256": hashlib.sha256(feat).hexdigest(),
                     "note": "Country-bbox GetFeature response; only the feature with this id is kept."},
                    {"path": "era5-hourly.json", "source": "ERA5 reanalysis via Open-Meteo archive API", "url": wurl,
                     "retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "period": [start, end],
                     "bytes": len(wraw), "sha256": hashlib.sha256(wraw).hexdigest()}],
                "credits": "EFFIS, European Commission Joint Research Centre (CC BY 4.0); Open-Meteo (CC BY 4.0), ERA5 by ECMWF / Copernicus Climate Change Service."}
        (out / "metadata.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False) + "\n")
        print(f"{s['id']}: EFFIS {s['effis_id']} {found[0]['properties']['AREA_HA']} ha, weather {start}..{end}")
        time.sleep(1)  # be gentle with the free services


def self_test():
    sq = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}
    x, y = centroid(sq)
    assert abs(x - 7 / 6) < 1e-9 and abs(y - 7 / 6) < 1e-9, (x, y)  # 2x2 square minus its lower-left unit square
    mp = {"type": "MultiPolygon", "coordinates": [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]]]}
    assert centroid(mp) == (1.5, 0.5)
    start, end = weather_span("2024-07-14 20:14:00", {"days_before": 2, "max_days": 21})
    assert (start, end) == ("2024-05-12", "2024-08-01"), (start, end)
    body = {"hourly": {"time": [f"2024-05-13T{h:02d}:00" for h in range(24)], **{k: [1.0] * 24 for k in HOURLY}}}
    assert validate_weather(body, "2024-05-13", "2024-05-13") == 24
    body["hourly"]["relative_humidity_2m"][3] = None
    try:
        validate_weather(body, "2024-05-13", "2024-05-13")
        raise AssertionError("missing humidity accepted")
    except ValueError:
        pass
    ids = [s["id"] for s in json.loads(LIST.read_text())["stories"]]
    assert len(ids) == len(set(ids)) and 6 <= len(ids) <= 8
    assert "typeNames=ms:modis.ba.poly.2024&" in effis_url(2024)
    print("self-test ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    (self_test if ap.parse_args().self_test else main)()
