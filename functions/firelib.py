"""Group satellite detections into "fires": detections linked by distance and time (single linkage).

Shared by the website export and the scheduled ingestion function. A fire here is a group of
detections that are probably the same burning area, not a confirmed or officially mapped incident.
"""

import hashlib
import math
from datetime import datetime

LINK_KM = 2.0      # MODIS pixels are ~1 km at nadir, VIIRS ~375 m; 2 km bridges neighbouring pixels
LINK_HOURS = 24.0  # a gap of more than a day between nearby detections starts a new group


def km(lat1, lon1, lat2, lon2):
    r = math.pi / 180
    a = math.sin((lat2 - lat1) * r / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lon2 - lon1) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


def _hours(t):
    return datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() / 3600


def cluster(dets):
    """dets: dicts with lat, lon, t (ISO UTC), frp, sensor, id. Returns lists of member indices."""
    n = len(dets)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    hours = [_hours(d["t"]) for d in dets]
    cell = {}
    for i, d in enumerate(dets):  # 0.02 degree buckets (~2 km): compare only with neighbouring buckets
        cell.setdefault((int(d["lat"] / 0.02), int(d["lon"] / 0.02)), []).append(i)
    for (cy, cx), members in cell.items():
        near = [j for dy in (-1, 0, 1) for dx in (-1, 0, 1) for j in cell.get((cy + dy, cx + dx), [])]
        for i in members:
            for j in near:
                if j > i and abs(hours[i] - hours[j]) <= LINK_HOURS and km(dets[i]["lat"], dets[i]["lon"], dets[j]["lat"], dets[j]["lon"]) <= LINK_KM:
                    parent[find(i)] = find(j)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return sorted(groups.values(), key=lambda g: -max(hours[i] for i in g))


def summarize(dets, members, places=None):
    """Fire summary: FRP-weighted centre, first/last seen, counts, sensors, nearby GeoNames places."""
    ms = [dets[i] for i in members]
    w = [max(m["frp"], 0.1) for m in ms]
    lat = sum(m["lat"] * x for m, x in zip(ms, w)) / sum(w)
    lon = sum(m["lon"] * x for m, x in zip(ms, w)) / sum(w)
    first, last = min(m["t"] for m in ms), max(m["t"] for m in ms)
    spread = max((km(lat, lon, m["lat"], m["lon"]) for m in ms), default=0.0)
    fid = "F" + hashlib.sha1(f"{first}|{min(m['id'] for m in ms)}".encode()).hexdigest()[:10]
    out = {
        "id": fid, "lat": round(lat, 5), "lon": round(lon, 5), "first_seen": first, "last_seen": last,
        "detections": len(ms), "sensors": sorted({m["sensor"] for m in ms}), "max_frp": round(max(m["frp"] for m in ms), 1),
        "sum_frp": round(sum(m["frp"] for m in ms), 1), "spread_km": round(spread, 2),
        "inside_mk": any(m.get("inside") for m in ms), "members": [m["id"] for m in ms],
    }
    if places:
        ranked = sorted(((km(lat, lon, p["lat"], p["lon"]), p) for p in places), key=lambda x: x[0])
        out["nearest"] = {"name": ranked[0][1]["name"], "cyr": ranked[0][1].get("cyr"), "km": round(ranked[0][0], 1)}
        out["within_5km"] = [{"name": p["name"], "km": round(d, 1), "population": p.get("pop", 0)} for d, p in ranked if d <= 5][:8]
    return out


def self_test():
    base = {"frp": 5.0, "sensor": "viirs-jpss1"}
    dets = [
        {**base, "id": "a", "lat": 41.0, "lon": 21.0, "t": "2026-08-01T01:00Z"},
        {**base, "id": "b", "lat": 41.01, "lon": 21.0, "t": "2026-08-01T12:00Z"},   # 1.1 km, 11 h: same fire
        {**base, "id": "c", "lat": 41.02, "lon": 21.0, "t": "2026-08-03T12:00Z"},   # 48 h after b: new fire
        {**base, "id": "d", "lat": 41.2, "lon": 21.0, "t": "2026-08-01T01:00Z"},    # 22 km away: new fire
    ]
    groups = cluster(dets)
    assert sorted(sorted(dets[i]["id"] for i in g) for g in groups) == [["a", "b"], ["c"], ["d"]], groups
    s = summarize(dets, [0, 1], [{"name": "X", "lat": 41.0, "lon": 21.005, "pop": 100}])
    assert s["detections"] == 2 and s["first_seen"] < s["last_seen"] and s["nearest"]["name"] == "X" and s["within_5km"][0]["km"] < 1
    assert abs(km(41, 21, 42, 21) - 111.2) < 0.5
    print("firelib self-test passed")


if __name__ == "__main__":
    self_test()
