# Bounded Mariovo spread experiment

This is an **experimental surface-fire scenario**, using actual Pyretechnics Eulerian level-set propagation. It is not a calibrated Macedonian forecast, a reconstruction of the Mariovo fire, or an operational emergency product. No website or continuously running model service is included.

## Reproduce

Python 3.11 is used because the selected engine declares that runtime family. The installation was isolated from the existing project environment. On this machine:

```sh
/opt/homebrew/bin/python3.11 -m venv /private/tmp/firewatch-spread-py311
/private/tmp/firewatch-spread-py311/bin/pip install -r tools/spread-requirements.txt
MPLCONFIGDIR=/private/tmp/firewatch-matplotlib /private/tmp/firewatch-spread-py311/bin/python -m unittest discover -s tests -p test_spread_scenario.py -v
MPLCONFIGDIR=/private/tmp/firewatch-matplotlib /private/tmp/firewatch-spread-py311/bin/python tools/run_spread_scenario.py
```

`--self-check` runs only the controlled experiment. The runner reads local inputs; it makes no network requests, uses no GPU/cloud service and does not modify source rasters. Reproduction writes the scenario's own derived outputs in place.

## Input contract and assumptions

- Terrain: NASADEM, aligned to north-up EPSG:32634, 100 m cells. Slope is rise/run from elevation gradients; aspect points downhill, clockwise from north. Source terrain detail and resampling are documented by the fuel-preparation manifest.
- Fuel: raw numeric EFFIS European fuel categories, linked through the official service legend to Anderson/NFFL model IDs. These are generalized, older regional categories, not field measurements or 2024 fuel conditions. Resampling the coarse fuel map to 100 m creates no new fuel information. See [fuel preparation](../../Data/readiness/fuels/manifest.json).
- Unknown/unclassified EFFIS cells are **excluded scenario barriers**, not confirmed nonburnable ground. WorldCover nonvegetated/unknown classes also become barriers. Missing terrain and its one-cell derivative neighborhood are excluded; nearest-valid filling is used solely to keep gradient arithmetic finite. Small roads, mixed pixels and changes since the map dates are unresolved.
- Ignition: a hypothetical single 100 m cell nearest the crop center that has an assigned burnable fuel. The exact center coordinate and grid index are in the scenario manifest. The assumed clock origin is **2 September 2024, 12:00 UTC**, with a **180-minute** horizon; neither ignition location nor time is presented as observed.
- Wind: three real hourly ECMWF IFS historical-forecast values retrieved through Open-Meteo for the Mariovo case. One coarse model point is applied uniformly over the domain. m/s is multiplied by 3.6 for the engine's 10 m km/h wind input; the meteorological direction **FROM**, clockwise from north, is passed unchanged. Gusts are retained in provenance but not used as sustained forcing. This is retrospective historical forecast data, not observed local wind.
- Moisture: fixed illustrative ratios in kg water/kg dry fuel: dead 1-hour **0.06**, dead 10-hour **0.08**, dead 100-hour **0.10**, live herbaceous **0.60**, live woody **0.90**, foliage **1.00**. They are explicit dry-scenario assumptions, not derived from relative humidity or measured/calibrated locally.
- Canopy cover, height, base height and bulk density are zero. This deliberately limits the experiment to surface fire; it does not characterize the actual canopy. No spotting, suppression, buildings, uncertainty ensemble or probability surface is modeled.

Pyretechnics uses south-first rows: y increases northward. Every north-up input is explicitly flipped before simulation, and the arrival matrix is flipped back before georeferenced export. Treating a conventional GeoTIFF as an engine array without this step reverses north and south.

## Verification and outputs

The actual compiled Pyretechnics engine was built locally for Apple Silicon/macOS 27.3 and Python 3.11.18 on the user's M1 Max. All three automated behavior tests passed. The flat uniform Anderson model 1 checks used 101×101 cells at 30 m and a 30-minute horizon:

| Controlled case | Result |
| --- | --- |
| Calm | 9 burned cells, equal one-cell extent in all four compass directions |
| Wind from west, 15 km/h | 138 burned cells; east extent 12 cells versus west extent 3 |
| Wind from south, 15 km/h | 138 burned cells; north extent 12 cells versus south extent 3 |
| Three-column model 98 nonburnable barrier | 48 burned cells; no burning in or across the barrier |

These results test orientation, forcing sensitivity and barrier handling. They do **not** establish real-fire accuracy. Additional tests cover downhill aspect, pixel-area/time conversion, north-up GeoJSON export and rejection of invalid or nonburnable ignition inputs.

Output directory: [Data/readiness/spread-scenario](../../Data/readiness/spread-scenario/). It contains `mariovo-arrival-minutes.tif`, `mariovo-perimeters.geojson` (30, 60, 120 and 180 minutes), `mariovo-scenario.png`, `controlled-checks.json`, the engine license, and `manifest.json` with hashes, grid, weather rows, assumptions, timings and limits. Unreached cells in the GeoTIFF use nodata -9999, rather than an invented arrival time. GeoJSON is WGS84 with timestamps in UTC; boundaries follow burned-cell footprints.

The **166×145-cell Mariovo scenario completed 180 simulated minutes**, with **17 burned cells / 17 modeled hectares**, arrival values from 0 to 176.74 minutes, no excluded cells burned and no crop boundary reached. The compiled engine call took approximately **0.001 seconds** locally; that excludes Python imports, input/output, plotting, installation and compilation, and is not an end-to-end benchmark. Four nonempty timestamped polygon steps and the georeferenced arrival raster were exported.

Final verification found that the fuel preparation had changed after the first scenario run. The parent reran the unchanged engine runner against the finalized fuel raster and provenance manifest, verified every input/output hash, and inspected the regenerated figure. The earlier 25 ha result is superseded by this final 17 ha run; it is not used as current evidence.

The runner rejects empty/no-propagation results, invalid/nonfinite burned arrival values, burning of excluded cells and a front reaching the crop boundary. See the output manifest for exact timings/hashes. Real-event accuracy, calibration and uncertainty remain **pending**; no observed incident progression is used as proof of forecast skill here.

## Attribution and terms

**PYRETECHNICS developed by Spatial Informatics Group, LLC and contributors.** Version 2026.10.20 is used unmodified. Its [complete custom license](../../Data/readiness/spread-scenario/PYRETECHNICS-LICENSE.md) is preserved. The actual license explicitly includes student/academic activities and qualifying noncommercial research; it is not an unrestricted permissive dependency. Commercial/paid/hosted use needs a separate terms assessment and potentially a SIG commercial agreement. [Engine source and documentation](https://github.com/pyregence/pyretechnics), [PyPI release](https://pypi.org/project/pyretechnics/2026.10.20/).

Input credit: EFFIS / Copernicus Emergency Management Service European fuel map (CC BY 4.0; cropped, crosswalked and resampled), NASA JPL NASADEM, ESA WorldCover 2021 (CC BY 4.0), and Open-Meteo / ECMWF historical forecast. Original and derived source provenance lives in the fuel and case-study manifests; no license on engine code is used as evidence for data rights.
