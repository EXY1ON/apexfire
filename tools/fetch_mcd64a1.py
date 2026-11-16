# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["numpy>=2.3", "pyhdf==0.11.7"]
# ///
"""Crop NASA MCD64A1 v061 burned area (tile h19v04, 2001-2025) to North Macedonia (D24, D26).

    uv run --python 3.14 tools/fetch_mcd64a1.py --self-test
    uv run --python 3.14 tools/fetch_mcd64a1.py            # resumable; needs the Earthdata bearer in token-and-key.txt

Lists granules in NASA CMR, downloads each HDF4 from LP DAAC with the bearer (dropped on redirects away from NASA
hosts), hashes it, saves the Burn Date and QA crop with its granule ID, and deletes the HDF.
"""

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from landscape import PIXEL_M, sin_tile_origin, sin_window  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "Data" / "readiness" / "landscape" / "mcd64a1"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
YEARS = (2001, 2025)
NASA_HOSTS = (".earthdata.nasa.gov", ".earthdatacloud.nasa.gov")
HDF4_MAGIC = b"\x0e\x03\x13\x01"


def find_token(text):
    tokens = set(re.findall(r"eyJ[\w-]+\.[\w-]+\.[\w-]+", text))
    if len(tokens) != 1:
        raise ValueError("Expected one Earthdata bearer (JWT) in the local credential file; contents withheld")
    return tokens.pop()


class KeepBearerOnNasaHosts(urllib.request.HTTPRedirectHandler):
    """LP DAAC redirects to a pre-signed S3 URL; the bearer must not travel to non-NASA hosts."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and not (urllib.parse.urlsplit(newurl).hostname or "").endswith(NASA_HOSTS):
            new.remove_header("Authorization")
        return new


def granules():
    """One h19v04 granule per month for YEARS, from NASA CMR (public, no login)."""
    q = urllib.parse.urlencode({"short_name": "MCD64A1", "version": "061", "page_size": 2000, "bounding_box": "21.5,41.5,21.6,41.6",
                                "temporal": f"{YEARS[0]}-01-01T00:00:00Z,{YEARS[1]}-12-31T23:59:59Z"})
    with urllib.request.urlopen(f"{CMR}?{q}", timeout=120) as r:
        entries = json.load(r)["feed"]["entry"]
    out = {}
    for e in entries:
        gid = e["producer_granule_id"].removesuffix(".hdf")
        if ".h19v04." not in gid:
            continue
        stamp = gid.split(".")[1]
        day = date(int(stamp[1:5]), 1, 1) + timedelta(int(stamp[5:8]) - 1)
        url = next(link["href"] for link in e["links"] if link["href"].startswith("https://") and link["href"].endswith(".hdf"))
        if (day.year, day.month) in out:
            raise ValueError(f"Two granules for {day:%Y-%m}")
        out[(day.year, day.month)] = {"id": gid, "year": day.year, "month": day.month, "url": url}
    need = {(y, m) for y in range(YEARS[0], YEARS[1] + 1) for m in range(1, 13)}
    if set(out) != need:
        raise ValueError(f"CMR months missing: {sorted(need - set(out))[:6]}")
    return [out[k] for k in sorted(out)]


def fetch(g, opener, token):
    from pyhdf.SD import SD, SDC
    tmp = DEST / "download.hdf.part"
    h, size = hashlib.sha256(), 0
    request = urllib.request.Request(g["url"], headers={"Authorization": f"Bearer {token}"})
    with opener.open(request, timeout=300) as r, open(tmp, "wb") as f:
        for chunk in iter(lambda: r.read(1 << 20), b""):
            h.update(chunk)
            f.write(chunk)
            size += len(chunk)
    with open(tmp, "rb") as f:
        if f.read(4) != HDF4_MAGIC:
            raise ValueError(f"{g['id']}: response is not an HDF4 file (a login page?)")
    r0, r1, c0, c1 = sin_window()
    sd = SD(str(tmp), SDC.READ)
    try:
        burn = np.asarray(sd.select("Burn Date")[r0:r1, c0:c1], dtype=np.int16)
        qa = np.asarray(sd.select("QA")[r0:r1, c0:c1], dtype=np.uint8)
    finally:
        sd.end()
    x0, y0 = sin_tile_origin(19, 4)
    crop = f"{g['id']}.npz"
    np.savez_compressed(DEST / crop, burn_date=burn, qa=qa, x0=x0 + c0 * PIXEL_M, y0=y0 - r0 * PIXEL_M)
    tmp.unlink()
    return {**g, "sha256": h.hexdigest(), "bytes": size, "crop": crop}


def self_test():
    assert find_token("FIRMS 0123 eyJhbGci.eyJzdWIi.c2ln") == "eyJhbGci.eyJzdWIi.c2ln"
    for bad in ("no token here", "eyJa.b.c eyJd.e.f"):
        try:
            find_token(bad)
        except ValueError:
            continue
        raise AssertionError(bad)
    handler = KeepBearerOnNasaHosts()
    req = urllib.request.Request("https://data.lpdaac.earthdatacloud.nasa.gov/x.hdf", headers={"Authorization": "Bearer t"})
    s3 = handler.redirect_request(req, None, 307, "", {}, "https://lp-prod-protected.s3.us-west-2.amazonaws.com/x.hdf?sig=1")
    urs = handler.redirect_request(req, None, 302, "", {}, "https://urs.earthdata.nasa.gov/oauth/authorize?x=1")
    assert not s3.has_header("Authorization") and urs.has_header("Authorization")
    r0, r1, c0, c1 = sin_window()
    assert 0 <= r0 < r1 <= 2400 and 0 <= c0 < c1 <= 2400
    print("self-test passed")


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--self-test", action="store_true")
    p.add_argument("--credentials-file", type=Path, default=ROOT / "token-and-key.txt")
    a = p.parse_args()
    if a.self_test:
        return self_test()
    DEST.mkdir(parents=True, exist_ok=True)
    path = DEST / "manifest.json"
    manifest = json.loads(path.read_text()) if path.exists() else {
        "product": "MCD64A1.061", "tile": "h19v04", "window_rows_cols": list(sin_window()), "pixel_m": PIXEL_M, "granules": []}
    manifest["granules"] = [g for g in manifest["granules"] if (DEST / g["crop"]).exists()]
    done = {g["id"] for g in manifest["granules"]}
    token = find_token(a.credentials_file.read_text())
    opener = urllib.request.build_opener(KeepBearerOnNasaHosts)
    todo = [g for g in granules() if g["id"] not in done]
    for i, g in enumerate(todo, 1):
        try:
            manifest["granules"].append(fetch(g, opener, token))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit(f"Earthdata refused the bearer (HTTP {e.code}); renew it and rerun. {i - 1} new granules saved.") from None
            raise
        path.write_text(json.dumps(manifest, indent=1) + "\n")
        print(f"{g['id']} ({i}/{len(todo)})", flush=True)
    print(f"{len(manifest['granules'])} granules cropped in {DEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
