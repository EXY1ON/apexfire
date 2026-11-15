"""Bounded, non-operational Pyretechnics experiment; engine arrays use south-first rows."""

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import time

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.features import shapes
from rasterio.warp import transform_geom
from rasterio.warp import transform as transform_coords
from pyretechnics.space_time_cube import SpaceTimeCube
from pyretechnics.eulerian_level_set import SpreadState, spread_fire_with_phi_field
from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from scipy.ndimage import binary_erosion, distance_transform_edt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "Data/readiness/spread-scenario"
CASE = ROOT / "Data/case-studies/mariovo-2024"
MOISTURE = dict(fuel_moisture_dead_1hr=.06, fuel_moisture_dead_10hr=.08,
                fuel_moisture_dead_100hr=.10, fuel_moisture_live_herbaceous=.60,
                fuel_moisture_live_woody=.90, foliar_moisture=1.0)


def propagate(fuel, slope, aspect, wind_kph, wind_from, ignition, minutes=60, cell_m=30):
    """Wind FROM north clockwise; km/h at 10m. Engine y increases northward."""
    fuel = np.asarray(fuel, dtype="float32")
    if fuel.ndim != 2 or not np.isfinite(fuel).all():
        raise ValueError("fuel must be a finite two-dimensional array")
    if not np.isin(fuel, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 91, 92, 93, 98, 99]).all():
        raise ValueError("this bounded runner accepts only Anderson 1–13 or explicit nonburnable models")
    y, x = ignition
    if not (0 <= y < fuel.shape[0] and 0 <= x < fuel.shape[1]) or fuel[y, x] in (91, 92, 93, 98, 99):
        raise ValueError("ignition must be inside a burnable cell")
    wind_kph = np.asarray(wind_kph, dtype="float32").reshape(-1)
    wind_from = np.asarray(wind_from, dtype="float32").reshape(-1)
    if wind_kph.size != wind_from.size or not np.isfinite(wind_kph).all() or not np.isfinite(wind_from).all() or (wind_kph < 0).any():
        raise ValueError("wind must be finite, aligned, and nonnegative")
    bands = wind_kph.size
    cube_shape = (bands, *fuel.shape)
    inputs = dict(slope=slope, aspect=aspect, fuel_model=fuel,
                  canopy_cover=0., canopy_height=0., canopy_base_height=0.,
                  canopy_bulk_density=0., wind_speed_10m=wind_kph,
                  upwind_direction=wind_from, **MOISTURE)
    cubes = {key: SpaceTimeCube(cube_shape, value) for key, value in inputs.items()}
    state = SpreadState(cube_shape).set_resolution((60., cell_m, cell_m)).set_start_time(0.)
    state.ignite_cell(ignition)
    started = time.perf_counter()
    result = spread_fire_with_phi_field(cubes, state, max_duration=float(minutes))
    arrival = result["spread_state"].get_full_matrices()["time_of_arrival"].copy()
    burned = np.isfinite(arrival)
    if not burned.any() or (arrival[burned] < 0).any() or (arrival[burned] > minutes + .01).any():
        raise RuntimeError("invalid arrival times returned by engine")
    return arrival, dict(runtime_seconds=time.perf_counter()-started,
                         stop_time_minutes=result["stop_time"], stop_condition=result["stop_condition"],
                         burned_cells=int(burned.sum()))


def controlled_checks():
    """Check isotropy, both compass axes, and an uncrossed nonburnable barrier."""
    fuel = np.full((101, 101), 1, dtype="float32")
    zero = np.zeros_like(fuel)
    runs = {}
    arrivals = {}
    for name, speed, direction in [("calm", 0., 0.), ("from_west", 15., 270.), ("from_south", 15., 180.)]:
        arrival, stats = propagate(fuel, zero, zero, [speed], [direction], (50, 50), minutes=30)
        ys, xs = np.where(np.isfinite(arrival))
        extents = dict(west=int(50-xs.min()), east=int(xs.max()-50), south=int(50-ys.min()), north=int(ys.max()-50))
        runs[name] = dict(**stats, extents_cells=extents)
        arrivals[name] = arrival
    c, w, s = [runs[k]["extents_cells"] for k in ("calm", "from_west", "from_south")]
    assert runs["calm"]["burned_cells"] > 1
    assert max(c.values()) - min(c.values()) <= 1, c
    assert w["east"] > w["west"] and w["east"] > c["east"], w
    assert s["north"] > s["south"] and s["north"] > c["north"], s
    barrier = fuel.copy()
    barrier[:, 53:56] = 98
    arrival, stats = propagate(barrier, zero, zero, [15.], [270.], (50, 50), minutes=30)
    assert not np.isfinite(arrival[:, 53:]).any(), "nonburnable barrier crossed"
    runs["nonburnable_barrier"] = stats
    return runs


def terrain_fields(elevation, cell_m):
    """Elevation rows increase north; aspect points downhill, clockwise from north."""
    dz_north, dz_east = np.gradient(elevation, cell_m, cell_m)
    return np.hypot(dz_east, dz_north).astype("float32"), ((np.degrees(np.arctan2(-dz_east, -dz_north)) + 360) % 360).astype("float32")


def perimeters(arrival_north_up, profile, start, minutes):
    features = []
    for minute in minutes:
        mask = np.isfinite(arrival_north_up) & (arrival_north_up <= minute)
        polygons = [shape(g) for g, value in shapes(mask.astype("uint8"), mask=mask, transform=profile["transform"]) if value == 1]
        geometry = unary_union(polygons)
        if geometry.is_empty or not geometry.is_valid:
            raise RuntimeError("empty or invalid scenario perimeter")
        features.append(dict(type="Feature", geometry=transform_geom(profile["crs"], "EPSG:4326", mapping(geometry)), properties=dict(
            elapsed_minutes=minute, valid_time_utc=(start+timedelta(minutes=minute)).isoformat(),
            burned_area_ha=geometry.area/10000., kind="experimental_spread_scenario",
            model="Pyretechnics 2026.10.20", calibrated=False)))
    return dict(type="FeatureCollection", features=features)


def run_mariovo(checks):
    fuels_dir = ROOT / "Data/readiness/fuels/mariovo"
    paths = {name: fuels_dir / (name+".tif") for name in ["fuel-model", "elevation", "worldcover"]}
    arrays = {}
    for name, path in paths.items():
        with rasterio.open(path) as src:
            if arrays and (src.shape != arrays["fuel-model"].shape or src.crs != profile["crs"] or src.transform != profile["transform"]):
                raise ValueError("scenario inputs must have identical grids")
            arrays[name] = src.read(1)
            if name == "fuel-model":
                profile = src.profile.copy()
    if profile["crs"].to_epsg() != 32634 or profile["transform"].a != 100 or profile["transform"].e != -100:
        raise ValueError("expected north-up 100m UTM34N inputs")
    elevation = arrays["elevation"].astype("float32")
    valid_terrain = np.isfinite(elevation) & (elevation >= 0)
    if not valid_terrain.any():
        raise ValueError("no valid local elevation")
    # Fill solely for gradient arithmetic; exclude missing terrain and its derivative neighbors.
    nearest = distance_transform_edt(~valid_terrain, return_distances=False, return_indices=True)
    elevation = elevation[tuple(nearest)]
    valid_gradient = binary_erosion(valid_terrain, structure=np.ones((3, 3)), border_value=0)
    raw_fuel = arrays["fuel-model"]
    cover = arrays["worldcover"]
    # Unknown official fuel classes are exclusions, not evidence of nonburnable land.
    excluded = (raw_fuel == 0) | ~np.isin(cover, [10, 20, 30, 40, 90, 95, 100]) | ~valid_gradient
    fuel_north_up = np.where(excluded, 98, raw_fuel).astype("float32")
    ys, xs = np.where(~excluded)
    if not ys.size:
        raise ValueError("no burnable cells")
    # Hypothetical ignition near the AOI center; no observed ignition time/location is asserted.
    target_y, target_x = np.array(raw_fuel.shape)//2
    nearest = np.argmin((ys-target_y)**2+(xs-target_x)**2)
    ignition_north_up = (int(ys[nearest]), int(xs[nearest]))
    ignition_engine = (raw_fuel.shape[0]-1-ignition_north_up[0], ignition_north_up[1])
    fuel = np.flipud(fuel_north_up).copy()
    slope, aspect = terrain_fields(np.flipud(elevation).copy(), 100.)
    weather_path = CASE / "weather/open-meteo-ecmwf-ifs-historical-forecast-2024-09-01_07.json"
    weather = json.loads(weather_path.read_text())
    if weather["data"]["hourly_units"]["wind_speed_10m"] != "m/s" or weather["data"]["utc_offset_seconds"] != 0:
        raise ValueError("expected UTC hourly weather with m/s winds")
    hourly = weather["data"]["hourly"]
    start = datetime(2024, 9, 2, 12, tzinfo=timezone.utc)
    weather_index = hourly["time"].index(start.strftime("%Y-%m-%dT%H:%M"))
    selected = {key: values[weather_index:weather_index+3] for key, values in hourly.items()}
    speed = np.array(selected["wind_speed_10m"])*3.6
    direction = np.array(selected["wind_direction_10m"])
    arrival, stats = propagate(fuel, slope, aspect, speed, direction, ignition_engine, minutes=180, cell_m=100)
    arrival = np.flipud(arrival).copy()
    burned = np.isfinite(arrival)
    if burned[excluded].any():
        raise RuntimeError("engine burned an excluded input cell")
    if burned[[0, -1], :].any() or burned[:, [0, -1]].any():
        raise RuntimeError("scenario reached crop boundary: enlarge crop or shorten horizon")
    if burned.sum() < 2:
        raise RuntimeError("no actual propagation beyond ignition")
    profile.update(dtype="float32", count=1, nodata=-9999., compress="deflate", driver="GTiff")
    with rasterio.open(OUT / "mariovo-arrival-minutes.tif", "w", **profile) as dst:
        dst.write(np.where(burned, arrival, -9999).astype("float32"), 1)
        dst.update_tags(units="minutes since 2024-09-02T12:00:00+00:00", scenario="hypothetical ignition; experimental, not calibrated", attribution="PYRETECHNICS developed by Spatial Informatics Group, LLC and contributors.")
    collection = perimeters(arrival, profile, start, [30, 60, 120, 180])
    (OUT / "mariovo-perimeters.geojson").write_text(json.dumps(collection, indent=2, allow_nan=False)+"\n")
    x, y = rasterio.transform.xy(profile["transform"], *ignition_north_up)
    lon, lat = transform_coords(profile["crs"], "EPSG:4326", [x], [y])
    fig, axes = plt.subplots(1, 2, figsize=(11, 5), constrained_layout=True)
    axes[0].imshow(elevation, cmap="terrain")
    axes[0].imshow(np.ma.masked_where(~excluded, excluded), cmap="Greys", alpha=.35, vmin=0, vmax=1)
    axes[0].set_title("Real NASADEM terrain / excluded cells in gray")
    image = axes[1].imshow(np.ma.masked_invalid(arrival), cmap="inferno_r", vmin=0, vmax=180)
    axes[1].set_title("Modeled arrival time, minutes after assumed ignition")
    burned_y, burned_x = np.where(burned)
    axes[1].set_xlim(burned_x.min()-4, burned_x.max()+4)
    axes[1].set_ylim(burned_y.max()+4, burned_y.min()-4)
    for ax in axes:
        ax.plot(ignition_north_up[1], ignition_north_up[0], "+", color="cyan", markersize=10)
        ax.set_xlabel("Column (100 m cells; east →)")
        ax.set_ylabel("Row (south ↓)")
    fig.colorbar(image, ax=axes[1], label="Arrival minutes")
    fig.suptitle("Mariovo experimental surface-fire scenario — NOT an operational forecast", fontsize=12)
    fig.savefig(OUT / "mariovo-scenario.png", dpi=160, bbox_inches="tight")
    plt.close(fig)
    files = [*paths.values(), weather_path, fuels_dir.parent/"manifest.json"]
    manifest = dict(created_utc=datetime.now(timezone.utc).isoformat(), status="locally verified experimental scenario",
        engine=dict(name="Pyretechnics", version=importlib.metadata.version("pyretechnics"), propagation="Eulerian level set with Rothermel surface behavior", compiled=True),
        environment=dict(python=platform.python_version(), platform=platform.platform(), machine=platform.machine()),
        grid=dict(crs=str(profile["crs"]), shape=list(arrival.shape), transform=list(profile["transform"]), cell_m=100, native_effis_information="coarse original fuel map; 100m alignment adds no observed detail"),
        ignition=dict(kind="hypothetical single-cell ignition nearest grid center", time_utc=start.isoformat(), row_col_north_up=ignition_north_up, longitude=lon[0], latitude=lat[0]),
        weather=dict(source=str(weather_path.relative_to(ROOT)), source_url=weather["source_url"], selected_hours=selected, wind_conversion="m/s × 3.6 → engine km/h at 10m; meteorological FROM degrees unchanged", spatial_assumption="one coarse ECMWF/Open-Meteo grid point held uniformly over domain; hourly forcing, no gust forcing"),
        assumptions=dict(moisture_kg_per_kg=MOISTURE, canopy="all four canopy inputs set to zero: surface-only scenario; no crown fire modeling", spotting=False, suppression=False, fuel="EFFIS official generalized NFFL crosswalk; not contemporary field measurements", exclusions="unclassified fuel=0, WorldCover nonvegetated/unknown, missing terrain and one-cell terrain derivative neighbors treated as barriers; not all are measured nonburnable", terrain_nodata="nearest valid fill only for gradient arithmetic; filled cells and derivative neighbors excluded from propagation", moisture="fixed illustrative dry values; not derived from RH or calibrated", time="historical weather selected for forcing only; hypothetical ignition does not reconstruct this incident"),
        results=dict(**stats, burned_area_ha=float(burned.sum()), perimeter_steps=[30,60,120,180], boundary_reached=False, excluded_cells_burned=0, arrival_range_minutes=[float(arrival[burned].min()), float(arrival[burned].max())]),
        checks=checks, inputs=[dict(path=str(p.relative_to(ROOT)), sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in files if p.exists()],
        attribution=["PYRETECHNICS developed by Spatial Informatics Group, LLC and contributors.", "EFFIS / Copernicus Emergency Management Service, European fuel map, CC BY 4.0; cropped, classified and resampled.", "NASA JPL NASADEM; ESA WorldCover 2021, CC BY 4.0; Open-Meteo / ECMWF historical forecast."],
        license="Pyretechnics custom Community License: student/noncommercial experiment; preserved license adjacent. Commercial reuse needs separate assessment/agreement.",
        limitations=["No calibration or prediction-accuracy claim", "Fuel age, category uncertainty and assumed moisture affect output", "No measured canopy, spotting or suppression", "Pixelized perimeters are cell footprints, not surveyed fronts", "This is a bounded offline scenario, not a website or emergency tool"])
    for p in [OUT/"mariovo-arrival-minutes.tif", OUT/"mariovo-perimeters.geojson", OUT/"mariovo-scenario.png"]:
        manifest.setdefault("outputs", []).append(dict(path=str(p.relative_to(ROOT)), bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, allow_nan=False)+"\n")
    print(json.dumps(manifest["results"], indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    checks = controlled_checks()
    (OUT / "controlled-checks.json").write_text(json.dumps(checks, indent=2) + "\n")
    print(json.dumps(checks, indent=2))
    if not args.self_check:
        run_mariovo(checks)


if __name__ == "__main__":
    main()
