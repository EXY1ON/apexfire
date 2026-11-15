"""Download bounded public data for the Serta July 2024 case; no account required."""

import hashlib
import json
import math
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import rasterio
from rasterio.windows import Window, from_bounds
from rasterio.warp import transform_bounds


ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "Data" / "case-studies" / "serta-2024"
BBOX = (22.04, 41.46, 22.26, 41.67)
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
_SAS_TOKENS = {}


def _tokenized_href(href, token):
    return f"{href}{'&' if '?' in href else '?'}{token}"


def get_json(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return json.load(response)


def crop_window(bounds, transform, width, height):
    window = from_bounds(*bounds, transform=transform)
    left, top = max(0, math.floor(window.col_off)), max(0, math.floor(window.row_off))
    right = min(width, math.ceil(window.col_off + window.width))
    bottom = min(height, math.ceil(window.row_off + window.height))
    if right <= left or bottom <= top:
        raise ValueError("Requested bounds do not overlap the source raster")
    return Window(left, top, right - left, bottom - top)


def save_crop(item, asset_key, destination):
    unsigned = item["assets"][asset_key]["href"]
    if not destination.exists():
        collection = item["collection"]
        if collection == "modis-64A1-061":
            sign_url = "https://planetarycomputer.microsoft.com/api/sas/v1/sign?" + urllib.parse.urlencode({"href": unsigned})
            signed = get_json(sign_url)["href"]
        else:
            if collection not in _SAS_TOKENS:
                token_url = f"https://planetarycomputer.microsoft.com/api/sas/v1/token/{collection}"
                _SAS_TOKENS[collection] = get_json(token_url)["token"]
            signed = _tokenized_href(unsigned, _SAS_TOKENS[collection])
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="45", GDAL_HTTP_MAX_RETRY="0", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
                with rasterio.open(signed) as source:
                    bounds = transform_bounds("EPSG:4326", source.crs, *BBOX, densify_pts=21)
                    window = crop_window(bounds, source.transform, source.width, source.height)
                    data = source.read(window=window)
                    profile = source.profile.copy()
                    profile.update(width=int(window.width), height=int(window.height), transform=source.window_transform(window), compress="deflate", tiled=True, blockxsize=256, blockysize=256)
                    temporary = destination.with_suffix(".part.tif")
                    with rasterio.open(temporary, "w", **profile) as output:
                        output.write(data)
                        output.update_tags(**source.tags(), source_item=item["id"], source_asset=asset_key)
                        output.scales = source.scales
                        output.offsets = source.offsets
                    temporary.replace(destination)
        except Exception as error:
            diagnostic = str(error).split("?", 1)[0][:200]
            raise RuntimeError(f"Could not read public asset {item['id']}:{asset_key} ({type(error).__name__}: {diagnostic})") from None
    with rasterio.open(destination) as result:
        metadata = {"crs": str(result.crs), "shape": [result.height, result.width], "resolution": list(result.res), "nodata": result.nodata, "dtype": result.dtypes[0]}
    return {"path": str(destination.relative_to(ROOT)), "source_url": unsigned, "collection": item["collection"], "item": item["id"], "asset": asset_key, "acquired": item["properties"].get("datetime"), "bytes": destination.stat().st_size, "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(), **metadata}


def main():
    assert _tokenized_href("https://data.example.test/asset.tif", "se=token") == "https://data.example.test/asset.tif?se=token"
    assert crop_window((1, 1, 3, 3), rasterio.Affine(1, 0, 0, 0, -1, 4), 4, 4) == Window(1, 1, 2, 2)
    try:
        crop_window((10, 10, 12, 12), rasterio.Affine(1, 0, 0, 0, -1, 4), 4, 4)
    except ValueError:
        pass
    else:
        raise AssertionError("Disjoint window accepted")
    for folder in ("reference", "hls", "terrain", "land-cover", "metadata"):
        (DEST / folder).mkdir(parents=True, exist_ok=True)
    manifest = {"retrieved_utc": datetime.now(timezone.utc).isoformat(), "case": "Serta July 2024 complex, GDACS event 1020198 subset", "bbox_wgs84": BBOX, "method": "Anonymous public mirror; native-grid crops via HTTPS range reads; source units and QA retained. Crops are derivatives, not full original tiles.", "assets": []}
    # Reuse the saved snapshots; a clean run needs only the final reference.
    reference_files = sorted((DEST / "reference").glob("gdacs-1020198-episode-*.geojson"))
    if not reference_files:
        destination = DEST / "reference" / "gdacs-1020198-episode-9.geojson"
        destination.write_text(json.dumps(get_json("https://www.gdacs.org/contentdata/resources/WF/1020198/geojson_1020198_9.geojson"), indent=2) + "\n")
        reference_files = [destination]
    for destination in reference_files:
        episode = int(destination.stem.rsplit("-", 1)[-1])
        url = f"https://www.gdacs.org/contentdata/resources/WF/1020198/geojson_1020198_{episode}.geojson"
        assert json.loads(destination.read_text())["type"] == "FeatureCollection"
        manifest["assets"].append({"path": str(destination.relative_to(ROOT)), "source_url": url, "bytes": destination.stat().st_size, "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()})
    sources = [
        ("hls2-s30", "HLS.S30.T34TEM.2024188T091559.v2.0", "2024-07-06"),
        ("hls2-s30", "HLS.S30.T34TEM.2024198T091559.v2.0", "2024-07-16"),
        ("hls2-s30", "HLS.S30.T34TEM.2024208T091559.v2.0", "2024-07-26"),
        ("nasadem", "NASADEM_HGT_n41e022", "nasadem"),
        ("esa-worldcover", "ESA_WorldCover_10m_2021_v200_N39E021", "worldcover-2021"),
    ]
    for collection, identifier, label in sources:
        item = get_json(f"{STAC}/collections/{collection}/items/{identifier}")
        (DEST / "metadata" / f"{identifier}.json").write_text(json.dumps(item, indent=2) + "\n")
        bands = ["Fmask", "B02", "B03", "B04", "B8A", "B12"] if collection.startswith("hls") else ["elevation"] if collection == "nasadem" else ["map"]
        folder = "hls" if collection.startswith("hls") else "terrain" if collection == "nasadem" else "land-cover"
        for band in bands:
            print(f"Downloading {label} {band}", flush=True)
            manifest["assets"].append(save_crop(item, band, DEST / folder / f"{label}-{band.lower()}.tif"))
            (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Saved {len(manifest['assets'])} source datasets/crops; {sum(a['bytes'] for a in manifest['assets']) / 1e6:.2f} MB", flush=True)


if __name__ == "__main__":
    main()
