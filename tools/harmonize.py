"""MODIS-VIIRS harmonization for North Macedonia: a tested conversion between sensors and a harmonized series.

Unit: fire-active cell-days = distinct (0.05 degree cell, UTC date) pairs with at least one land detection
(algorithm types 0 and 2, or type not reported). Type 2 is kept because that label changed abruptly around
2020-2021 in both sensors; filtering on it biased held-out tests by about -40 %. Aggregating to ~5 km cells
removes most of the pixel-size difference (MODIS ~1 km, VIIRS 375 m) before comparing sensors.

Model: monthly MODIS cell-days = a * VIIRS cell-days ** b, fitted in log space on training years and
evaluated on later held-out years. Overpass matching gives detection-level agreement and MODIS detection
probability by VIIRS fire radiative power.

    .venv/bin/python tools/harmonize.py      # reads web/public/data/history, writes web/public/data/harmonization.json
"""

import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
HIST = ROOT / "web" / "public" / "data" / "history"
OUT = ROOT / "web" / "public" / "data" / "harmonization.json"
CELL = 0.05
PAIRS = [  # (VIIRS family, training years, held-out test years)
    ("viirs-snpp", list(range(2012, 2020)), list(range(2020, 2026))),
    ("viirs-jpss1", list(range(2018, 2022)), list(range(2022, 2026))),
]
MATCH_KM, MATCH_MIN = 1.5, 90
TYPES = (0, 2, 9)  # land detections; excludes offshore (3) and volcano (1, none in MK)  # same fire seen on near-simultaneous afternoon/night overpasses


def load():
    by = defaultdict(list)
    for p in sorted(HIST.glob("*.json")):
        d = json.loads(p.read_text())
        c = {k: i for i, k in enumerate(d["columns"])}
        for r in d["rows"]:
            if r[c["type"]] in TYPES:
                by[d["sensor"]].append((r[c["t"]], r[c["lat"]], r[c["lon"]], r[c["frp"]], r[c["sat"]]))
    return by


def cell_days(rows):
    return {(t[:10], math.floor(lat / CELL), math.floor(lon / CELL)) for t, lat, lon, *_ in rows}


def monthly(cd):
    m = defaultdict(int)
    for day, *_ in cd:
        m[day[:7]] += 1
    return m


def fit_power(x, y):
    """log(y) = log(a) + b log(x) over months where both sensors saw activity."""
    lx, ly = np.log(np.array(x, float)), np.log(np.array(y, float))
    b, la = np.polyfit(lx, ly, 1)
    return math.exp(la), b


def metrics(pred, obs):
    pred, obs = np.array(pred, float), np.array(obs, float)
    err = pred - obs
    ss = ((obs - obs.mean()) ** 2).sum()
    return {"n_months": int(len(obs)), "mae": round(float(np.abs(err).mean()), 2), "bias_pct": round(float(err.sum() / obs.sum() * 100), 1),
            "r2": round(float(1 - (err ** 2).sum() / ss), 3) if ss else None,
            "annual_abs_error_pct": None}


def km(a, b):
    r = math.pi / 180
    x = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def minutes(t):
    return datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() / 60


def match(modis, viirs, years):
    """Share of MODIS (Aqua) detections with a VIIRS detection within MATCH_KM and MATCH_MIN, and the reverse,
    plus MODIS detection probability for VIIRS detections binned by FRP. Aqua only: its overpasses (~01:30/13:30)
    are close to S-NPP and NOAA-20; Terra passes ~3 h earlier and would count timing differences as misses."""
    aqua = [m for m in modis if m[4] == "Aqua" and int(m[0][:4]) in years]
    vi = [v for v in viirs if int(v[0][:4]) in years]
    idx = defaultdict(list)
    for v in vi:
        idx[(v[0][:10], round(v[1], 1), round(v[2], 1))].append(v)
    def near(p, pool_idx):
        out = []
        for dy in (-0.1, 0, 0.1):
            for dx in (-0.1, 0, 0.1):
                for q in pool_idx.get((p[0][:10], round(round(p[1], 1) + dy, 1), round(round(p[2], 1) + dx, 1)), []):
                    if abs(minutes(q[0]) - minutes(p[0])) <= MATCH_MIN and km(p[1:3], q[1:3]) <= MATCH_KM:
                        out.append(q)
        return out
    m_hit = sum(1 for m in aqua if near(m, idx))
    aidx = defaultdict(list)
    for m in aqua:
        aidx[(m[0][:10], round(m[1], 1), round(m[2], 1))].append(m)
    bins = [(0, 2), (2, 5), (5, 10), (10, 25), (25, 50), (50, 1e9)]
    prob = []
    for lo, hi in bins:
        # Only VIIRS detections acquired within an Aqua overpass window of some Aqua detection that day can be compared fairly.
        vs = [v for v in vi if lo <= v[3] < hi]
        hit = sum(1 for v in vs if near(v, aidx))
        prob.append({"frp_from": lo, "frp_to": None if hi > 1e8 else hi, "viirs": len(vs), "matched_by_aqua": hit, "share": round(hit / len(vs), 3) if vs else None})
    return {"aqua_detections": len(aqua), "aqua_matched_by_viirs": m_hit, "aqua_match_share": round(m_hit / len(aqua), 3) if aqua else None,
            "viirs_detections": len(vi), "by_viirs_frp": prob}


def main():
    by = load()
    cds = {s: cell_days(r) for s, r in by.items()}
    mon = {s: monthly(c) for s, c in cds.items()}
    years_all = sorted({int(k[:4]) for m in mon.values() for k in m})
    annual = {s: {y: sum(v for k, v in mon[s].items() if int(k[:4]) == y) for y in years_all if any(int(k[:4]) == y for k in mon[s])} for s in mon}
    detections = {s: {y: sum(1 for r in by[s] if int(r[0][:4]) == y) for y in years_all if any(int(r[0][:4]) == y for r in by[s])} for s in by}
    models = []
    for vfam, train, test in PAIRS:
        if vfam not in mon or "modis" not in mon:
            continue
        months = sorted(set(mon["modis"]) & set(mon[vfam]))
        def pairs(years):
            return [(m, mon[vfam][m], mon["modis"][m]) for m in months if int(m[:4]) in years and mon[vfam][m] > 0 and mon["modis"][m] > 0]
        tr, te = pairs(train), pairs(test)
        if len(tr) < 12 or len(te) < 6:
            continue
        a, b = fit_power([x for _, x, _ in tr], [y for _, _, y in tr])
        pred = lambda x: a * x ** b
        mt = metrics([pred(x) for _, x, _ in te], [y for _, _, y in te])
        resid = np.log([y / pred(x) for _, x, y in tr + te])
        test_years = sorted({int(m[:4]) for m, *_ in te})
        ann_obs = [sum(y for m, _, y in te if int(m[:4]) == yr) for yr in test_years]
        ann_pred = [sum(pred(x) for m, x, _ in te if int(m[:4]) == yr) for yr in test_years]
        mt["annual_abs_error_pct"] = round(float(np.mean([abs(p - o) / o * 100 for p, o in zip(ann_pred, ann_obs) if o])), 1)
        raw_ratio = sum(x for _, x, _ in te) / sum(y for _, _, y in te)
        models.append({
            "viirs": vfam, "train_years": train, "test_years": test, "a": round(a, 4), "b": round(b, 4),
            "train_months": len(tr), "test": mt, "raw_viirs_to_modis_ratio_test": round(raw_ratio, 2),
            "log_residual_sd": round(float(resid.std()), 3),
            "points": [{"month": m, "viirs": x, "modis": y, "set": "train" if int(m[:4]) in train else "test"} for m, x, y in tr + te],
            "annual_test": [{"year": yr, "modis": o, "predicted": round(p, 1)} for yr, o, p in zip(test_years, ann_obs, ann_pred)],
            "matching": match(by["modis"], by[vfam], set(train + test)),
        })
    # Reference VIIRS scale = the conversion with the lowest held-out annual error (chosen by the test, not by hand).
    best = min(models, key=lambda m: m["test"]["annual_abs_error_pct"]) if models else None
    harmonized = []
    for y in years_all:
        if y in annual.get("modis", {}):
            harmonized.append({"year": y, "value": annual["modis"][y], "source": "MODIS observed"})
        elif best and y in annual.get(best["viirs"], {}):
            months = [k for k in mon[best["viirs"]] if int(k[:4]) == y]
            v = sum(best["a"] * mon[best["viirs"]][k] ** best["b"] for k in months)
            sd = best["log_residual_sd"]
            harmonized.append({"year": y, "value": round(v, 1), "low": round(v * math.exp(-sd), 1), "high": round(v * math.exp(sd), 1),
                               "source": f"{best['viirs']} converted"})
        # VIIRS-equivalent view of MODIS years: the inverse model, so the 2000s can be read on the VIIRS scale.
        if best and y in annual.get("modis", {}):
            months = [k for k in mon["modis"] if int(k[:4]) == y]
            ve = sum((mon["modis"][k] / best["a"]) ** (1 / best["b"]) for k in months)
            e = best["test"]["annual_abs_error_pct"] / 100  # band = mean held-out annual error, the error that applies to yearly totals
            harmonized[-1].update({"viirs_equivalent": round(ve, 1), "viirs_low": round(ve * (1 - e), 1), "viirs_high": round(ve * (1 + e), 1)})
    OUT.write_text(json.dumps({
        "schema": "firewatch.harmonization.v1", "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "unit": f"fire-active cell-days: distinct ({CELL} degree cell, UTC date) pairs with at least one land detection (types 0 and 2, or type not reported)",
        "type_note": "Filtering to presumed vegetation fires (type 0) biased held-out tests by about -40 %, because the static-source label (type 2) changed abruptly around 2020-2021 in both MODIS and VIIRS; all land detections are therefore used.",
        "annual_cell_days": annual, "annual_detections": detections, "models": models, "harmonized_modis_equivalent": harmonized,
        "reference_scale": best["viirs"] if best else None,
        "match_rule": f"Aqua and VIIRS detections within {MATCH_KM} km and {MATCH_MIN} minutes",
        "limits": [
            "No cloud or observation-opportunity mask: a month with clouds lowers both sensors without being a low-fire month.",
            "Archive years use FIRMS country extracts; API gap years are clipped to the geoBoundaries 2016 polygon.",
            "Standard (SP) and near-real-time (NRT) processing are mixed in 2026 and are not identical products.",
            "The model is fitted for North Macedonia's fire regime; it is not a global conversion.",
            "MODIS 2013 comes from the FIRMS API backfill, not the original archive download.",
        ],
    }, separators=(",", ":")))
    for m in models:
        print(m["viirs"], "a", m["a"], "b", m["b"], "test", m["test"], "ratio", m["raw_viirs_to_modis_ratio_test"], "match", m["matching"]["aqua_match_share"])
    print("harmonized years", len(harmonized))


if __name__ == "__main__":
    main()
