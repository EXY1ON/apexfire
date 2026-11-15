"""Fill gaps in the local North Macedonia FIRMS archive through the FIRMS area API (MAP_KEY kept private).

Downloads 5-day chunks over the MK bounding box for each planned product/date span, validates every
response, paces itself under the MAP_KEY transaction limit and resumes from Data/firms-api/progress.json.
Raw responses are appended per product and year; tools/export_web_data.py clips them to the country.

    python3 tools/fetch_firms_archive.py            # run or resume the plan
    python3 tools/fetch_firms_archive.py --plan     # print the plan only
    python3 tools/fetch_firms_archive.py --self-test
"""

import argparse
import csv
import hashlib
import io
import json
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from check_firms import map_key

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "Data" / "firms-api"
BBOX = "20.4,40.8,23.1,42.5"
HOST = "https://firms.modaps.eosdis.nasa.gov"
CHUNK = 5  # FIRMS area API maximum day range
SOFT_LIMIT = 3800  # of 5000 transactions per 10 minutes

# (family, product, first day, last day). Standard processing (SP) where published, near-real-time (NRT) after.
PLAN = [
    # near-real-time first: the tracker's recent window depends on it
    ("viirs-jpss1", "VIIRS_NOAA20_NRT", "2026-08-01", None),
    ("viirs-noaa21", "VIIRS_NOAA21_NRT", "2026-08-01", None),
    ("modis", "MODIS_NRT", "2026-09-01", None),
    ("viirs-snpp", "VIIRS_SNPP_NRT", "2026-08-01", "2026-11-02"),
    ("viirs-snpp", "VIIRS_SNPP_SP", "2012-01-20", "2023-12-31"),
    ("viirs-snpp", "VIIRS_SNPP_SP", "2026-01-01", "2026-07-31"),
    ("viirs-noaa21", "VIIRS_NOAA21_SP", "2023-03-01", "2026-07-31"),
    ("viirs-jpss1", "VIIRS_NOAA20_SP", "2026-01-01", "2026-07-31"),
    ("modis", "MODIS_SP", "2013-01-01", "2013-12-31"),
    ("modis", "MODIS_SP", "2026-01-01", "2026-08-31"),
]


def chunks(first, last):
    d, end = date.fromisoformat(first), date.fromisoformat(last)
    while d <= end:
        n = min(CHUNK, (end - d).days + 1)
        yield d, n
        d += timedelta(days=n)


def validate(text, start, days):
    """Rows must be CSV with the FIRMS header and acquisition dates inside the requested span."""
    if not text.startswith("latitude,longitude"):
        raise ValueError("Response is not FIRMS CSV (body withheld)")
    rows = list(csv.DictReader(io.StringIO(text)))
    last = (start + timedelta(days=days - 1)).isoformat()
    for r in rows:
        if not (start.isoformat() <= r["acq_date"] <= last):
            raise ValueError(f"Row date {r['acq_date']} outside requested {start}..{last}")
    return rows


def fetch(key, product, start, days):
    url = f"{HOST}/api/area/csv/{key}/{product}/{BBOX}/{days}/{start.isoformat()}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ApexFire-ingest/1.0"}), timeout=120) as r:
                return r.read(20_000_000).decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(30 * (attempt + 1))
                continue
            raise RuntimeError(f"FIRMS HTTP {e.code} for {product} {start} (URL withheld)") from None
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(20 * (attempt + 1))
                continue
            raise RuntimeError(f"Network error for {product} {start}") from None


def transactions(key):
    with urllib.request.urlopen(f"{HOST}/mapserver/mapkey_status/?MAP_KEY={key}", timeout=60) as r:
        return json.loads(r.read())["current_transactions"]


def run(plan_only=False):
    today = datetime.now(timezone.utc).date().isoformat()
    todo = [(fam, prod, d, n) for fam, prod, a, b in PLAN for d, n in chunks(a, b or today)]
    print(f"{len(todo)} requests planned, {sum(n for *_, n in todo)} days")
    if plan_only:
        return
    key = map_key(ROOT / "Token-and-key.txt")
    DEST.mkdir(parents=True, exist_ok=True)
    prog_path = DEST / "progress.json"
    done = json.loads(prog_path.read_text()) if prog_path.exists() else {}
    for i, (fam, prod, d, n) in enumerate(todo):
        tag = f"{prod}/{d.isoformat()}/{n}"
        if tag in done:
            continue
        if i % 40 == 0:
            while transactions(key) > SOFT_LIMIT:
                print("pausing for transaction window…", flush=True)
                time.sleep(60)
        text = fetch(key, prod, d, n)
        rows = validate(text, d, n)
        out = DEST / fam / f"{prod}_{d.year}.csv"
        out.parent.mkdir(parents=True, exist_ok=True)
        header, *body = text.rstrip("\n").split("\n") if text.strip() else ("", [])
        with open(out, "a", encoding="utf-8") as f:
            if out.stat().st_size == 0:
                f.write(header + "\n")
            if body:
                f.write("\n".join(body) + "\n")
        done[tag] = {"rows": len(rows), "retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        prog_path.write_text(json.dumps(done))
        if i % 50 == 0:
            print(f"{i + 1}/{len(todo)} {tag} rows={len(rows)}", flush=True)
    write_manifest(done)
    print("complete")


def write_manifest(done):
    files = []
    for p in sorted(DEST.glob("*/*.csv")):
        raw = p.read_bytes()
        rows = max(0, raw.count(b"\n") - 1)
        prod, year = p.stem.rsplit("_", 1)
        files.append({"path": str(p.relative_to(ROOT)), "family": p.parent.name, "product": prod, "year": int(year),
                      "rows_bbox": rows, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    (DEST / "manifest.json").write_text(json.dumps({
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "NASA FIRMS area API (MAP_KEY withheld), 5-day requests", "bbox_wgs84": BBOX,
        "scope": "Bounding box includes neighbouring countries; export clips to the geoBoundaries 2016 MK polygon.",
        "plan": [list(p) for p in PLAN], "requests": len(done), "files": files,
    }, indent=1))


def self_test():
    assert list(chunks("2024-01-01", "2024-01-12")) == [(date(2024, 1, 1), 5), (date(2024, 1, 6), 5), (date(2024, 1, 11), 2)]
    hdr = "latitude,longitude,acq_date,acq_time\n"
    assert len(validate(hdr + "41,21,2024-01-03,1200\n", date(2024, 1, 1), 5)) == 1
    for bad in (hdr + "41,21,2024-01-06,1200\n", "<html>error</html>", "Invalid API call."):
        try:
            validate(bad, date(2024, 1, 1), 5)
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad[:30]!r}")
    print("self-test passed")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--plan", action="store_true")
    a = ap.parse_args()
    self_test() if a.self_test else run(plan_only=a.plan)
