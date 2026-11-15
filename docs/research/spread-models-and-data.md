# ApexFire: reusable spread models and missing data

Research checked 14 November 2026. Scope: North Macedonia first; decision support for a prototype due 15 November 2026 at 15:00 Europe/Skopje. No third-party model installed or executed. After the initial source review, the parent downloaded and inspected the small FireSpread_MedEU release; the verified acquisition is recorded below. Other local inventory is the parent's supplied context, not an independent audit by the research worker.

## Decision

**Recommendation:** build the observed-fire explorer and weather context now. If the prototype needs spread, ship one clearly marked, precomputed experimental scenario. Pyretechnics is the most convenient engine candidate, subject to a short installation proof and license fit. Do not promise a calibrated Macedonian forecast before the deadline.

The local MODIS/VIIRS archive, Mariovo 2024 HLS/MCD64A1, NASADEM, WorldCover 2021 and 168 hours of weather are useful inputs, but they do not establish local fuel characteristics, dead/live fuel moisture or observed timed perimeter progression. WorldCover classes do not directly encode Rothermel fuel models. A final burn scar alone cannot validate the timing or direction of a predicted front. These are model-readiness conclusions, not findings that the available satellite data are unusable.

**Most useful newly identified data:** FireSpread_MedEU contains small, downloadable, observed European fire-progression polygons. **Most important licensing finding:** current Pyretechnics and ELMFIRE terms restrict commercial reuse; neither should be introduced as an unrestricted permissive dependency.

Scores below express **reuse value before this deadline**, from 1 (poor fit) to 10 (strong fit), considering integration work, local relevance and provenance. They are recommendations, not accuracy measurements. Forecast accuracy in North Macedonia remains unknown for every engine considered.

## Seven high-value options

### 1. Pyretechnics — best engine candidate for a bounded scenario

**Deadline fit: 7/10 for an offline experiment; 3/10 for a validated live service.** Implements surface/crown fire, spotting and Eulerian level-set propagation. NumPy/SpaceTimeCube inputs cover fuel, terrain, wind and moisture; outputs include time of arrival, spread rate, direction, intensity and flame length. This is actual fire propagation, unlike a wind-particle animation. Its array interface fits a preprocessing script that exports static map layers. [Repository and usage](https://github.com/pyregence/pyretechnics/blob/main/README.md)

Current project version is 2026.10.20, with Python `~=3.11` and NumPy, SciPy, Rasterio and Cython dependencies. PyPI lists a source distribution for this release; an effortless Apple Silicon wheel install is not established. **LIKELY:** CPU execution on a small area is practical, but M1 Max installation and runtime must be measured. Do not adopt the project's heavier Guix development environment for this deadline. [Package configuration](https://github.com/pyregence/pyretechnics/blob/main/pyproject.toml), [release files](https://pypi.org/project/pyretechnics/)

**License:** custom Community/Commercial dual terms. Student/academic and qualifying noncommercial research activities are expressly covered without a fee; attribution and notices are required. Commercial use, including certain hosted services and compensated outputs, requires a written SIG agreement. The README's generic open-source wording does not override the license. For this educational prototype the described student-use allowance is relevant; commercialization requires a fresh assessment. [Actual license, especially §§3–9](https://github.com/pyregence/pyretechnics/blob/main/LICENSE.md)

**Use:** reuse the engine directly for an explicitly assumed scenario; export timestamped polygons or arrival-time rasters. **Do not claim:** local calibration, operational reliability or measured spread probabilities. A suitable engine cannot supply missing fuels/moisture or make uncertain ignition time precise.

### 2. ELMFIRE — stronger operational reference, heavier integration

**Deadline fit: 4/10.** Real landscape front propagation with time-of-arrival and intensity rasters. Current setup is documented for Linux using GNU Fortran, GDAL and MPI; Docker is also supplied. **LIKELY:** a Linux environment is a safer path than native macOS for a first run. An Apple Silicon image/build and its performance were not verified. [Repository and build path](https://github.com/lautenberger/elmfire/blob/main/README.md)

Requires aligned terrain/fuel/canopy rasters, ignition and transient wind/moisture inputs. Weather rasters have specified units and Float32 formatting; a 10 m weather wind requires the documented conversion/settings rather than being silently treated as midflame wind. Outputs are true spread estimates, but European fuel mapping and moisture preparation remain our work. [Input guide](https://elmfire.io/user_guide.html)

**License:** the current license specifies AGPLv3 subject to Commons Clause and directs commercial use to separate terms. It is not plain AGPL and not a permissive library. Retain the license and notices; inspect network/source obligations before integrating modified code into a public service. [Actual license](https://github.com/lautenberger/elmfire/blob/main/LICENSE.md), [commercial terms](https://github.com/lautenberger/elmfire/blob/main/COMMERCIAL_LICENSE.md)

**Use:** borrow the documented input/output contract and validation approach; use the engine after the deadline unless a team member already has a working installation and local inputs. Do not add its US-oriented data-service workflow expecting automatic Macedonian coverage.

### 3. FireSpread_MedEU v2 — best new candidate for observed progression labels

**Deadline fit: 9/10 for inspecting one case; 5/10 for local calibration.** Real satellite-derived, manually refined observations: 103 fires from 2017–2023, 320 progression steps, a 2.8 MB zipped shapefile in EPSG:3035. Attributes include acquisition timing, EFFIS event linkage and obstruction/quality information. Daily sampling occurs for 63% of steps; other intervals are longer or missing. This closes a different gap from hotspot points or a final scar. [Dataset record and file](https://zenodo.org/records/18200075)

**Verified acquisition after source review:** downloaded `FireSpread_MedEU.zip`, 2,751,019 bytes, from the record's API download link. Source MD5 `dc4de320f20b1f05cbd3bee4b688168b` matched. The [record API](https://zenodo.org/api/records/18200075) explicitly identifies the dataset license as **CC BY 4.0** and access as open. Original ZIP, metadata and checksums are retained in [the local manifest](../../Data/reference/fire-spread-medeu/manifest.json). This resolves the initially inaccessible license field; Planet source imagery still has separate rights. [Dataset description paper](https://doi.org/10.1038/s41597-026-06965-2)

Actual file inspection found **649 attribute rows, 103 event IDs, 423 polygon-shaped entries and 226 null geometries**. The publisher's 320 propagation steps must not be confused with all 649 rows: the release also records pre-fire observations and missing days. The bundled feature guide defines step 0 as the pre-fire image and empty geometry as missing observations. Keep missing days out of zero-burn labels.

**North Macedonia candidate found:** EFFIS ID **12376** has eight burned-area observations on 30 July, 1/2/5/6/11/12/15 August 2017, a pre-fire image on 23 July and additional missing-observation rows (24 total rows). Its event centers around 21.1°E, 41.8°N fall inside the Natural Earth MKD outline in a point-in-polygon screening. The first two burned steps have low subjective quality; later steps range medium to very high. This is a geographically matched historical reference, not an independently validated official local incident identity or hourly progression. The 1:110m country outline is a coarse location check, not a surveyed-border test. [Spatial inspection](../../Data/reference/fire-spread-medeu/spatial-inspection.json), [Natural Earth public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/).

Its date range cannot contain Mariovo 2024. The 2017 event requires corresponding weather, contemporary fuel assumptions and additional independent cases before it can support model validation. It can immediately inform a sourced historical progression replay.

**Use next:** inspect event 12376's geometry and quality against original incident evidence, align historical weather, and compare predictions only at actual acquisition times. The code generates burned-area geometries from Planet imagery; it is not itself a forecasting engine. Planet source imagery and the released derived polygons have distinct rights. [Author's processing repository](https://github.com/BAMresearch/wildfire_prop_database)

### 4. WildfireSpreadTS — real observed active-fire sequences, US domain

**Deadline fit: 4/10 for a sample; 1/10 for training a Macedonian predictor.** Dataset of 607 US events, 13,607 daily images, 2018–2021; GeoTIFF download is 48.4 GB. It targets next-day active-fire spread with weather/terrain/fuel-related features. These are observed satellite active-fire labels, not surveyed continuous fire-front perimeters. [Dataset](https://zenodo.org/records/8006177)

**License:** MIT for the baseline repository; README states CC BY 4.0 for data. Training uses PyTorch/Lightning and recommends conversion to HDF5, increasing storage. README reports a corrected data-class bug and an unresolved angle-feature transformation issue. **Inference:** CPU inspection is feasible; full training on this deadline and assuming US feature pipelines transfer to Macedonia is poor value. No MPS acceleration was verified. [Code, terms, warnings and preparation](https://github.com/SebastianGer/WildfireSpreadTS)

**Use:** borrow event-isolated train/test splitting, temporal evaluation and data-loader ideas later. Avoid random splits of days from the same fire, which can leak event information. Do not present a US-trained baseline as locally validated.

### 5. FireBench — disambiguate simulation data from validation tooling

**Deadline fit: 1/10 for Google's full dataset; 5/10 for selected validation methods.** Google's FireBench is high-fidelity **synthetic** fire evolution, not actual Macedonian incidents: 117 wind/slope combinations, roughly 1.36 PiB overall, generated using TPU computation. Individual simulations are several TB. It provides controlled physics research data, not missing local ground truth. [Google's dataset explanation](https://research.google/blog/firebench-using-high-performance-computing-to-advance-machine-learning-and-wildfire-research/)

The Google access/processing code is Apache 2.0, and its GitHub repository is archived. **Dataset license was not independently established**; the code license is not proof of the bucket's data terms. Do not bulk-download it. [Google repository](https://github.com/google-research/firebench)

A separate **WIRC-SJSU FireBench** is an Apache 2.0 Python benchmarking library, with metrics, standardized HDF5 and a 2021 Caldor case. It offers a better source of evaluation methods; its benchmark data have their own provenance/terms and are not Macedonian calibration. Reusing IoU/Dice/front-error evaluation is useful without adopting the whole framework. [WIRC repository](https://github.com/wirc-sjsu/firebench), [standard format](https://firebench.readthedocs.io/en/0.8.1/standard_format.html)

### 6. EFFIS fuel, FWI and burnt-area services — practical European context

**Deadline fit: 8/10 for context layers; 5/10 for numeric model inputs.** EFFIS explicitly publishes WMS access and point queries. The data page links an actual fuel archive, live burnt-area Shapefile/SpatiaLite and weather indices. Historical extracts/raw perimeters not served publicly require a data request; do not make tomorrow's build depend on a reply. [Service inventory](https://forest-fire.emergency.copernicus.eu/applications/data-and-services), [WMS instructions](https://forest-fire.emergency.copernicus.eu/downloads-instructions)

The EFFIS European fuel map maps vegetation complexes to Anderson/NFFL behavior categories, more directly relevant than raw WorldCover classes. It is a regional generalized map, not a current field survey. [Fuel background](https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/fuels)

**Actual access route:** `https://maps.effis.emergency.copernicus.eu/effis` for WMS; [FuelMap_LAEA.zip](https://forest-fire.emergency.copernicus.eu/effis/applications/data-and-services/FuelMap_LAEA.zip) is the archive URL linked by EFFIS. Its fetch timed out in this review: no bytes, CRS, category values or Macedonian coverage were verified. A styled WMS image or TIFF must not be assumed to contain raw numerical fuel/FWI values.

FWI is a weather-based danger index, not an ignition forecast or a time-evolving perimeter. EFFIS describes ECMWF ~8 km, 1–9-day forecasts and MeteoFrance ~10 km, up to 3 days. This is useful context for Macedonia; coarse pixels cannot describe an individual valley's wind. FFMC/DMC/DC are moisture *codes*, not interchangeable with all engine moisture input percentages. [Fire-danger documentation](https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/fire-danger-forecast)

**License:** EFFIS's page defaults EU-owned content to CC BY 4.0 with attribution and indication of changes, subject to individual notices and third-party exceptions. Verify the selected download/layer's metadata. [Data license](https://forest-fire.emergency.copernicus.eu/about-effis/data-license)

### 7. FIRE-RES Pan-European Fuel Map Server — promising canopy input source

**Deadline fit: 6/10 if a local crop is immediately available.** Provides co-registered 100 m raster surface fuels and canopy variables, including uncertainty, for fire-behavior modeling. This can reduce the canopy/fuel preparation gap more substantially than land-cover-only classification. The published portal leads to a Google Earth Engine application. [Project portal](https://www.cirgeo.unipd.it/fire-res/app/), [primary technical paper](https://doi.org/10.1016/j.geomat.2024.100036)

**UNKNOWN:** numeric export for North Macedonia, exact layer units/version, download size and data redistribution license. The paper's CC BY license is not sufficient evidence for every raster's terms. The application shell loaded but actual exports were not exercised. Do not promise this source in the prototype until a Mariovo crop opens with valid values and documented rights. [Project announcement and access link](https://fire-res.eu/fire-res-pan-european-fuel-mapping-in-the-spotlight-in-latest-scientific-publication/)

**Use:** one bounded access check, then crop and harmonize only the variables the chosen engine requires. Do not resample 100 m inputs to a finer grid and call that new information. Use uncertainty as a model limitation, not a calibrated probability.

## WIFIRE: architecture reference, not a ready Macedonia engine

UCSD describes WIFIRE/Firemap as a platform integrating data and engines, including GridFire and ELMFIRE. Its public UI exposes weather, fuel moisture, ignition/perimeter, ensembles, ETA and GIS exports; agency/research accounts are restricted. No verified reusable end-to-end code license or Macedonia-ready hosted modeling access was established. Borrow the pattern of explicit assumptions, scenario controls and timestamped outputs rather than treating the website as a downloadable model. [UCSD project description](https://scil.ucsd.edu/research-projects/current/wifire), [public Firemap UI](https://firemap.sdsc.edu/)

## Smallest credible implementation and proof

1. Keep **Observed detections**, **Observed burned area**, **Weather-based danger** and **Experimental spread scenario** distinct in the interface. Satellite detections are observations at acquisition times; they are not exact present boundaries. Wind vectors explain forcing, not future burning.
2. Make an offline, small-area Pyretechnics smoke test the only engine experiment. Fix a short time/effort limit before starting. Inputs must declare grid/CRS, units, ignition time/source, wind height/direction convention, fuel mapping, assumed moisture and nonburnable masks. Keep source data unchanged.
3. Check one simple case: zero wind/flat uniform fuel should not produce an unexplained favored compass direction; increasing wind should affect the correct downwind side. Check that roads/water/urban masks are not accidentally encoded as burnable categories. Passing this establishes implementation plausibility, not real-fire accuracy.
4. Export a small scenario collection as GeoJSON or georeferenced arrival-time rasters, with model version, inputs, assumptions and creation time. The website can render these without a simulation server. Prefer a few explicitly enumerated wind/moisture scenarios to an invented probability surface.
5. If no installation proof or compatible numeric fuel crop is available promptly, retain the observed/history/weather site and record spread as pending. Do not replace an unavailable model with an expanding ellipse presented as prediction.

For later validation, obtain at least one local event with multiple independently timed perimeters and corresponding weather, then reserve other events for testing. FireSpread_MedEU is the first small external candidate to inspect. Report overlap/front error against persistence or a simple baseline at actual observation timestamps; multiple scenarios are sensitivity analysis unless their probabilities have been calibrated.

## Verification limits

Source pages, current repository license texts and package metadata were read. No third-party model, repository script, notebook or container ran. The EFFIS fuel archive fetch timed out; Nature full-text endpoints redirected to inaccessible authentication infrastructure. Zenodo metadata was unavailable through the browsing route, but the parent's approved HTTPS acquisition succeeded and the ZIP, checksum, license, attributes and coarse Macedonian location were inspected. No local numeric fuel raster crop, M1 Max model execution benchmark or model accuracy test was completed. Code licenses and dataset licenses were treated separately throughout.

## Addendum: European rapid observations from MTG FCI and Sentinel-3 SLSTR

Focused source check on 14 November 2026 following the Firemap investigation. **Recommendation:** MTG FRP is the higher-value additional observation source for the gap between polar satellite passes; SLSTR adds complementary polar observations. Neither predicts spread or supplies a validated fire perimeter.

**MTG FCI / LSA SAF MTFRPPIXEL, LSA-509.** Official product specifications give 1 km nominal resolution, 10-minute cadence, 45-minute timeliness, CSV/NetCDF4, coverage 80°S–80°N and 80°W–80°E, and archive from 1 January 2025. North Macedonia lies inside that footprint; exact local pixel dimensions and detection sensitivity were not measured. Values include FRP in MW, uncertainty and fire-detection confidence. [Official product](https://lsa-saf.eumetsat.int/en/data/products/fire-products/mtfrp/)

The release announcement describes typical latency around 20 minutes, up to 45, but explicitly retains **demonstration status**, ongoing validation and no guaranteed operational availability. Ten-minute observations therefore do not mean ten-minute public alert delivery. Do not confuse LSA-509 with EUMETSAT's separate FCI FIR active-fire product. [Release/status statement](https://lsa-saf.eumetsat.int/en/news/news/release-of-mtg-fire-radiative-power-product-as-demonstration/)

Access routes are the [HTTP product directory](https://datalsasaf.lsasvcs.ipma.pt/PRODUCTS/MTG/MTFRPPixel/) and the published WMS endpoint `https://adaguc.lsasvcs.ipma.pt/adaguc-server?DATASET=MTG-FRP&SERVICE=WMS&`. Directory metadata loaded; no dated CSV/NetCDF was downloaded. The linked THREDDS/OpenDAP catalog returned **401 Unauthorized**. The product-family page requests registration for the data server; authenticated access was not exercised. [Access overview](https://lsa-saf.eumetsat.int/en/data/products/fire-products/), [WMS announcement](https://lsa-saf.eumetsat.int/en/news/news/release-of-mtg-fire-radiative-power-product-as-demonstration/)

**Rights:** LSA SAF explicitly licenses its products CC BY 4.0, including commercial sharing/adaptation with attribution. Use the product-specific credit, for example `EUMETSAT LSA SAF [MTFRPPIXEL, LSA-509]`, retain licensing and indicate transformations. [Official usage policy](https://lsa-saf.eumetsat.int/en/data/data-access/)

**Sentinel-3 SLSTR FRP.** Global polar-orbiting fire observations cover Macedonia. Thermal fire information is nominally 1 km; some product variants include 500 m SWIR data. The official mission overview describes sub-daily constellation revisit, rather than continuous monitoring. A 3- or 5-minute product granule describes orbit packaging, **not** a revisit every few minutes over Macedonia. NRT products target delivery under three hours after acquisition; NTC products are a separate delayed stream. Exact local passes and observed end-to-end delay remain unverified. [SLSTR products](https://sentiwiki.copernicus.eu/web/slstr-products), [mission/revisit](https://sentiwiki.copernicus.eu/web/s3-mission), [NRT product notice](https://user.eumetsat.int/s3/ope-eup-strapi-media/Sentinel_3_Product_Notice_SLSTR_Level_2_Near_Real_Time_Fire_Radiative_Power_PB_3_24_cfb5a27ab2.pdf)

Use CDSE's `sentinel-3-sl-2-frp-nrt` / `sentinel-3-sl-2-frp-ntc` STAC collections, or OData product type `SL_2_FRP___`, with acquisition window, footprint and timeliness filters. CDSE documents world coverage and a last-month NRT rolling window for SLSTR L2; archived NTC extends further. NetCDF products contain detection coordinates, times, classifications and quality/uncertainty fields. Data downloads may require account authentication; no sample file was downloaded and quotas were not verified. [STAC catalogue](https://documentation.dataspace.copernicus.eu/APIs/STAC.html), [exact OData example](https://documentation.dataspace.copernicus.eu/APIs/OData.html), [availability](https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel3.html)

Sentinel data permit free full/open reuse, including redistribution and modification with source notices. Public derived displays should indicate modified Copernicus Sentinel data and the year. [Official legal notice](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice)

**Implementation implication:** ingest detections with sensor/product, acquisition and receipt times, FRP, confidence and actual pixel footprint. Retain quality flags and distinguish cloud/unobserved coverage from “no fire.” MTG can reduce temporal blind spots for detectable fires; SLSTR supplies additional independent overpasses. Neither removes cloud/sensitivity gaps, guarantees early detection of small ignitions, or makes footprint polygons into burned-area boundaries. Prioritize one bounded MTG CSV access test; retain FIRMS while experimental MTG availability is evaluated.
