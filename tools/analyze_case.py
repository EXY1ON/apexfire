"""Measure observable change in the downloaded Serta case; no spread prediction."""

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import BoundaryNorm, ListedColormap
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.warp import Resampling, reproject, transform, transform_geom
from shapely.geometry import Point, shape


ROOT = Path(__file__).resolve().parents[1]
CASE = ROOT / "Data" / "case-studies" / "serta-2024"
OUT = ROOT / "docs" / "case-studies" / "serta-2024"
DATES = ["2024-07-06", "2024-07-16", "2024-07-26"]
COVER = {10: "Tree cover", 20: "Shrubland", 30: "Grassland", 40: "Cropland", 50: "Built-up", 60: "Bare/sparse", 70: "Snow/ice", 80: "Water", 90: "Wetland", 95: "Mangroves", 100: "Moss/lichen"}


def clear_land(qa):
    return (qa != 255) & ((qa & 62) == 0) & ((qa >> 6) != 3)


def nbr(nir, swir, valid):
    denominator = nir.astype(float) + swir
    result = np.full(nir.shape, np.nan, dtype="float32")
    usable = valid & (nir >= 0) & (swir >= 0) & (denominator > 0)
    np.divide(nir.astype(float) - swir, denominator, out=result, where=usable)
    return result


def aligned(path, profile, method):
    with rasterio.open(path) as source:
        result = np.full((profile["height"], profile["width"]), np.nan, dtype="float32")
        reproject(rasterio.band(source, 1), result, src_transform=source.transform, src_crs=source.crs, src_nodata=source.nodata, dst_transform=profile["transform"], dst_crs=profile["crs"], dst_nodata=np.nan, resampling=method)
    return result


def write_raster(path, data, profile):
    output = profile.copy()
    output.update(dtype="float32", count=1, nodata=-9999, compress="deflate")
    with rasterio.open(path, "w", **output) as destination:
        destination.write(np.where(np.isfinite(data), data, -9999).astype("float32"), 1)


def main():
    assert clear_land(np.array([0, 64, 128, 192, 2, 4, 8, 16, 32, 255], dtype="uint8")).tolist() == [True, True, True, False, False, False, False, False, False, False]
    np.testing.assert_allclose(nbr(np.array([3, 0, -9999]), np.array([1, 0, 1]), np.ones(3, dtype=bool)), [0.5, np.nan, np.nan], equal_nan=True)
    OUT.mkdir(parents=True, exist_ok=True)
    derived = CASE / "derived"
    derived.mkdir(exist_ok=True)
    reference = json.loads((CASE / "reference/gdacs-1020198-episode-9.geojson").read_text())
    polygons = [f["geometry"] for f in reference["features"] if f["geometry"]["type"] in ("Polygon", "MultiPolygon")]
    assert len(polygons) == 1
    with rasterio.open(CASE / "hls" / f"{DATES[0]}-b8a.tif") as source:
        profile = source.profile.copy()
    assert profile["crs"].to_epsg() == 32634
    utm_geometry = transform_geom("EPSG:4326", profile["crs"], polygons[0])
    polygon = shape(utm_geometry)
    assert polygon.is_valid and not polygon.is_empty
    assert shape(polygons[0]).within(shape({"type": "Polygon", "coordinates": [[[22.04,41.46],[22.26,41.46],[22.26,41.67],[22.04,41.67],[22.04,41.46]]]}))
    inside = geometry_mask([utm_geometry], out_shape=(profile["height"], profile["width"]), transform=profile["transform"], invert=True)
    pixel_ha = abs(profile["transform"].a * profile["transform"].e) / 10000
    indices, rgbs, quality = {}, {}, {}
    stats = {"reference": {"gdacs_event": 1020198, "episode": 9, "reported_ha": 7028, "utm_polygon_ha": polygon.area / 10000, "rasterized_ha": int(inside.sum()) * pixel_ha, "valid_geometry": True}, "dates": {}}
    for date in DATES:
        bands = {}
        for name in ["b02", "b03", "b04", "b8a", "b12", "fmask"]:
            with rasterio.open(CASE / "hls" / f"{date}-{name}.tif") as source:
                assert source.transform == profile["transform"] and source.shape == inside.shape and source.crs == profile["crs"]
                bands[name] = source.read(1)
        valid = clear_land(bands["fmask"])
        indices[date] = nbr(bands["b8a"], bands["b12"], valid)
        quality[date] = np.isfinite(indices[date])
        rgb = np.stack([bands[name] for name in ["b04", "b03", "b02"]], axis=-1).astype(float) * 0.0001
        rgb = np.clip(rgb / 0.30, 0, 1) ** (1 / 1.5)
        rgb[~valid] = [0.65, 0.65, 0.65]
        rgbs[date] = rgb
        stats["dates"][date] = {"valid_fraction_aoi": float(quality[date].mean()), "valid_fraction_reference": float(quality[date][inside].mean()), "median_nbr_reference": float(np.nanmedian(indices[date][inside]))}
        write_raster(derived / f"{date}-nbr.tif", indices[date], profile)
    change = indices[DATES[0]] - indices[DATES[-1]]
    common = np.isfinite(change)
    write_raster(derived / "dnbr-july06-july26.tif", change, profile)
    stats["change"] = {"joint_valid_fraction_reference": float(common[inside].mean()), "joint_valid_reference_ha": int((common & inside).sum()) * pixel_ha, "median_dnbr_reference": float(np.nanmedian(change[inside])), "median_dnbr_outside_reference": float(np.nanmedian(change[~inside])), "threshold_sensitivity": {}}
    for threshold in [0.1, 0.2, 0.3]:
        marked = common & (change >= threshold)
        union = common & (inside | marked)
        stats["change"]["threshold_sensitivity"][str(threshold)] = {"change_ha_aoi": int(marked.sum()) * pixel_ha, "change_ha_inside_reference": int((marked & inside).sum()) * pixel_ha, "fraction_of_valid_reference": float(marked[inside & common].mean()), "intersection_over_union_valid_pixels": float((marked & inside).sum() / union.sum())}
    dem = aligned(CASE / "terrain/nasadem-elevation.tif", profile, Resampling.bilinear)
    cover = aligned(CASE / "land-cover/worldcover-2021-map.tif", profile, Resampling.nearest)
    dy, dx = np.gradient(dem, 30, 30)
    slope = np.degrees(np.arctan(np.hypot(dx, dy)))
    stats["terrain"] = {"reference_elevation_min_m": float(np.nanmin(dem[inside])), "reference_elevation_max_m": float(np.nanmax(dem[inside])), "reference_slope_median_degrees": float(np.nanmedian(slope[inside]))}
    stats["land_cover"] = {COVER[int(value)]: {"sampled_30m_ha": int(np.sum(inside & (cover == value))) * pixel_ha, "fraction": float(np.mean(cover[inside] == value))} for value in np.unique(cover[inside & np.isfinite(cover)])}
    for name, array in [("elevation-utm30m", dem), ("slope-degrees-utm30m", slope), ("land-cover-utm30m", cover)]:
        write_raster(derived / f"{name}.tif", array, profile)
    rows, counts = [], Counter()
    daily = defaultdict(Counter)
    for family in ["modis", "viirs-jpss1", "viirs-snpp"]:
        paths = list((ROOT / "Data").glob(f"{family}*/2024/{family}_2024_Macedonia_Former_Yugoslav_Republic_of.csv"))
        assert len(paths) == 1
        for row in csv.DictReader(paths[0].open()):
            lon, lat = float(row["longitude"]), float(row["latitude"])
            if not (22.04 <= lon <= 22.26 and 41.46 <= lat <= 41.67 and "2024-07-01" <= row["acq_date"] <= "2024-07-31"):
                continue
            x, y = transform("EPSG:4326", profile["crs"], [lon], [lat])
            within = polygon.covers(Point(x[0], y[0]))
            row.update(family=family, source_path=str(paths[0].relative_to(ROOT)), inside_reference=str(within), easting=x[0], northing=y[0])
            rows.append(row)
            if within and "2024-07-10" <= row["acq_date"] <= "2024-07-20":
                counts[family] += 1
            daily[row["acq_date"]][family] += 1
    fields = list(dict.fromkeys(k for row in rows for k in row))
    with (derived / "firms-july-aoi.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields); writer.writeheader(); writer.writerows(rows)
    stats["firms"] = {"july_aoi_records": len(rows), "july10_20_inside_reference": dict(counts), "aoi_daily": dict(sorted(daily.items()))}
    episodes = []
    for path in sorted((CASE / "reference").glob("*.geojson"), key=lambda p: int(p.stem.rsplit("-", 1)[-1])):
        data = json.loads(path.read_text())
        feature = next(f for f in data["features"] if f["geometry"]["type"] in ("Polygon", "MultiPolygon"))
        episodes.append({"episode": int(path.stem.rsplit("-", 1)[-1]), "fromdate": feature["properties"].get("fromdate"), "todate": feature["properties"].get("todate"), "reported_ha": feature["properties"].get("severity"), "polygon_ha_utm": shape(transform_geom("EPSG:4326", profile["crs"], feature["geometry"])).area / 10000})
    stats["gdacs_snapshots"] = episodes
    stats["methods"] = {"qa": "Reject Fmask fill255, cloud/adjacency/shadow/snow/water bits1-5 and high aerosol class3; NIR/SWIR nonnegative and positive denominator", "nbr": "(S30 B8A - B12)/(B8A + B12); dNBR=July6 minus July26; no severity/causal calibration", "cover": "WorldCover2021 nearest-neighbour sampled to30m HLS grid; areas approximate, not fuel models", "comparison": "GDACS polygon is a satellite-derived reference, not independent ground truth; IOU restricted to joint-valid pixels", "terrain": "NASADEM bilinear to30m UTM, central-difference slope; approximate terrain context", "snapshots": "Episode date ranges are detection ranges, not guaranteed perimeter-acquisition times; no spread speed inferred"}
    (OUT / "metrics.json").write_text(json.dumps(stats, indent=2) + "\n")
    extent = [profile["transform"].c/1000, (profile["transform"].c+profile["width"]*30)/1000, (profile["transform"].f-profile["height"]*30)/1000, profile["transform"].f/1000]
    fig, axes = plt.subplots(2, 3, figsize=(15, 11), constrained_layout=True)
    for ax, date in zip(axes[0], DATES):
        ax.imshow(rgbs[date], extent=extent)
        ax.set_title(f"HLS Sentinel-2: {date}\n{stats['dates'][date]['valid_fraction_reference']:.0%} usable inside reference")
    im=axes[1,0].imshow(change,extent=extent,cmap="RdYlBu_r",vmin=-0.3,vmax=0.8)
    axes[1,0].set_title("Observed NBR change: July 6 to 26\nPositive values suggest vegetation loss / burning")
    fig.colorbar(im,ax=axes[1,0],shrink=0.7,label="dNBR (unitless; uncalibrated)")
    palette=["#006400","#ffbb22","#ffff4c","#f096ff","#fa0000","#b4b4b4","#f0f0f0","#0064c8","#0096a0","#00cf75","#fae6a0"]
    codes=list(COVER)
    classified=np.full(cover.shape,np.nan)
    for index,code in enumerate(codes): classified[cover==code]=index
    axes[1,1].imshow(classified,extent=extent,cmap=ListedColormap(palette),norm=BoundaryNorm(np.arange(-0.5,11.5),11))
    axes[1,1].set_title("ESA WorldCover 2021\nLand-cover context; not a fire-behaviour fuel map")
    from matplotlib.patches import Patch
    axes[1,1].legend(handles=[Patch(color=palette[codes.index(code)],label=COVER[code]) for code in codes if COVER[code] in stats['land_cover']],loc="lower left",fontsize=7,framealpha=0.85)
    im=axes[1,2].imshow(dem,extent=extent,cmap="terrain")
    axes[1,2].set_title("NASADEM elevation\nTerrain acquired in 2000")
    fig.colorbar(im,ax=axes[1,2],shrink=0.7,label="Elevation (m)")
    parts=list(polygon.geoms) if polygon.geom_type=="MultiPolygon" else [polygon]
    for ax in axes.flat:
        for part in parts:
            x,y=part.exterior.xy; ax.plot(np.array(x)/1000,np.array(y)/1000,color="white",lw=0.8)
        ax.set_xlabel("UTM 34N easting (km)"); ax.set_ylabel("Northing (km)")
    fig.suptitle("Šerta / Negotino — July 2024 evidence test\nWhite outline: GDACS event 1020198 (one part of the wider complex); grey imagery pixels excluded by QA",fontsize=14)
    fig.savefig(OUT / "evidence-overview.png",dpi=170)
    plt.close(fig)
    print(json.dumps({k:v for k,v in stats.items() if k not in ['firms','methods','gdacs_snapshots']},indent=2))
    print('FIRMS event-window detections:',dict(counts))


if __name__ == "__main__":
    main()
