"""Inventory FIRMS CSV downloads without changing them; fully inspect Macedonia rows."""

import csv
import hashlib
import io
import json
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COUNTRY = "Macedonia_Former_Yugoslav_Republic_of"


def archive_paths(data_root):
    return sorted(path for pattern in ("modis*/*/*.csv", "viirs*/*/*.csv") for path in data_root.glob(pattern))


def count_records(newlines, final_byte, size):
    return max(0, newlines + int(size > 0 and final_byte != b"\n") - 1)


def inspect_file(path):
    digest = hashlib.sha256()
    newlines = quotes = blank_lines = 0
    first = tail = previous = b""
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
            newlines += chunk.count(b"\n")
            quotes += chunk.count(b'"')
            joined = previous + chunk
            blank_lines += joined.count(b"\n\n") + joined.count(b"\r\n\r\n")
            previous = chunk[-3:]
            if not first:
                first = chunk
            tail = chunk[-16384:]
    if quotes or blank_lines:
        raise ValueError(f"Line-count assumption invalid: {path}, quotes={quotes}, blanks={blank_lines}")
    first_rows = list(csv.reader(io.StringIO(first.decode("utf-8-sig"))))[:4]
    last_rows = list(csv.reader(io.StringIO(tail.decode("utf-8").split("\n", 1)[-1])))
    last_rows = [row for row in last_rows if row]
    header = first_rows[0]
    assert len(header) == 15, path
    samples = first_rows[1:4] + last_rows[-3:]
    for row in samples:
        assert len(row) == len(header), (path, row)
    size = path.stat().st_size
    family = "modis" if path.name.startswith("modis_") else "viirs-jpss1" if path.name.startswith("viirs-jpss1_") else "viirs-snpp"
    year = int(path.parent.name)
    prefix = f"{family}_{year}_"
    assert path.name.startswith(prefix), path
    return {
        "path": str(path.relative_to(ROOT)), "family": family, "year": year,
        "country": path.stem[len(prefix):], "bytes": size,
        "records": count_records(newlines, tail[-1:], size), "sha256": digest.hexdigest(),
        "header": ",".join(header),
        "sample_dates": ";".join(sorted({row[5] for row in samples})),
        "sample_satellites": ";".join(sorted({row[7] for row in samples})),
        "sample_versions": ";".join(sorted({row[10] for row in samples})),
    }


def inspect_macedonia(path):
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
    dates = [row["acq_date"] for row in rows]
    keys = [tuple(row.values()) for row in rows]
    invalid = Counter()
    for row in rows:
        try:
            stamp = date.fromisoformat(row["acq_date"])
            latitude, longitude, frp = (float(row[k]) for k in ("latitude", "longitude", "frp"))
            time = row["acq_time"].zfill(4)
            assert stamp.year == int(path.parent.name)
            assert -90 <= latitude <= 90 and -180 <= longitude <= 180
            assert len(time) == 4 and 0 <= int(time[:2]) < 24 and 0 <= int(time[2:]) < 60
            assert frp >= 0
            assert row["daynight"] in ("D", "N")
        except (ValueError, TypeError, AssertionError):
            invalid["invalid_core_fields"] += 1
    return {
        "path": str(path.relative_to(ROOT)), "year": int(path.parent.name), "records": len(rows),
        "date_min": min(dates, default=None), "date_max": max(dates, default=None),
        "dates_sorted": dates == sorted(dates), "exact_duplicate_rows": len(keys) - len(set(keys)),
        "latitude_range": [min(float(r["latitude"]) for r in rows), max(float(r["latitude"]) for r in rows)] if rows else [],
        "longitude_range": [min(float(r["longitude"]) for r in rows), max(float(r["longitude"]) for r in rows)] if rows else [],
        "invalid": dict(invalid),
        **{key: dict(Counter(row[key] for row in rows)) for key in ("satellite", "instrument", "version", "confidence", "type", "daynight")},
        "monthly_records": dict(sorted(Counter(stamp[:7] for stamp in dates).items())),
    }


def main():
    assert count_records(2, b"\n", 12) == 1
    assert count_records(1, b"x", 11) == 1
    assert count_records(1, b"\n", 6) == 0
    paths = archive_paths(ROOT / "Data")
    output = ROOT / "docs" / "data-audit"
    output.mkdir(parents=True, exist_ok=True)
    inventory = []
    for index, path in enumerate(paths, 1):
        inventory.append(inspect_file(path))
        if index % 500 == 0:
            print(f"Inspected {index}/{len(paths)} files", flush=True)
    groups = defaultdict(list)
    for item in inventory:
        groups[item["family"]].append(item)
    summary = {}
    for family, items in groups.items():
        years = sorted({item["year"] for item in items})
        summary[family] = {
            "files": len(items), "bytes": sum(item["bytes"] for item in items),
            "records": sum(item["records"] for item in items), "years": years,
            "missing_internal_years": sorted(set(range(min(years), max(years) + 1)) - set(years)),
            "country_labels": len({item["country"] for item in items}),
            "sample_versions": sorted({v for item in items for v in item["sample_versions"].split(";") if v}),
            "sample_satellites": sorted({s for item in items for s in item["sample_satellites"].split(";") if s}),
            "per_year": {str(year): {
                "files": sum(item["year"] == year for item in items),
                "records": sum(item["records"] for item in items if item["year"] == year),
            } for year in years},
        }
    with (output / "file-inventory.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(inventory[0]))
        writer.writeheader()
        writer.writerows(inventory)
    macedonia = [inspect_macedonia(path) for path in paths if path.name.endswith(f"_{COUNTRY}.csv")]
    by_hash = defaultdict(list)
    for item in inventory:
        by_hash[item["sha256"]].append(item["path"])
    result = {
        "method": "Every CSV: bytes, SHA256, line count (no quotes/blank lines), 15-column header, up to six boundary rows. Every Macedonia CSV: full CSV parse, core field checks, dates, categories and exact duplicates. Sample fields do not establish global minimum/maximum dates or exhaustive categories. No full global row-level validation or cross-file event deduplication.",
        "families": summary, "macedonia": macedonia,
        "identical_file_groups": [items for items in by_hash.values() if len(items) > 1],
    }
    (output / "audit-summary.json").write_text(json.dumps(result, indent=2) + "\n")
    assert len(inventory) == sum(group["files"] for group in summary.values())
    assert all(item["records"] == next(record["records"] for record in inventory if record["path"] == item["path"]) for item in macedonia)
    print(json.dumps(summary, indent=2), flush=True)
    print("Macedonia records:", sum(item["records"] for item in macedonia))
    print("Invalid Macedonia core fields:", sum(sum(item["invalid"].values()) for item in macedonia))


if __name__ == "__main__":
    main()
