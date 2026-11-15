"""Allowlisting proxy for the MKFFIS national fire-danger WMS (Crisis Management Centre of North Macedonia).

MKFFIS serves WMS only over plain HTTP on port 8080 and sends no CORS headers, so an HTTPS site cannot load it directly.
Firebase Hosting rewrites /mkffis/wms to this function. Only two requests pass, each rebuilt from validated values
(the incoming query string is never forwarded): GetMap of one daily FWI or 8-day vegetation-dryness layer as a PNG of at
most 512 px over North Macedonia, and GetLegendGraphic of such a layer. Anything else is 400; only real PNG bytes are relayed.

Reuse terms of MKFFIS maps are unconfirmed (docs/readiness/additional-sources.md): do not deploy until they are settled.
"""

import math
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

UPSTREAM = "http://mkffis1.cuk.gov.mk:8080/geoserver/wms"
LAYER = re.compile(r"^(fwibeta:fwi(?P<d>\d{8})_tif|VDM:VDM_\d{8}_(?P<end>\d{8})_tif)$")
PNG = b"\x89PNG\r\n\x1a\n"
MAX_BYTES = 2_000_000
MAX_PX = 512
# Requests must overlap this box around North Macedonia (lon/lat; the same box in Web Mercator metres for EPSG:3857).
AREA = (19.0, 40.0, 24.5, 43.5)


def _merc(lon, lat):
    return lon * 20037508.34 / 180, math.log(math.tan((90 + lat) * math.pi / 360)) * 20037508.34 / math.pi


AREA_3857 = (*_merc(AREA[0], AREA[1]), *_merc(AREA[2], AREA[3]))
COMMON = {"service": {"WMS"}, "version": {"1.1.1"}, "format": {"image/png"}}
ALLOWED = {
    "GetMap": {"service", "version", "request", "layers", "styles", "srs", "bbox", "width", "height", "format", "transparent"},
    "GetLegendGraphic": {"service", "version", "request", "layer", "format"},
}
REQUIRED = {
    "GetMap": {"service", "version", "request", "layers", "srs", "bbox", "width", "height", "format"},
    "GetLegendGraphic": {"service", "version", "request", "layer", "format"},
}


class Rejected(ValueError):
    """The request is outside the allowlist; the message is safe to show (it echoes no input)."""


def validate(pairs):
    """pairs: (key, value) list from the query string. Returns the upstream query as an ordered dict, or raises Rejected."""
    params = {}
    for k, v in pairs:
        k = k.lower()  # WMS parameter names are case-insensitive
        if k in params:
            raise Rejected("repeated parameter")
        params[k] = v
    req = params.get("request")
    if req not in ALLOWED:
        raise Rejected("only GetMap and GetLegendGraphic are allowed")
    if set(params) - ALLOWED[req]:
        raise Rejected("unexpected parameter")
    if REQUIRED[req] - set(params):
        raise Rejected("missing parameter")
    for k, ok in COMMON.items():
        if params[k] not in ok:
            raise Rejected(f"unsupported {k}")
    layer = params["layers" if req == "GetMap" else "layer"]
    if not LAYER.match(layer):
        raise Rejected("only MKFFIS daily FWI and 8-day vegetation-dryness layers are allowed")
    if req == "GetLegendGraphic":
        return {"service": "WMS", "version": "1.1.1", "request": req, "layer": layer, "format": "image/png"}
    if params.get("styles", "") != "":
        raise Rejected("styles must be empty")
    if params["srs"] not in ("EPSG:3857", "EPSG:4326"):
        raise Rejected("unsupported srs")
    if params.get("transparent", "true") not in ("true", "false", "TRUE", "FALSE"):
        raise Rejected("bad transparent")
    try:
        w, h = int(params["width"]), int(params["height"])
        box = [float(x) for x in params["bbox"].split(",")]
    except ValueError:
        raise Rejected("bad size or bbox") from None
    if not (1 <= w <= MAX_PX and 1 <= h <= MAX_PX):
        raise Rejected("size out of range")
    if len(box) != 4 or not all(math.isfinite(x) for x in box) or box[0] >= box[2] or box[1] >= box[3]:
        raise Rejected("bad bbox")
    area = AREA_3857 if params["srs"] == "EPSG:3857" else AREA
    if box[2] <= area[0] or box[0] >= area[2] or box[3] <= area[1] or box[1] >= area[3]:
        raise Rejected("bbox outside North Macedonia")
    return {"service": "WMS", "version": "1.1.1", "request": "GetMap", "layers": layer, "styles": "", "srs": params["srs"],
            "bbox": ",".join(repr(x) for x in box), "width": str(w), "height": str(h), "format": "image/png",
            "transparent": params.get("transparent", "true").lower()}


def cache_control(query, today=None):
    """Past maps do not change: cache a day in browsers, a week at the CDN. Today's and yesterday's may still be updated."""
    m = LAYER.match(query.get("layers") or query["layer"])
    last = m.group("d") or m.group("end")
    today = today or datetime.now(timezone.utc).date()
    settled = date(int(last[:4]), int(last[4:6]), int(last[6:])) < today - timedelta(days=1)
    return "public, max-age=86400, s-maxage=604800" if settled else "public, max-age=600, s-maxage=1800"


def fetch(query, opener=urllib.request.urlopen):
    """(status, body, headers) for the client: the PNG, 404 when MKFFIS has no such map, 502 when it fails."""
    url = f"{UPSTREAM}?{urllib.parse.urlencode(query)}"
    try:
        with opener(urllib.request.Request(url, headers={"User-Agent": "ApexFire-mkffis-proxy/1.0"}), timeout=20) as r:
            body = r.read(MAX_BYTES + 1)
            kind = r.headers.get("Content-Type", "")
    except (urllib.error.URLError, TimeoutError, OSError):
        return 502, b"MKFFIS unavailable", {"Cache-Control": "no-store"}
    if len(body) > MAX_BYTES:
        return 502, b"MKFFIS response too large", {"Cache-Control": "no-store"}
    if not kind.startswith("image/png") or not body.startswith(PNG):
        # GeoServer answers an unknown layer with HTTP 200 and an XML exception: report "no such map", never relay the XML.
        return 404, b"No such MKFFIS map", {"Cache-Control": "public, max-age=600, s-maxage=600"}
    return 200, body, {"Content-Type": "image/png", "Cache-Control": cache_control(query)}


def handle(method, pairs, opener=urllib.request.urlopen):
    """The whole proxy without Flask, for tests: (status, body, headers)."""
    base = {"X-Content-Type-Options": "nosniff", "Content-Type": "text/plain; charset=utf-8"}
    if method not in ("GET", "HEAD"):
        return 405, b"GET only", {**base, "Allow": "GET, HEAD", "Cache-Control": "no-store"}
    try:
        query = validate(pairs)
    except Rejected as e:
        return 400, str(e).encode(), {**base, "Cache-Control": "public, max-age=3600"}
    status, body, headers = fetch(query, opener)
    return status, (b"" if method == "HEAD" else body), {**base, **headers}
