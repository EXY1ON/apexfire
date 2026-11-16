"""Fetch CORINE Land Cover 2000-2018 and EFFIS burned areas for North Macedonia (What burns, slice 1).

    .venv/bin/python tools/fetch_landscape.py

Writes Data/readiness/landscape/: corine-{2000,2006,2012,2018}.geojson, effis-burned-areas.geojson,
effis-annual.json and manifest.json (URL, SHA-256, bytes, retrieval time). No account is needed.
NASA burned area comes separately from tools/fetch_mcd64a1.py.
"""

import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from landscape import BBOX, CORINE_FIELD, EDITIONS  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "Data" / "readiness" / "landscape"
UA = "ApexFire data preparation (+https://apexfire.web.app)"
EEA = "https://image.discomap.eea.europa.eu/arcgis/rest/services/Corine/CLC{year}_WM/MapServer/0/query"
EFFIS_WFS = ("https://maps.effis.emergency.copernicus.eu/effis?service=WFS&version=2.0.0&request=GetFeature"
             f"&typeNames=ms:modis.ba.poly&srsName=EPSG:4326&bbox={BBOX[1]},{BBOX[0]},{BBOX[3]},{BBOX[2]},EPSG:4326&outputFormat=geojson")
EFFIS_ANNUAL = "https://api2.effis.emergency.copernicus.eu/statistics/v2/effis/estimatesbycountry?country=MKD"
PAGE = 1000


def get_json(url, tries=2):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120) as r:
                return json.load(r)
        except OSError:
            if attempt + 1 == tries:
                raise
            time.sleep(5)


def check_features(features, field):
    """Refuse anything but polygons carrying a three-digit CORINE code."""
    for f in features:
        code = str((f.get("properties") or {}).get(field, ""))
        if (f.get("geometry") or {}).get("type") not in ("Polygon", "MultiPolygon") or not (len(code) == 3 and code.isdigit()):
            raise ValueError(f"Unexpected CORINE feature: {str(f)[:120]}")


def corine(edition):
    """All CORINE polygons touching the box, paged; ~30 m server-side generalisation (the grid is 100 m)."""
    field, url = CORINE_FIELD[edition], EEA.format(year=edition)
    base = {"where": "1=1", "geometry": ",".join(map(str, BBOX)), "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects"}
    count = get_json(f"{url}?{urllib.parse.urlencode({**base, 'returnCountOnly': 'true', 'f': 'json'})}")["count"]
    features = []
    while len(features) < count:
        q = {**base, "outFields": field, "outSR": 4326, "orderByFields": "OBJECTID", "resultOffset": len(features),
             "resultRecordCount": PAGE, "maxAllowableOffset": 0.0003, "f": "geojson"}
        page = get_json(f"{url}?{urllib.parse.urlencode(q)}")["features"]
        if not page:
            raise ValueError(f"CORINE {edition}: empty page at offset {len(features)} of {count}")
        check_features(page, field)
        features += [{"type": "Feature", "properties": {field: f["properties"][field]}, "geometry": f["geometry"]} for f in page]
        print(f"CORINE {edition}: {len(features)}/{count}", flush=True)
    if len(features) != count:
        raise ValueError(f"CORINE {edition}: {len(features)} features, expected {count}")
    return {"type": "FeatureCollection", "features": features}, f"{url}?{urllib.parse.urlencode({**base, 'outFields': field, 'f': 'geojson'})}"


def effis():
    data = get_json(EFFIS_WFS)
    feats = data.get("features")
    if not isinstance(feats, list) or not feats:
        raise ValueError("EFFIS returned no burned areas")
    if data.get("numberMatched") not in (None, len(feats)):
        raise ValueError(f"EFFIS query truncated: {len(feats)} of {data['numberMatched']}")
    if any(f["geometry"]["type"] not in ("Polygon", "MultiPolygon") for f in feats):
        raise ValueError("EFFIS returned a non-polygon burned area")
    return data


def save(name, data, url):
    raw = json.dumps(data, separators=(",", ":")).encode()
    (DEST / name).write_bytes(raw)
    return {"path": str((DEST / name).relative_to(ROOT)), "url": url, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    assets = []
    for e in EDITIONS:
        data, url = corine(e)
        assets.append({**save(f"corine-{e}.geojson", data, url), "features": len(data["features"])})
    burned = effis()
    assets.append({**save("effis-burned-areas.geojson", burned, EFFIS_WFS), "features": len(burned["features"])})
    annual = get_json(EFFIS_ANNUAL)
    if not isinstance(annual, list) or not all({"year", "ba", "nf"} <= set(r) for r in annual):
        raise ValueError("Unexpected EFFIS annual estimates")
    assets.append(save("effis-annual.json", annual, EFFIS_ANNUAL))
    (DEST / "manifest.json").write_text(json.dumps({"bbox_wgs84": BBOX, "assets": assets}, indent=1) + "\n")
    print(f"saved {len(assets)} files, {sum(a['bytes'] for a in assets) / 1e6:.1f} MB in {DEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
