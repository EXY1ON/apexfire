"""Fetch a bounded FIRMS NRT proof without exposing the local MAP_KEY."""

import argparse
import csv
import hashlib
import io
import json
import math
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
BBOX = (20.4, 40.8, 23.1, 42.5)
SOURCES = ("VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT")
MAX_BYTES = 5_000_000


def map_key(path):
    values = set(re.findall(r"(?<![A-Fa-f0-9])[A-Fa-f0-9]{32}(?![A-Fa-f0-9])", path.read_text()))
    if len(values) != 1:
        raise ValueError("Expected one FIRMS MAP_KEY in the local credential file; contents withheld")
    return values.pop()


def parse_detections(text, source):
    reader = csv.DictReader(io.StringIO(text))
    required = {"latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "frp"}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("FIRMS did not return the required CSV schema; response text withheld")
    rows = []
    for row in reader:
        lat, lon, frp = (float(row[k]) for k in ("latitude", "longitude", "frp"))
        if not all(math.isfinite(v) for v in (lat, lon, frp)) or not (-90 <= lat <= 90 and -180 <= lon <= 180 and frp >= 0):
            raise ValueError("Invalid detection coordinates or FRP")
        if not (BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]):
            raise ValueError("Detection outside the requested bounding box")
        hhmm = row["acq_time"].zfill(4)
        if not re.fullmatch(r"\d{4}", hhmm) or int(hhmm[:2]) > 23 or int(hhmm[2:]) > 59:
            raise ValueError("Invalid acquisition time")
        observed = datetime.strptime(row["acq_date"] + hhmm, "%Y-%m-%d%H%M").replace(tzinfo=timezone.utc)
        if row["confidence"].strip().lower() not in {"l", "n", "h", "low", "nominal", "high"}:
            raise ValueError("Unrecognized VIIRS confidence category")
        rows.append({"source": source, "observed_utc": observed.isoformat(), "latitude": lat, "longitude": lon, "frp_mw": frp, "raw": row})
    return rows


class NasaRedirectsOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if target.scheme != "https" or target.hostname not in {"firms.modaps.eosdis.nasa.gov", "firms2.modaps.eosdis.nasa.gov"}:
            raise ValueError("Unexpected redirect blocked; credential-bearing URL withheld")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credentials-file", type=Path, default=ROOT / "token-and-key.txt")
    args = parser.parse_args()
    key = map_key(args.credentials_file)
    destination = ROOT / "Data/readiness/firms"
    destination.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(NasaRedirectsOnly())
    manifest = {"retrieved_utc": datetime.now(timezone.utc).isoformat(), "bbox_wgs84": BBOX, "scope": "Rectangle includes neighboring territory; records are detections, not confirmed incidents", "sources": []}
    for source in SOURCES:
        endpoint = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/" + ",".join(map(str, BBOX)) + "/1"
        result = {"source": source, "url_template": "https://firms.modaps.eosdis.nasa.gov/api/area/csv/[REDACTED]/[SOURCE]/20.4,40.8,23.1,42.5/1", "requested_days": 1}
        try:
            with opener.open(urllib.request.Request(endpoint, headers={"User-Agent": "ApexFire input proof"}), timeout=40) as response:
                body = response.read(MAX_BYTES + 1)
                result.update(http_status=response.status, content_type=response.headers.get("Content-Type"))
            if len(body) > MAX_BYTES:
                raise ValueError("FIRMS response exceeds the bounded acquisition limit")
            rows = parse_detections(body.decode("utf-8-sig"), source)
            now = datetime.now(timezone.utc)
            if any(datetime.fromisoformat(r["observed_utc"]) > now for r in rows):
                raise ValueError("A detection acquisition time is in the future")
            raw_path = destination / (source.lower() + ".csv")
            normalized_path = destination / (source.lower() + ".json")
            raw_path.write_bytes(body)
            normalized_path.write_text(json.dumps(rows, indent=2) + "\n")
            times = sorted(r["observed_utc"] for r in rows)
            result.update(status="verified", detections=len(rows), sha256=hashlib.sha256(body).hexdigest(), raw_path=str(raw_path.relative_to(ROOT)), normalized_path=str(normalized_path.relative_to(ROOT)), earliest_observed_utc=times[0] if times else None, latest_observed_utc=times[-1] if times else None, latest_observation_age_hours=(now - datetime.fromisoformat(times[-1])).total_seconds() / 3600 if times else None)
        except urllib.error.HTTPError as error:
            result.update(status="blocked", http_status=error.code, error="NASA HTTP error; credential-bearing URL and response withheld")
        except Exception as error:
            result.update(status="blocked", error_type=type(error).__name__, error="Acquisition or validation failed; private request details withheld")
        manifest["sources"].append(result)
        print(json.dumps(result))
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if any(r["status"] != "verified" for r in manifest["sources"]):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
