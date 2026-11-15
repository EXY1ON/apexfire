"""ApexFire scheduled ingestion: every 15 minutes, fetch NASA FIRMS near-real-time detections for North
Macedonia and its border, group them into fires and publish one validated snapshot to the Realtime Database.

The FIRMS MAP_KEY lives in Secret Manager (FIRMS_MAP_KEY) and never reaches the browser. A failed run only
updates /public/status, so the last good snapshot stays visible (marked stale by the client after 30 minutes).

Local check without the cloud:  ./venv/bin/python main.py --local /tmp/snapshot.json
"""

import csv
import io
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import firelib
import mkffis

HERE = Path(__file__).resolve().parent
BBOX = "20.4,40.8,23.1,42.5"
PRODUCTS = {"VIIRS_NOAA20_NRT": "viirs-jpss1", "VIIRS_NOAA21_NRT": "viirs-noaa21", "MODIS_NRT": "modis"}
WINDOW_DAYS = 7


def _load(name):
    return json.loads((HERE / "data" / name).read_text())


def inside(lon, lat, rings):
    """Ray casting over the country's polygon rings (holes respected by parity)."""
    hit = False
    for ring in rings:
        j = len(ring) - 1
        for i in range(len(ring)):
            (xi, yi), (xj, yj) = ring[i], ring[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
    return hit


def parse(text, product):
    if not text.startswith("latitude,longitude"):
        raise ValueError(f"{product}: response is not FIRMS CSV")
    out = []
    for i, r in enumerate(csv.DictReader(io.StringIO(text))):
        hhmm = r["acq_time"].zfill(4)
        if not hhmm.isdigit() or int(hhmm[:2]) > 23 or int(hhmm[2:]) > 59:
            raise ValueError(f"{product}: bad acq_time")
        lat, lon, frp = float(r["latitude"]), float(r["longitude"]), float(r["frp"])
        conf = int(r["confidence"]) if product.startswith("MODIS") else r["confidence"]
        out.append({"t": f"{r['acq_date']}T{hhmm[:2]}:{hhmm[2:]}Z", "lat": lat, "lon": lon, "frp": frp, "conf": conf,
                    "dn": r["daynight"], "ver": r["version"], "product": product, "sensor": PRODUCTS[product]})
    return out


def build_snapshot(fetch, now):
    """fetch(product, day_range, date) -> CSV text. Returns the public snapshot (same schema as current/recent.json)."""
    rings = [ring for poly in _load("boundary.json") for ring in poly]
    places = _load("places.json")
    start = now - timedelta(days=WINDOW_DAYS)
    dets, seen = [], set()
    for product in PRODUCTS:
        for first, days in ((start.date(), 5), ((start + timedelta(days=5)).date(), WINDOW_DAYS - 5 + 1)):
            for d in parse(fetch(product, days, first.isoformat()), product):
                key = (product, d["t"], d["lat"], d["lon"])
                if d["t"] >= start.strftime("%Y-%m-%dT%H:%MZ") and key not in seen:
                    seen.add(key)
                    d["id"] = f"{product}-{d['t']}-{d['lat']:.5f}-{d['lon']:.5f}"
                    d["inside"] = inside(d["lon"], d["lat"], rings)
                    dets.append(d)
    dets.sort(key=lambda d: d["t"])
    fires = [firelib.summarize(dets, g, places) for g in firelib.cluster(dets)]
    by_id = {d["id"]: d for d in dets}
    for f in fires:
        for m in f["members"]:
            by_id[m]["fire"] = f["id"]
    stamp = now.strftime("%Y-%m-%dT%H:%MZ")
    return {
        "schema": "firewatch.current.recent.v1", "data_class": "satellite_detection", "delivery": "live",
        "retrieved_utc": now.isoformat(timespec="seconds"), "window_start": start.strftime("%Y-%m-%dT%H:%MZ"), "window_end": stamp,
        "latest_acquisition": dets[-1]["t"] if dets else None, "bbox_wgs84": [20.4, 40.8, 23.1, 42.5], "products": sorted(PRODUCTS),
        "grouping": f"Detections within {firelib.LINK_KM} km and {firelib.LINK_HOURS:.0f} h of each other form one group (single linkage).",
        "credit": "NASA FIRMS near-real-time active fire detections (VIIRS NOAA-20/21, MODIS); NASA LANCE/FIRMS.",
        "detections": dets, "fires": fires,
    }


def firms_fetcher(key):
    def fetch(product, days, date):
        url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{product}/{BBOX}/{days}/{date}"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ApexFire-ingest/1.0"}), timeout=60) as r:
                return r.read(10_000_000).decode("utf-8")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"FIRMS HTTP {e.code} for {product}") from None  # URL withheld: it contains the key
    return fetch


try:  # Cloud entry point; the local check below runs without firebase packages being configured.
    from firebase_admin import db, initialize_app
    from firebase_functions import https_fn, options, scheduler_fn
    from firebase_functions.params import SecretParam, StringParam

    FIRMS_KEY = SecretParam("FIRMS_MAP_KEY")
    DATABASE_URL = StringParam("DATABASE_URL")
    options.set_global_options(region="europe-west1", max_instances=1, memory=options.MemoryOption.MB_256, timeout_sec=120)

    _app = None

    @scheduler_fn.on_schedule(schedule="every 15 minutes", secrets=[FIRMS_KEY], timezone="Etc/UTC")
    def refresh_live(event: scheduler_fn.ScheduledEvent) -> None:
        global _app
        if _app is None:
            _app = initialize_app(options={"databaseURL": DATABASE_URL.value})
        now = datetime.now(timezone.utc)
        status = db.reference("/public/status")
        try:
            snap = build_snapshot(firms_fetcher(FIRMS_KEY.value), now)
            db.reference("/public/recent").set(snap)  # one write: clients never see a half-updated snapshot
            status.set({"last_attempt_utc": now.isoformat(timespec="seconds"), "last_success_utc": now.isoformat(timespec="seconds"),
                        "detections": len(snap["detections"]), "fires": len(snap["fires"]), "error": None})
        except Exception as e:  # keep the last good snapshot; report a sanitized error
            status.update({"last_attempt_utc": now.isoformat(timespec="seconds"), "error": str(e)[:300]})
            raise
    # Same-origin MKFFIS map tiles for the website (Hosting rewrite /mkffis/wms). Small and stateless; up to 10 instances
    # because a map view asks for ~20-40 tiles at once and each instance serves one request at a time; the CDN caches the rest.
    @https_fn.on_request(max_instances=10, timeout_sec=30)
    def mkffis_wms(req: https_fn.Request) -> https_fn.Response:
        status, body, headers = mkffis.handle(req.method, list(req.args.items(multi=True)))
        return https_fn.Response(body, status=status, headers=headers)
except ImportError:
    pass


if __name__ == "__main__" and "--local" in sys.argv:
    sys.path.insert(0, str(HERE.parent / "tools"))
    from check_firms import map_key
    snap = build_snapshot(firms_fetcher(map_key(HERE.parent / "Token-and-key.txt")), datetime.now(timezone.utc))
    Path(sys.argv[-1]).write_text(json.dumps(snap))
    print(f"{len(snap['detections'])} detections, {len(snap['fires'])} fires, latest {snap['latest_acquisition']} -> {sys.argv[-1]}")
