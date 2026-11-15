"""Measure what the bounded Mariovo satellite data can support; no spread model."""

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import BoundaryNorm, ListedColormap
from matplotlib.patches import Patch
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.warp import Resampling, transform, transform_geom
from shapely.geometry import Point, shape

from analyze_case import COVER, aligned, clear_land, nbr, write_raster


ROOT = Path(__file__).resolve().parents[1]
CASE = ROOT / "Data" / "case-studies" / "mariovo-2024"
OUT = ROOT / "docs" / "case-studies" / "mariovo-2024"
DATES = ["2024-08-23", "2024-09-02", "2024-09-12"]
WORLD_COVER_COLORS = ["#006400", "#ffbb22", "#ffff4c", "#f096ff", "#fa0000", "#b4b4b4", "#f0f0f0", "#0064c8", "#0096a0", "#00cf75", "#fae6a0"]
REPORTED_AREA_HA = 10265
EVENT_DOY = (245, 251)


def main():
    assert clear_land(np.array([0, 64, 128, 192, 2, 4, 8, 16, 32, 255], dtype="uint8")).tolist() == [True, True, True, False, False, False, False, False, False, False]
    np.testing.assert_allclose(nbr(np.array([3, 0, -9999]), np.array([1, 0, 1]), np.ones(3, dtype=bool)), [0.5, np.nan, np.nan], equal_nan=True)
    OUT.mkdir(parents=True, exist_ok=True)
    derived = CASE / "derived"
    derived.mkdir(exist_ok=True)

    reference = json.loads((CASE / "reference" / "effis-mariovo-2024-09.geojson").read_text())
    assert reference["type"] == "Feature" and reference["geometry"]["type"] == "MultiPolygon"
    assert reference["properties"]["source"] == "EFFIS / Copernicus EMS (CC BY 4.0)"
    with rasterio.open(CASE / "hls" / f"2024-08-23-b8a.tif") as src:
        profile = src.profile.copy()
    assert profile["crs"].to_epsg() == 32634
    utm_geometry = transform_geom("EPSG:4326", profile["crs"], reference["geometry"])
    polygon = shape(utm_geometry)
    assert polygon.is_valid and not polygon.is_empty
    inside = geometry_mask([utm_geometry], out_shape=(profile["height"], profile["width"]), transform=profile["transform"], invert=True)
    pixel_ha = abs(profile["transform"].a * profile["transform"].e) / 10000

    nbrs, rgbs, hls_stats = {}, {}, {}
    for date in DATES:
        bands = {}
        for name in ["b02", "b03", "b04", "b8a", "b12", "fmask"]:
            with rasterio.open(CASE / "hls" / f"{date}-{name}.tif") as src:
                assert src.transform == profile["transform"] and src.shape == inside.shape and src.crs == profile["crs"]
                bands[name] = src.read(1)
        valid = clear_land(bands["fmask"])
        fmask_valid = (bands["fmask"] != 255) & ((bands["fmask"] & 62) == 0)
        high_aerosol = (bands["fmask"] >> 6) == 3
        nbrs[date] = nbr(bands["b8a"], bands["b12"], valid)
        rgb = np.stack([bands[name] for name in ["b04", "b03", "b02"]], axis=-1).astype(float) * 0.0001
        rgb = np.clip(rgb / 0.30, 0, 1) ** (1 / 1.5)
        rgb[~valid] = [0.65, 0.65, 0.65]
        rgbs[date] = rgb
        hls_stats[date] = {
            "strict_usable_fraction_of_perimeter": float(np.isfinite(nbrs[date][inside]).mean()),
            "fmask_clear_fraction_before_aerosol_filter_of_perimeter": float(fmask_valid[inside].mean()),
            "high_aerosol_fraction_of_perimeter": float(high_aerosol[inside].mean()),
            "strict_usable_fraction_of_crop": float(np.isfinite(nbrs[date]).mean()),
            "median_nbr_in_perimeter": float(np.nanmedian(nbrs[date][inside])),
            "cloud_cover_metadata_percent_whole_tile": None,
        }
        for metadata_path in (CASE / "metadata").glob("HLS.S30.T34TEL.*.json"):
            metadata = json.loads(metadata_path.read_text())
            if metadata["properties"].get("datetime", "").startswith(date):
                hls_stats[date]["cloud_cover_metadata_percent_whole_tile"] = metadata["properties"].get("eo:cloud_cover")
                break
        write_raster(derived / f"{date}-nbr.tif", nbrs[date], profile)

    change = nbrs[DATES[0]] - nbrs[DATES[-1]]
    common = np.isfinite(change)
    write_raster(derived / "dnbr-aug23-sep12.tif", change, profile)
    change_stats = {
        "joint_clear_fraction_of_perimeter": float(common[inside].mean()),
        "joint_clear_area_in_perimeter_ha": float((common & inside).sum()) * pixel_ha,
        "median_dnbr_in_perimeter": float(np.nanmedian(change[inside])),
        "median_dnbr_outside_perimeter_in_crop": float(np.nanmedian(change[~inside])),
        "threshold_sensitivity": {},
    }
    for threshold in [0.1, 0.2, 0.3]:
        marked = common & (change >= threshold)
        change_stats["threshold_sensitivity"][str(threshold)] = {
            "fraction_of_joint_clear_perimeter_pixels": float(marked[inside].sum() / common[inside].sum()),
            "area_inside_perimeter_ha": float((marked & inside).sum()) * pixel_ha,
            "area_outside_perimeter_in_crop_ha": float((marked & ~inside).sum()) * pixel_ha,
        }

    dem = aligned(CASE / "terrain" / "nasadem-elevation.tif", profile, Resampling.bilinear)
    cover = aligned(CASE / "land-cover" / "worldcover-2021-map.tif", profile, Resampling.nearest)
    dy, dx = np.gradient(dem, 30, 30)
    slope = np.degrees(np.arctan(np.hypot(dx, dy)))
    write_raster(derived / "elevation-utm30m.tif", dem, profile)
    write_raster(derived / "slope-degrees-utm30m.tif", slope, profile)
    write_raster(derived / "land-cover-utm30m.tif", cover, profile)
    land_cover = {
        COVER[int(code)]: {
            "approx_area_ha_on_30m_grid": int(np.sum(inside & (cover == code))) * pixel_ha,
            "fraction_of_perimeter": float(np.sum(inside & (cover == code)) / inside.sum()),
        }
        for code in np.unique(cover[inside & np.isfinite(cover)])
    }

    with rasterio.open(CASE / "burned-area" / "2024-09-burn_date.tif") as src:
        burn_date = src.read(1)
        modis_profile = src.profile.copy()
    with rasterio.open(CASE / "burned-area" / "2024-09-qa.tif") as src:
        qa = src.read(1)
        qa_nodata = src.nodata
        assert src.transform == modis_profile["transform"] and src.shape == burn_date.shape and src.crs == modis_profile["crs"]
    modis_geometry = transform_geom("EPSG:4326", modis_profile["crs"], reference["geometry"])
    modis_inside = geometry_mask([modis_geometry], out_shape=burn_date.shape, transform=modis_profile["transform"], invert=True)
    modis_valid = ((qa & 2) != 0) & ((qa != qa_nodata) if qa_nodata is not None else True)
    fire_window = (burn_date >= EVENT_DOY[0]) & (burn_date <= EVENT_DOY[1])
    modis_pixel_ha = abs(modis_profile["transform"].a * modis_profile["transform"].e) / 10000
    modis_days = Counter(int(value) for value in burn_date[modis_inside & modis_valid & fire_window])
    modis_stats = {
        "native_grid_resolution_m": [abs(modis_profile["transform"].a), abs(modis_profile["transform"].e)],
        "valid_qa_fraction_of_perimeter": float(modis_valid[modis_inside].mean()),
        "valid_burned_pixels_in_1_to_7_sep_window": int(np.sum(modis_inside & modis_valid & fire_window)),
        "approx_area_ha_from_500m_cells_in_1_to_7_sep_window": float(np.sum(modis_inside & modis_valid & fire_window)) * modis_pixel_ha,
        "burned_pixel_counts_by_day_of_year": dict(sorted(modis_days.items())),
        "nominal_cell_area_ha": modis_pixel_ha,
    }

    weather_package = json.loads((CASE / "weather" / "open-meteo-ecmwf-ifs-historical-forecast-2024-09-01_07.json").read_text())
    weather = weather_package["data"]["hourly"]
    wind_speed = np.asarray(weather["wind_speed_10m"], dtype=float)
    wind_direction = np.deg2rad(np.asarray(weather["wind_direction_10m"], dtype=float))
    direction_mean_from = np.degrees(np.arctan2(np.sin(wind_direction).mean(), np.cos(wind_direction).mean())) % 360
    weather_stats = {
        "provider": weather_package["provider"],
        "product": "Historical Forecast API",
        "model_requested": weather_package["model_requested"],
        "requested_coordinate_wgs84": [41.27, 21.65],
        "model_grid_coordinate_wgs84": [weather_package["data"]["latitude"], weather_package["data"]["longitude"]],
        "model_grid_elevation_m": weather_package["data"]["elevation"],
        "start_utc": weather["time"][0],
        "end_utc": weather["time"][-1],
        "hourly_samples": len(weather["time"]),
        "wind_speed_10m_m_s_min_median_max": [float(np.nanmin(wind_speed)), float(np.nanmedian(wind_speed)), float(np.nanmax(wind_speed))],
        "wind_direction_10m_circular_mean_from_degrees": float(direction_mean_from),
        "wind_gusts_10m_max_m_s": float(np.nanmax(weather["wind_gusts_10m"])),
        "temperature_2m_min_max_c": [float(np.nanmin(weather["temperature_2m"])), float(np.nanmax(weather["temperature_2m"]))],
        "relative_humidity_2m_min_max_percent": [float(np.nanmin(weather["relative_humidity_2m"])), float(np.nanmax(weather["relative_humidity_2m"]))],
        "precipitation_total_mm": float(np.nansum(weather["precipitation"])),
        "interpretation": "Retrospective model forecast context at a snapped grid point; not a local station record, fuel-moisture measure, or fire-spread validation.",
    }

    firms = defaultdict(Counter)
    firms_daily = defaultdict(Counter)
    west, south, east, north = shape(reference["geometry"]).bounds
    for family in ["modis", "viirs-jpss1", "viirs-snpp"]:
        paths = list((ROOT / "Data").glob(f"{family}*/2024/{family}_2024_Macedonia_Former_Yugoslav_Republic_of.csv"))
        assert len(paths) == 1, f"Expected one 2024 Macedonia file for {family}; found {len(paths)}"
        with paths[0].open(newline="") as stream:
            for row in csv.DictReader(stream):
                if not ("2024-09-01" <= row["acq_date"] <= "2024-09-07"):
                    continue
                lon, lat = float(row["longitude"]), float(row["latitude"])
                if not (west <= lon <= east and south <= lat <= north):
                    continue
                x, y = transform("EPSG:4326", profile["crs"], [lon], [lat])
                if polygon.covers(Point(x[0], y[0])):
                    firms[family]["detections"] += 1
                    firms_daily[row["acq_date"]][family] += 1

    source_polygon_area = polygon.area / 10000
    stats = {
        "case": "Mariovo / Prilep, September 2024",
        "reference": {
            "source": reference["properties"]["source"],
            "reported_area_ha": REPORTED_AREA_HA,
            "projected_polygon_area_ha": source_polygon_area,
            "relative_difference_from_reported_area": (source_polygon_area - REPORTED_AREA_HA) / REPORTED_AREA_HA,
            "polygon_parts": len(polygon.geoms),
            "valid_geometry": polygon.is_valid,
        },
        "hls": hls_stats,
        "d_nbr": change_stats,
        "modis_mcd64a1": {**modis_stats, "approx_area_as_fraction_of_effis_reported_area": modis_stats["approx_area_ha_from_500m_cells_in_1_to_7_sep_window"] / REPORTED_AREA_HA},
        "open_meteo_historical_forecast": weather_stats,
        "firms_active_fire_detections_inside_reference_sep1_7": {family: dict(counts) for family, counts in firms.items()},
        "firms_daily_detections_inside_reference_sep1_7": {date: dict(counts) for date, counts in sorted(firms_daily.items())},
        "terrain": {
            "elevation_min_m": float(np.nanmin(dem[inside])),
            "elevation_max_m": float(np.nanmax(dem[inside])),
            "median_slope_degrees": float(np.nanmedian(slope[inside])),
        },
        "worldcover_2021_nearest_sampled_on_30m_grid": land_cover,
        "methods": {
            "hls_qa": "Reject fill 255, Fmask cloud/adjacency/shadow/snow/water bits 1-5, and high-aerosol class 3 in bits 6-7.",
            "nbr": "(S30 B8A - B12)/(B8A + B12); dNBR is 2024-08-23 minus 2024-09-12. Thresholds are sensitivity summaries, not calibrated severity classes.",
            "mcd64a1": "Count valid 500-m cells with burn date DOY 245-251; approximate cell area is not a precise burned-area estimate.",
            "terrain": "NASADEM bilinear-resampled to 30 m; slope from central differences, approximate terrain context.",
            "land_cover": "WorldCover 2021 nearest-resampled to 30 m; descriptive cover, not fuel-model or fuel-moisture data.",
            "firms": "Existing CSV thermal-anomaly detections inside the EFFIS-derived polygon; a detection is not a perimeter or independent ground truth.",
            "reference": "The perimeter is the EFFIS-attributed geometry exposed by WorldFires' public API; it was not independently obtained from the official EFFIS archive.",
            "spread": "No rate-of-spread or future fire-front prediction is estimated.",
        },
    }
    (OUT / "metrics.json").write_text(json.dumps(stats, indent=2) + "\n")

    extent = [profile["transform"].c / 1000, (profile["transform"].c + profile["width"] * 30) / 1000, (profile["transform"].f - profile["height"] * 30) / 1000, profile["transform"].f / 1000]
    fig, axes = plt.subplots(2, 3, figsize=(15, 10), constrained_layout=True)
    for ax, date in zip(axes[0], DATES):
        ax.imshow(rgbs[date], extent=extent)
        ax.set_title(f"HLS Sentinel-2 · {date}\n{hls_stats[date]['strict_usable_fraction_of_perimeter']:.0%} strict usable in perimeter")
    image = axes[1, 0].imshow(change, extent=extent, cmap="RdYlBu_r", vmin=-0.3, vmax=0.8)
    axes[1, 0].set_title("Observed dNBR · 23 Aug to 12 Sep\nPositive change can indicate vegetation loss")
    fig.colorbar(image, ax=axes[1, 0], shrink=0.75, label="dNBR (unitless)")
    codes = list(COVER)
    classified = np.full(cover.shape, np.nan)
    for index, code in enumerate(codes):
        classified[cover == code] = index
    axes[1, 1].imshow(classified, extent=extent, cmap=ListedColormap(WORLD_COVER_COLORS), norm=BoundaryNorm(np.arange(-0.5, 11.5), 11))
    axes[1, 1].set_title("ESA WorldCover 2021\nContext only; not a fuel map")
    axes[1, 1].legend(handles=[Patch(color=WORLD_COVER_COLORS[codes.index(code)], label=name) for code, name in COVER.items() if name in land_cover], loc="lower left", fontsize=7, framealpha=0.85)
    image = axes[1, 2].imshow(dem, extent=extent, cmap="terrain")
    axes[1, 2].set_title("NASADEM elevation · acquired 2000")
    fig.colorbar(image, ax=axes[1, 2], shrink=0.75, label="metres")
    parts = list(polygon.geoms)
    for ax in axes.flat:
        for part in parts:
            x, y = part.exterior.xy
            ax.plot(np.asarray(x) / 1000, np.asarray(y) / 1000, color="white", linewidth=0.8)
        ax.set_xlabel("UTM 34N easting (km)")
        ax.set_ylabel("northing (km)")
    fig.suptitle("Mariovo / Prilep — September 2024 evidence test\nWhite outline: EFFIS-attributed perimeter; masked HLS pixels shown grey", fontsize=14)
    fig.savefig(OUT / "evidence-overview.png", dpi=170)
    plt.close(fig)
    print(json.dumps({key: value for key, value in stats.items() if key != "methods"}, indent=2))


if __name__ == "__main__":
    main()
