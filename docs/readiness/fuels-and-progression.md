# Numeric fuels and observed Brvenica progression

Prepared and locally verified on 14 November 2026. This work prepares real numeric inputs and observation artifacts; it does not validate a fire forecast. No website, cloud service or account setting was changed. Original downloads remain unchanged.

## What is now usable

| Artifact | Purpose |
| --- | --- |
| `Data/readiness/fuels/manifest.json` | Source requests, hashes, category crosswalks, grid contracts, counts and limitations |
| `Data/readiness/fuels/source/effis-fuel-mariovo.tif` | Actual numeric EFFIS WCS source subset, one Float32 category band, 49 × 56 |
| `Data/readiness/fuels/source/effis-fuel-event-12376.tif` | Actual numeric EFFIS WCS subset covering the entire observed 2017 event, 51 × 54 |
| `Data/readiness/fuels/mariovo/{fuel-model,elevation,worldcover,valid-input-mask,effis-source-code}.tif` | Aligned Mariovo model and context grids |
| `Data/readiness/fuels/event-12376/{fuel-model,effis-source-code}.tif` | 2017 event fuels; terrain has not been acquired for this area |
| `Data/readiness/progression-2017/observed-perimeters.geojson` | Eight original observed burned-area outlines, transformed to WGS84 with source attributes |
| `Data/readiness/progression-2017/{observations.csv,observed-growth-intervals.csv}` | Observation table and actual interval-average growth measurements |
| `Data/readiness/progression-2017/{missing-observations.json,prefire-reference.geojson}` | Fifteen missing-date records and one separate pre-fire reference |
| `Data/readiness/progression-2017/{manifest.json,effis-official-event-query.json}` | Provenance, quality results and independently retrieved EFFIS event identity |
| `Data/readiness/progression-2017/observed-progression.png` | Visually checked map for review or presentation preparation |

## Fuel acquisition and interpretation

The original full-Europe fuel ZIP redirects to `data.effis.emergency.copernicus.eu`, whose TLS certificate was expired at retrieval. Certificate verification was retained. Instead, a successful bounded request used the official [EFFIS WCS](https://maps.effis.emergency.copernicus.eu/effis?service=WCS&request=GetCapabilities), coverage `fuel_map`. Both numeric crops are only about 10 KB, far below the 2 MB per-request cap. DescribeCoverage and WMS/WCS capabilities were saved alongside the source rasters.

The returned rasters are single-band integer-valued categories stored as Float32, not coloured WMS pictures. Source map spacing is approximately 389 m in EPSG:3857, about 290 m on the ground here. Source values are internal vegetation categories, **not NFFL model numbers**. The source metadata calls this “Fuel Map - ver. 2017”; its generic range unit says radiance, which is inconsistent with its categorical content and must not be used as a physical unit. The manifest distinguishes actual acquisition query parameters from a numerically near-identical URL reconstructed from raster bounds. It retains the style/legend comparison URLs and SHA-256 hashes; source download completion times come from local file modification times, not provider sensing times.

The crosswalk was established by comparing every source pixel with an exactly aligned official WMS style image, then matching each unique colour to the official NFFL/Anderson legend. Every encountered code maps to one unambiguous colour. The saved images are validation evidence only; numerical categories come from WCS. [EFFIS fuel background](https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/fuels)

| Internal EFFIS codes seen locally | NFFL model | Interpretation from official legend |
| --- | --- | --- |
| 3, 6 | 1 | Short grass |
| 5, 9 | 2 | Grass and understory |
| 14 | 4 | Chaparral |
| 7, 8, 16, 17 | 5 | Brush |
| 24, 26 | 8 | Closed timber litter |
| 30, 32, 36 | 9 | Hardwood litter |
| 33, 37 | 10 | Timber |
| 50, 51, 52, 54 | 0 | White/unclassified: deliberately excluded, not measured nonburnable |

All outputs use north-up EPSG:32634, square 100 m cells and nearest-neighbour categorical resampling. This finer grid does not add source detail. Mariovo: **166 rows × 145 columns**, transform `[100, 0, 547200, 0, -100, 4577400]`. The expanded 2017 fuel crop covers 21.0–21.18°E, 41.735–41.875°N and has 157 × 150 cells; the initially suggested approximate latitude bounds clipped the observed event margins.

Mariovo elevation is reprojected from the existing NASADEM-derived 30 m raster with bilinear interpolation, preserving `-9999` for unavailable edge cells. WorldCover uses nearest neighbour and `255` for unavailable cells. Fuel model `0` represents exclusion/unknown. Mariovo has 3,256 fuel-excluded cells; the joint mask admits **20,803 of 24,070** cells with classified fuel, terrain and WorldCover. This mask does not by itself remove every nonvegetated WorldCover class: the model must apply its explicit surface-fire mask and gradient-edge rules.

An early local preparation defect was caught: GDAL's treatment of a zero destination nodata value could fill excluded categories during reprojection. The final implementation resamples the original nonzero source codes first and performs the model mapping afterward. A self-test covers this case. The final Mariovo fuel SHA-256 is `3fdbf05985681c0aac3c8f56903c5aa7c849e5476b825aa49967deb0fd439355`; the final fuel manifest SHA-256 is `291d9dbb7e30394acaa13c1443bd3df28d8222ec5a9dc1d5258eae3054a9e82a`.

Rights: EFFIS defaults EU-owned content to CC BY 4.0, subject to individual notices. Credit EFFIS / European Commission and indicate cropping, reprojection and reclassification. [Official license](https://forest-fire.emergency.copernicus.eu/about-effis/data-license)

## Observed 2017 progression and independent identity

The verified original [FireSpread_MedEU v2 archive](https://zenodo.org/records/18200075) contains 649 records and 103 events. Event 12376 has 24 rows: eight burned-area steps, fifteen dates without usable geometries, and a pre-fire row. The original ZIP hash remains `907e8d340bd44cde64c739b39474381d72ebe64aeef86c0daba17fa53967e27b`. The existing reference manifest establishes CC BY 4.0; the embedded feature-description PDF was copied for interpretation.

A bounded official EFFIS WFS query independently returned the same **id 12376, COUNTRY MK, PROVINCE Полошки, COMMUNE Brvenica**. Its response is preserved unmodified. Exact request parameters and hash are in the progression manifest. The source's 5,197 ha area, July 31 fire date and August 5 final date differ from the Planet progression, which observes burned area from July 30 through August 15. These differing definitions/measurements are retained rather than reconciled by invention. The last Planet area is 5,363.15 ha, 166.15 ha larger; overlap IoU against the official polygon is approximately **0.8053**.

| Planet acquisition (UTC convention) | Reported area, ha | Source quality |
| --- | ---: | --- |
| 2017-07-30 08:41:37 | 284.82 | low |
| 2017-08-01 08:45:00 | 557.37 | low |
| 2017-08-02 08:39:45 | 1,050.17 | medium |
| 2017-08-05 08:39:43 | 2,463.03 | high |
| 2017-08-06 08:42:47 | 2,992.82 | very high |
| 2017-08-11 08:39:44 | 4,123.01 | high |
| 2017-08-12 15:49:23 | 5,335.15 | high |
| 2017-08-15 08:40:13 | 5,363.15 | high |

Date/time values are preserved exactly. The DBF and embedded PDF omit the timezone; normalized timestamps use Planet's UTC acquisition convention, explicitly marked as an assumption rather than independently verified source-scene metadata. [Planet timestamp documentation](https://docs.planet.com/data/imagery/mosaics/)

All eight geometries are valid. Their equal-area EPSG:3035 areas agree with the rounded source attributes within **0.00344 ha**. WGS84 export/round-trip area errors are below 0.01 ha. Areas grow overall, but polygons are not strictly nested: the largest previously mapped area absent from the next outline is **5.418 ha**, between steps 2 and 3. No polygon repair, cumulative union or invented hourly interpolation was applied. Pre-fire's tiny geometry is separate and never treated as an ignition or a burned perimeter. Growth CSV values are interval averages across actual 23.9–119.9-hour gaps, not observed hourly spread rates or front velocities.

The neighboring weather artifact `Data/readiness/weather/event-12376-era5-2017-07-23_2017-08-15.csv` can support a later timed replay, using actual acquisition timestamps. It was produced by another worker and was not edited or independently re-audited here. A point weather series cannot establish local terrain wind or fuel moisture.

## Reproduce and remaining limits

Use the existing environment: `.venv/bin/python tools/prepare_spread_inputs.py --self-test`, then `.venv/bin/python tools/prepare_spread_inputs.py`. The script consumes saved source files, checks the verified original ZIP hash, preserves geometry holes, rejects ambiguous category mapping, writes aligned inputs and renders the progression map. It does not refetch sources, install packages, fit parameters or run a spread engine.

Locally verified: numeric source/category interpretation, crosswalk consistency, raster alignment and exclusions, geometry validity/areas, actual acquisition ordering, official event identity, original source preservation and visual map layout. Pending: field validation of regional fuel assignments, exact source imagery timezone confirmation, dead/live fuel moisture, canopy inputs, event-area terrain, weather-to-fire calibration and forecast validation. No local fuel-moisture or canopy zeros are presented as measured inputs. A surface-only scenario may deliberately exclude crown fire and spotting, with those assumptions stated by its model runner.
