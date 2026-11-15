# ApexFire — downloaded data audit and research

Checked 14 November 2026. This report records the **original archive inspection and discovery-stage research**. Current status/roadmap is in [PROJECT.md](../PROJECT.md); later [readiness proofs](readiness/README.md) add current-access samples, numeric fuels, observed progression and a bounded model experiment. Open-Meteo is the user's intended weather source. Real-fire predictive accuracy remains unvalidated.

Further source inspection of Watch Fire/WildfireSignal now adds [sixteen original-provider assets and national-service research](readiness/additional-sources.md). A direct 2024 EFFIS perimeter query did not intersect the earlier secondary Mariovo reference; the case report flags that unconfirmed provenance. Use the current handoff/specification for adoption status, not older open-task wording below.

## 1. What is actually downloaded

The **original MODIS/VIIRS download batches** contain **7,263 CSV files and 35 attribute readmes**, occupying **24,096,722,286 bytes** excluding `.DS_Store`. CSVs alone occupy 24,096,613,318 bytes (24.10 decimal GB / 22.44 GiB). These counts exclude later case-study/readiness/reference derivatives elsewhere under `Data/`. There are **302,522,124 detection records**, not distinct fires. The union contains **238 country/territory labels**; this is not a claim of 238 sovereign countries or complete worldwide coverage.

| Family | CSVs | Detection records | CSV size, decimal GB | Years downloaded | Country/territory labels across years |
| --- | ---: | ---: | ---: | --- | ---: |
| MODIS Terra + Aqua | 5,068 | 107,197,769 | 8.38 | 2000–2012 and 2014–2025 | 232 |
| VIIRS NOAA-20 / JPSS-1 | 1,758 | 155,932,272 | 12.61 | 2018–2025 | 234 |
| VIIRS Suomi-NPP | 437 | 39,392,083 | 3.10 | 2024–2025 | 226 |
| Total | 7,263 | 302,522,124 | 24.10 | 35 sensor/year batches | 238 distinct labels |

The folders `modis-2`, `modis-10`, etc. are download/extraction names, not chronological sequence or product versions. For example, `modis-13/2017` contains 2017, not 2013. Do not derive years from the outer suffix.

These match the structure of FIRMS **yearly country summaries**, but each row remains an individual satellite detection. They are not precomputed yearly totals. The archive includes the Balkan neighbours Albania, Bulgaria, Greece, Kosovo, Serbia, Montenegro and Bosnia and Herzegovina in all 35 downloaded batches. Country labels and historic borders require a deliberate display/join policy.

### Coverage gaps

- **MODIS 2013 is absent**, including Macedonia and every other country; the whole batch is missing.
- **Suomi-NPP 2012–2023 is absent.** The longer archive exists; only two recent years are local.
- **NOAA-21 is absent from the original archive.** FIRMS lists its archive from 1 March 2023; later readiness samples contain NOAA-21 NRT observations.
- **No 2026 observations exist in the original archive.** Later [FIRMS readiness samples](readiness/firms-and-cloud.md) contain 14 November 2026 observations. An annual 2026 summary should not be presumed available before year end.
- MODIS 2000 and NOAA-20 2018 are partial starting years. FIRMS lists MODIS from 1 November 2000 and NOAA-20 from 1 April 2018. A missing country's file or a day with no rows is not automatically an incomplete download or a fire-free day. [FIRMS archive coverage](https://firms.modaps.eosdis.nasa.gov/download/)

Boundary-row samples across the global archive range from 1 November 2000 to 31 December 2025. These are sampled observation dates, not a full global date-range validation. Original download URLs, retrieval timestamps and checksums from NASA were not preserved in the supplied folders; the new inventory records local hashes for future comparison.

### Fields and meaning

Every CSV has a 15-column header. Common fields: latitude, longitude, scan, track, acquisition date/time, satellite, instrument, confidence, version, FRP, day/night and type. MODIS adds `brightness` and `bright_t31`; VIIRS uses `bright_ti4` and `bright_ti5`. Local readmes identify WGS84 geographic coordinates.

Acquisition times need UTC handling and four-digit HHMM preservation, including leading zeros. Brightness temperatures are satellite-band temperatures, not air temperatures. FRP is radiative power in MW, not hectares or fire duration. VIIRS confidence is categorical (`l/n/h`); MODIS uses numerical confidence. These are not interchangeable probabilities. Nominal 375 m or 1 km sampling is not a measured burn perimeter. [MODIS product guide](https://lpdaac.usgs.gov/documents/876/MOD14_User_Guide_v6.pdf), [VIIRS C2 guide](https://ladsweb.modaps.eosdis.nasa.gov/archive/Document%20Archive/Science%20Data%20Product%20Documentation/VIIRS_C2_AF-375m_User_Guide_1.2.pdf)

Absent from these original detection CSVs: full fire/nonfire/cloud masks, complete observation opportunities, incident IDs, confirmed ignition times, fire perimeters, burned hectares, fuels, weather, terrain and validation labels. Later bounded case studies add some perimeter/imagery/terrain/weather inputs; the [website-preparation research](research/README.md) also records the acquired FireSpread_MedEU progression reference. These additions do not provide complete national coverage or all model inputs. A CSV containing only detections cannot establish why a location had no detection.

## 2. North Macedonia in detail

The source filename is `Macedonia_Former_Yugoslav_Republic_of`; use **North Macedonia** for the interface while retaining the original identifier in provenance.

| Family | Local detection records | Full local time span of detections | Data bytes |
| --- | ---: | --- | ---: |
| MODIS | 17,700 | 14 Nov 2000–14 Dec 2025, with 2013 absent | Included in total below |
| NOAA-20 VIIRS | 22,602 | 1 Apr 2018–29 Dec 2025 | Included in total below |
| Suomi-NPP VIIRS | 6,744 | 1 Jan 2024–21 Dec 2025 | Included in total below |
| Total | **47,046** | Sensor-specific coverage above | **3,721,692** |

All 35 Macedonia CSVs were fully parsed. Core checks found no invalid dates, out-of-folder years, out-of-range coordinates, invalid HHMM times, negative FRP or invalid day/night flags. Dates are ordered within each file. No exact duplicate rows were found within these files. This does **not** remove repeat detections of the same event or prove geolocation/incident correctness. Some records have type 3 (over-water classification); an inland country still contains water pixels, so that is not automatically corrupt data.

| Year | MODIS | NOAA-20 VIIRS | Suomi-NPP VIIRS |
| --- | ---: | ---: | ---: |
| 2018 | 546 | 2,257, partial first year | Not downloaded |
| 2019 | 1,142 | 4,466 | Not downloaded |
| 2020 | 681 | 2,196 | Not downloaded |
| 2021 | 916 | 3,104 | Not downloaded |
| 2022 | 354 | 1,499 | Not downloaded |
| 2023 | 463 | 1,873 | Not downloaded |
| 2024 | 1,150 | 4,781 | 4,391 |
| 2025 | 573 | 2,426 | 2,353 |

These counts are inventory evidence. Do not interpret the columns as comparable fire counts or infer a climate trend from them.

### Important local anomalies to resolve

**Processing/version differences.** Macedonia MODIS rows have raw `version` strings `6.2` in 2000–2017, `6.03` in 2018–2022, and `61.03` in 2023–2025. VIIRS rows have `2`. NASA separates collection from within-collection location-product revision. `6.03` is documented as Collection 6 standard processing; `61.03` likely encodes Collection 6.1/revision 03. The precise local serialization of `6.2` remains unresolved and must not be called “Collection 6.2.” Preserve raw strings. [NASA GIBS metadata example](https://nasa-gibs.github.io/gibs-api-docs/python-usage/), [MODIS guide, monthly file naming](https://lpdaac.usgs.gov/documents/876/MOD14_User_Guide_v6.pdf)

**Static heat and changing classification.** Across Macedonia, type 2 accounts for **14,048 of 47,046 records**. In NOAA-20 it changes from 1,482/2,196 detections in 2020 to 17/4,781 in 2024. MODIS type 2 changes from 525/681 in 2020 to 18/1,150 in 2024. This is an apparent classification discontinuity requiring investigation, not evidence that industrial activity disappeared. Type 0 means presumed vegetation fire, type 1 volcano, type 2 other static land heat and type 3 over-water/offshore detection; these are algorithmic labels, not confirmed incident causes. [MODIS guide](https://lpdaac.usgs.gov/documents/876/MOD14_User_Guide_v6.pdf)

**Known VIIRS bug.** NASA reports that monthly C2 revisions 01/02 could incorrectly label static heat sources as vegetation fires; the bug was corrected in May 2025 and files reprocessed to revision 03. The local FIRMS `version=2` field alone does not establish which monthly revision supplied the classifications. The bug's presence in these particular downloads is **unknown**. Compare known recurring locations and reprocessed source records before imposing one historical `type==0` rule. [NASA FIRMS notification, 15 June 2025](https://firms2.modaps.eosdis.nasa.gov/content/notifications/firms/outages.html)

**NRT versus standard provenance remains unresolved.** FIRMS' archive page currently describes roughly five-month replacement lag; its separate README says roughly three months and states standard NOAA-20/21 data are not yet served through FIRMS. The 2025 scientific guide describes standard monthly products for all three satellites. These are different publication channels and partly inconsistent documentation. An old acquisition date or bare collection string is insufficient to declare each local country summary standard quality. Verify against upstream product filenames/revisions rather than choosing the most convenient statement. [FIRMS README](https://firms.modaps.eosdis.nasa.gov/download/Readme.txt)

## 3. What this can support

| Candidate capability | Evidence available now | Additional requirement / honest limit |
| --- | --- | --- |
| Historical hotspot map and date playback | Coordinates and timestamps across many countries | Show satellite, confidence, processing and missing-year context |
| Seasonal/monthly activity explorer | Detection dates and day/night flags | Separate sensors/versions; counts describe detections |
| Sensor comparison / harmonization study | MODIS–NOAA-20 overlap in 2018–2025; all three local sensors in 2024–2025 | Match observation times, spatial support and valid observation opportunities; no universal multiplier |
| Thermal intensity exploration | FRP and brightness fields | Avoid turning FRP into burned hectares or unqualified daily energy totals |
| Recurring heat-source investigation | Multi-year locations and type labels | Confirm classification provenance and candidate industrial sites |
| Event grouping | Nearby detections over time | Requires a declared clustering rule and independent incident comparison; clusters are hypotheses |
| Burned area / pre-post comparison | Not supplied by the hotspot archive | Add burned-area products and higher-resolution imagery |
| Weather context and fire-weather danger | One 168-hour ECMWF IFS HRES Historical Forecast series acquired for Mariovo; no live app integration | State model/lead time and use a defined danger index if chosen |
| Fire-spread forecasting | No validated local model or labels | Add fuels, terrain, fuel moisture, credible starting perimeter, weather and incident validation |

Recommendation: explore Macedonia/Balkans with separate sensor series and a few historical case studies before deciding the app scope. There is no need to download the world again. A 3.7 MB country subset can prove the user journey; the 24 GB archive should remain an offline analytical source. Partitioned derived data and summaries may support a static app, but no output format or hosting decision is made here.

## 4. NASA VIIRS research: highest-value additional products

The supplied [Earthdata VIIRS search](https://search.earthdata.nasa.gov/search?fi=VIIRS) exposed only a JavaScript fallback to the research tool. Research therefore used NASA's [CMR holdings directory](https://cmr.earthdata.nasa.gov/search/site/collections/directory/LPCLOUD/gov.nasa.eosdis), product metadata, LAADS and scientific guides. This is a focused catalog for ApexFire, not an exhaustive survey of every VIIRS collection.

**Current operational change:** Suomi-NPP data distribution ended **2 November 2026 at 15:40 UTC**. Its `VNP…` products remain useful historically. Use NOAA-21 (`VJ2…`) and NOAA-20 (`VJ1…`) when evaluating ongoing observations. [NOAA final confirmation](https://www.nesdis.noaa.gov/news/update-4-cessation-of-suomi-national-polar-orbiting-partnership-s-npp-data-users-november-02-2026-1540-utc-and-decommissioning-issued-november-2-2026-1800-utc)

| Priority | Product / version | Coverage and sampling | What it adds |
| --- | --- | --- | --- |
| First | `VNP64A1.002` | Global monthly burned area on a 500 m reporting grid; 2012 onward historical series, conservative scientific start March 2012 | Burn date, date uncertainty and QA; enables an actual burned-area measure rather than counting hotspots. [Product catalog](https://developers.google.com/earth-engine/datasets/catalog/NASA_VIIRS_002_VNP64A1), [authors' validation paper](https://doi.org/10.1016/j.rse.2025.115006) |
| First | `VJ214IMG.002` / NRT counterpart | NOAA-21, 375 m, six-minute L2 swath segments; standard catalog starts 10 Feb 2023, FIRMS extraction starts 1 Mar | Missing newer satellite, full fire/cloud/nonfire mask and QA. Six-minute files are orbit segments, **not a six-minute revisit over Macedonia**. [NASA product](https://data.nasa.gov/dataset/viirs-jpss2-active-fires-6-min-l2-swath-375m-v002), [NRT metadata](https://modaps.modaps.eosdis.nasa.gov/services/about/products/viirs-land-c2-nrt/VJ214IMG_nrt.html) |
| First, selected samples | `VNP14IMG.002`, `VJ114IMG.002` | S-NPP / NOAA-20 375 m L2 swaths; effective S-NPP start 20 Jan 2012; NOAA-20 catalog begins Jan 2018, FIRMS April | Full observation masks/QA and richer detection attributes for case studies. [S-NPP metadata](https://catalog.data.gov/dataset/viirs-npp-active-fires-6-min-l2-swath-375m-v002), [NOAA-20 metadata](https://catalog.data.gov/dataset/viirs-jpss1-active-fires-6-min-l2-swath-375m-v002) |
| Next | `VJ213A1.002`, `VJ113A1.002`, historical `VNP13A1.002` | 500 m, 16-day vegetation composites; NOAA-21 from Feb 2023, NOAA-20 2018, S-NPP 2012 | NDVI/EVI/EVI2 greenness, seasonality and recovery with QA/composite dates. Not a direct fuel-moisture measurement. [NASA NOAA-21 metadata](https://catalog.data.gov/dataset/viirs-jpss2-vegetation-indices-16-day-l3-global-500m-sin-grid-v002) |
| Comparison experiment | `VNP14.002`, `VJ114.002`, `VJ214.002` | 750 m L2 active-fire swaths | A more comparable algorithm/sensitivity bridge to Aqua MODIS than 375 m; still requires matching, not direct count concatenation. [NASA fire-family description](https://viirsland.gsfc.nasa.gov/Products/NASA/FireESDR.html) |
| Comparison experiment | `VNP14A1.002`, `VJ114A1.002`, `VJ214A1.002` | Daily 1 km L3 sinusoidal grids from the 750 m family | Daily grid analysis; not simply rasterized 375 m FIRMS points. [NASA daily NOAA-21 metadata](https://data.nasa.gov/dataset/viirs-jpss2-thermal-anomalies-and-fire-daily-l3-global-1km-sin-grid-v002) |
| Later | `VJ221A1D.002` / `VJ221A1N.002`, historical `VNP21A1D/N.002` | Day/night daily 1 km land-surface temperature; NOAA-21 from Feb 2023 | Surface heat context and anomalies. Skin temperature differs from 2 m air temperature and does not predict ignition. [NASA day product DOI](https://doi.org/10.5067/VIIRS/VJ221A1D.002) |
| Later | `VJ209GA.002`, historical `VNP09GA.002` | Daily reflectance, 500 m I bands and 1 km M bands | Custom regional indices/imagery with cloud/band QA. Coarse for local scars; HLS is a stronger first choice below. [NASA product metadata](https://data.nasa.gov/dataset/viirs-jpss2-surface-reflectance-daily-l2g-global-1km-and-500m-sin-grid-v002) |

`VNP64A1` is materially different from active-fire points. Its 500 m grid does not mean every small fire is detected or its edge is exact. Its algorithm uses reflectance and active-fire inputs; comparison with hotspot products is not wholly independent validation. The ongoing NOAA-20/21 replacement for the S-NPP burned-area series was **not established**; do not promise post-S-NPP continuity from that product alone. Actual Macedonia tiles and month completeness remain untested.

Full swaths add a denominator: which pixels were clear land, cloud, unprocessed or unclassified. Start with selected Macedonia fire days and comparison nonfire days. Matching geolocation data and product QA must be planned when using the complete mask. Use existing QA before introducing a separate global cloud ingestion pipeline. [375 m scientific guide](https://ladsweb.modaps.eosdis.nasa.gov/archive/Document%20Archive/Science%20Data%20Product%20Documentation/VIIRS_C2_AF-375m_User_Guide_1.2.pdf)

## 5. Complementary data with greater local value

These products cover Macedonia geographically. Coverage does not guarantee a valid cloud-free observation or useful local fuel characterization.

| Priority | Dataset | Scale / record | Use and limitation |
| --- | --- | --- | --- |
| First | `NASADEM_HGT.001` | About 30 m; terrain acquired February 2000; 60°N–56°S | Elevation, slope and aspect; a terrain base, not current canopy or buildings. [NASA DOI](https://doi.org/10.5067/measures/nasadem/nasadem_hgt.001) |
| First | `HLSL30` / `HLSS30` V2.0; optional `HLSL30_VI` / `HLSS30_VI` | 30 m; Landsat from 11 Apr 2013, Sentinel from 28 Nov 2015; combined opportunities around 1–2 days | Before/after NBR, NDMI, vegetation recovery and local scar mapping. Cloud/smoke/shadow filtering required; spectral severity needs interpretation. [HLS dates/status](https://hls.gsfc.nasa.gov/hls-data/), [NASA index suite](https://science.nasa.gov/mission/landsat/hls-vegetation-indices/) |
| First | ESA WorldCover 2021 v200 | Global 10 m static land cover | Forest/shrub/grass/cropland context. Not a calibrated fuel map; 2021 is not current. Changes versus 2020 mix algorithm changes and real changes. [ESA access and caveats](https://esa-worldcover.org/en/data-access) |
| Next | `MCD64A1.061` | Monthly 500 m MODIS burned area from Nov 2000 | Longer burned-area history, approximate burn day/uncertainty/QA. Coarse small-fire omission and shared inputs limit independence. [NASA guide](https://www.earthdata.nasa.gov/s3fs-public/2025-04/MCD64_User_Guide_V61.pdf) |
| Next | `SPL3SMP_E.006` SMAP | Daily, 9 km grid posting from 31 Mar 2015; measurement footprint is coarser | Regional surface-soil dryness anomalies. Not 9 km independent measurements or live/dead fuel moisture. [NSIDC metadata](https://nsidc.org/data/spl3smp_e/versions/6) |
| Next | IMERG `GPM_3IMERGHHE.07`, `GPM_3IMERGHHL.07`, `GPM_3IMERGHH.07` | Early/Late/Final half-hourly 0.1° precipitation; retrospective record from 1998 | Antecedent rainfall and dry spells. Coarse for mountain storms; preserve run/version distinctions. [NASA IMERG](https://gpm.nasa.gov/data/imerg) |
| Validation and baseline | Copernicus EFFIS | North Macedonia country statistics and mapped burned areas | External event/perimeter comparison and fire-weather baseline. Not a complete small-fire incident register. [Macedonia portal](https://forest-fire.emergency.copernicus.eu/apps/effis.statistics/estimates/MKD), [mapping method](https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/rapid-damage-assessment) |

HLS V2 imagery is distributed as Cloud Optimized GeoTIFFs with free Earthdata Login; nominal 1.7-day latency depends on timely upstream inputs. The HLS site still describes vegetation-index historical backfill as in progress toward completion in 2026; **do not assume every old VI tile exists**, though the reflectance archive has the start dates above. [HLS access](https://hls.gsfc.nasa.gov/data-access-and-tools/), [status](https://hls.gsfc.nasa.gov/hls-data/)

IMERG is undergoing a version transition. NASA's April/August 2026 notices describe V07 Final ending September 2025 and a delayed V08 release; hybrid Early/Late inputs can create discontinuities. The newest V08 availability was not independently established. Check the actual catalog at acquisition time instead of concatenating versions into a drought climatology. [April notice](https://gpm.nasa.gov/data/news/imerg-v08-transition-schedule), [August update](https://gpm.nasa.gov/data/news/update-imerg-v08-transition-schedule-aug-2026)

Historical land cover is an optional later need: `MCD12Q1.061` provides annual 500 m cover from 2001, but NASA lists training-data limitations for 2021 onward. No `VNP12…` VIIRS land-cover equivalent was established; do not infer short names from MODIS naming conventions. [MODIS land-cover metadata](https://doi.org/10.5067/MODIS/MCD12Q1.061)

### Acquisition and independence

Use free Earthdata Login for authenticated NASA extraction/downloads; LAADS tokens stay out of browser code and shared documents. AppEEARS or small tile subsets may reduce download and preprocessing work, subject to product support. WorldCover has public GeoTIFF access. EFFIS offers map/data services; some historical raw perimeter requests require a form. Catalog access was researched, not authenticated end-to-end.

Retain original products locally and publish only selected derived data. Each derivation needs product/collection, satellite, acquisition interval, retrieval date, source URL, raw version, QA/filter choices, processing method and checksum. A metadata manifest is more valuable initially than another database or a new orchestration system.

## 6. Open-Meteo and the spread objective

Open-Meteo is a reasonable source to evaluate for forecast forcing in a noncommercial prototype. A first historical-forecast request for Mariovo returned 168 hourly values for 1–7 September 2024: 10 m wind speed/direction/gusts, 2 m temperature/RH and precipitation. The selected model was ECMWF IFS HRES; the API returned its snapped grid coordinate rather than the exact requested point. This is usable as broad weather context, not as a station observation or validation of fire behavior. Start with these variables; VPD and antecedent rain may add drying context. Keep units explicit, times in UTC internally and selected model/lead time visible. Soil moisture and VPD must not be silently substituted for fuel moisture. [Historical Forecast API](https://open-meteo.com/en/docs/historical-forecast-api), [forecast variables](https://open-meteo.com/en/docs)

For Macedonia, the current Europe model option ICON EU is nominally about **7 km**, with about **five days** of horizon; native timing becomes three-hourly after 78 hours. The provider's finest Central European grids are not a Macedonia-wide 1–2 km capability. The DWD page announces a native-grid/alias transition after 30 November 2026, so pin and record the model used for experiments. [DWD documentation](https://open-meteo.com/en/docs/dwd-api)

Hourly or 15-minute output may be interpolation. Elevation downscaling does not create resolved valley-scale wind. Wind direction uses the meteorological **from** convention; a downwind direction is 180° opposite. Do not move a fire perimeter by `wind speed × elapsed time`: combustion spread is not an air parcel. [Open-Meteo source](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Helper/Meteorology.swift), [NOAA wind-direction definition](https://forecast.weather.gov/glossary.php?word=WIND+DIRECTION)

Free hosted API access is **noncommercial**, with fewer than 10,000 calls/day, 5,000/hour and 600/minute; the pricing table also lists 300,000/month. Large variable/date requests can count as multiple calls. Data require CC BY 4.0 attribution; free service access and the data licence are separate. Accuracy and uninterrupted service are not guaranteed. Cache shared area forecasts rather than requesting weather separately for thousands of points. Query selected areas without automatically transmitting a user's exact location. [Terms and privacy](https://open-meteo.com/en/terms), [pricing](https://open-meteo.com/en/pricing), [licence](https://open-meteo.com/en/licence)

Meteomatics is a useful **comparison provider**, with documented forecast/current/historical coverage and wind speed/direction parameters. Its `/mcp` endpoint is specifically an AI-agent connector using OAuth and exposes only data/models available to the authenticated account; it is useful for research with an agent but is not the weather API an app client should call directly. A product integration would use its REST API with credentials kept outside the client. The provider says outputs are downscaled to 90 m; that is not a 90 m native forecast grid or proof of local predictive skill. EURO1k is a separate native 1 km European model. The user's account-specific free quota/parameter entitlements were not queried, and no Meteomatics credential was used. Check account terms and `user_stats` before making it a dependency. [MCP connector and authentication](https://www.meteomatics.com/en/api/data-connectors/mcp/), [weather parameters](https://www.meteomatics.com/en/api/available-parameters/weather-parameter/), [API usage statistics](https://www.meteomatics.com/en/api/request/), [resolution description](https://www.meteomatics.com/en/weather-api/)

| Capability | Meaning | Evidence needed |
| --- | --- | --- |
| Weather forecast | Expected wind, humidity, rain, temperature | Selected provider/model and lead time |
| Fire-weather danger | Conditions conducive to fire behavior | Defined index such as FWI, its state/history and local interpretation |
| Experimental fire spread | Modeled fire growth from an existing starting fire | Terrain, fuel model, fuel/canopy state, moisture, starting geometry and weather |
| Calibrated probabilities/arrival times | Statements about where/when fire will arrive | Independent local validation and uncertainty calibration |

FWI is useful but is not an ignition probability or an evolving perimeter. It requires previous moisture-code state and appropriate weather history, not one forecast row. NASA's GFWED describes noon temperature/RH, 10 m wind, snow state and previous 24-hour precipitation. EFFIS provides a relevant European comparison baseline. [NASA GFWED](https://data.giss.nasa.gov/impacts/gfwed/), [EFFIS fire danger](https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/fire-danger-forecast)

Actual spread can be pursued as a bounded experiment using an existing model. FARSITE/FlamMap demonstrates why terrain, fuel models, canopy, moisture and weather are required; FlamMap is a 64-bit Windows desktop program. Pyretechnics is a scriptable surface/crown-spread candidate, but its installation, licence fit and local calibration are untested here. WorldCover classes alone do not supply its fuel parameters. [USFS FlamMap requirements](https://research.fs.usda.gov/firelab/products/dataandtools/flammap), [Pyretechnics project](https://github.com/pyregence/pyretechnics)

### Validation plan before calling this prediction

1. Choose a documented Macedonia/Balkan incident with multiple dated perimeter observations and credible local fuel information. A hotspot hull is not automatically an observed perimeter.
2. Freeze inputs at the prediction cutoff, including only satellite observations and weather runs actually available then. Separate model initialization from public release time.
3. Test weather skill, then short-horizon modeled growth against persistence/simple baselines. Measure missed/false burned area, perimeter overlap and arrival-time errors where observations allow them; evaluate uncertainty on unseen incidents/seasons.
4. Treat later non-detection as missing evidence when clouds, timing or outages explain it. A later burn scar alone cannot validate every hourly arrival-time claim.
5. Keep the product labeled experimental until performance has evidence. An illustrative downwind sector must not be labeled predicted burn extent or assigned fabricated arrival times/probabilities.

Reanalysis is appropriate for retrospective weather association, not proof of an as-issued forecast. Open-Meteo's Historical Forecast service stitches early lead times from successive runs. Single Runs preserves individual forecast horizons, but its current documentation explicitly labels early IFS history as **Cycle 49R1 hindcasts**; do not assume every historical run reproduces what an operator could obtain at the time. IFS history starts March 2024; most other models April 2026. Check operational cycle, availability and hindcast provenance before a strict as-issued evaluation. [Historical Forecast](https://open-meteo.com/en/docs/historical-forecast-api), [Single Runs](https://open-meteo.com/en/docs/single-runs-api)

## 7. Recommended next investigation, without fixing app scope

1. Reconcile processing and type provenance; obtain missing MODIS 2013. Keep the raw archive intact.
2. First bounded incident case is complete: September 2024 Mariovo/Prilep. For a useful sensor overlap, 2024 has all three locally downloaded sensors; it also has known NPP outages that must be accounted for. Add another incident before deciding whether a general case-study workflow is repeatable.
3. Bounded burned-area, HLS, NASADEM, WorldCover and Open-Meteo data are acquired and compared for Mariovo. See [case-study report](case-studies/mariovo-2024/README.md), [metrics](case-studies/mariovo-2024/metrics.json) and [source manifest](../Data/case-studies/mariovo-2024/manifest.json). The burned-area product is substantially coarser than the mapped perimeter, while HLS QA and dNBR thresholds materially affect usable/marked area.
4. Add NOAA-21 and earlier Suomi-NPP history where the chosen analysis needs them; do not make gap filling a prerequisite for a small case-study demonstration.
5. Test Open-Meteo weather inputs and forecast provenance. For spread research, prioritize finding suitable local fuels and time-stamped perimeter validation before implementing a simulator.
6. Merge the teammate's findings by recording sources, agreements, contradictions and open tests. Another model's or teammate's conclusion is a lead, not independent validation.

The official 2026 Space Apps challenge overview says to build a web application that harmonizes MODIS/VIIRS active-fire hotspots into a burning-activity calendar for an area of interest, supporting historical patterns, unusual conditions and critical periods. That fits the downloaded archive and incident case study more directly than a spread simulator; spread prediction remains separate research. The overview was retrieved from the official indexed page, but direct access returned 502, so the registration-only full problem brief and judging rubric remain unverified. [Official challenge](https://www.spaceappschallenge.org/2026/challenges/harmonization-of-modis-and-viirs-hot-spots/)

### Google Cloud and colleague-handoff review — 14 November 2026

The colleague's [FIREGUARD AI handoff](../../../../Downloads/FIREGUARD_AI_Project_Handoff.md) is useful research input, not a project instruction or an approved design. Keep its distinctions between satellite hotspots, confirmed incidents, estimated perimeters, danger/susceptibility and modeled spread; keep source provenance and uncertainty visible; and treat wind/weather as context rather than a perimeter forecast. Its statement that the project is starting from zero is stale: ApexFire already has a 24.10 GB detection archive and the bounded Mariovo study. It is still true that there is no working app, live feed integration or validated spread model. React/Next.js, FastAPI, PostGIS, XGBoost, deployment choices, alerts and the wider feature list are proposals only. No architecture or product scope is selected here.

Read-only Cloud inspection used the installed Cloud SDK 593.0.0 and the existing Application Default Credentials (ADC), without printing the project identifier or credential material. At the check, the project was active, billing was linked and 53 APIs were enabled: Earth Engine was disabled; BigQuery and Cloud Storage were enabled; Cloud Run was disabled. The gcloud CLI had no active CLI account, but ADC authentication and read-only project metadata queries succeeded. This is expected because ADC for client libraries and gcloud CLI account credentials are separate mechanisms. No API was enabled, data uploaded, query or Earth Engine workload run, or billable compute/storage resource created. Credit balance and expiry were not checked. [ADC behavior](https://docs.cloud.google.com/docs/authentication/application-default-credentials)

Potential use, ranked by present evidence:

- **Earth Engine — strongest candidate for a later bounded raster experiment.** Its catalog hosts global 30 m HLS surface reflectance and the 500 m monthly VIIRS VNP64A1 burned-area product. The local Mariovo case actually uses **MODIS MCD64A1**, not VNP64A1; VNP64A1 remains a proposed acquisition. Earth Engine could reduce repeated download/preprocessing for a much larger AOI or multi-year raster analysis. For one incident, ApexFire already has the needed local inputs, so Earth Engine adds setup and account dependency without demonstrated benefit. Access requires enabling the API and registering the project. Noncommercial use requires a verified eligible project; the current Community tier provides 150 EECU-hours/month, subject to Google's quota rollout and terms. No registration or eligibility was checked. [Access](https://developers.google.com/earth-engine/guides/access), [noncommercial tiers](https://developers.google.com/earth-engine/guides/noncommercial_tiers), [HLS catalog](https://developers.google.com/earth-engine/datasets/catalog/NASA_HLS_HLSL30_v002), [VIIRS burned-area catalog](https://developers.google.com/earth-engine/datasets/catalog/NASA_VIIRS_002_VNP64A1)
- **BigQuery — plausible for repeated archive-wide calendar and anomaly queries, not yet justified.** The local archive contains 302.5 million detection rows; BigQuery could serve shared, repeatable regional/time aggregations if local analysis becomes a bottleneck or collaborators need a common queryable dataset. It is enabled, but no rows were uploaded and no query was run. Query processing and stored data can be billed; the free query allowance does not make storage or all use free. Benchmark an AOI/date aggregation locally first, then set query byte limits and cost controls before any upload/job. [BigQuery pricing](https://cloud.google.com/bigquery/pricing)
- **Cloud Storage — no current need established.** It could store shared derived rasters or exports, but the case-study inputs are already local and the project has no cloud pipeline. Storage, operations and transfer have costs; do not copy the raw 24 GB archive just because the API is enabled.
- **Cloud Run — disabled in the inspected project snapshot and not needed before an app/backend is justified.** Do not deploy an API or app as part of this data evaluation.
- **Google Agents CLI — not a geospatial data source or shortcut to Earth Engine access.** `uvx google-agents-cli setup` installs tools for building, evaluating and deploying AI agents; an agent would add a separate product capability and cloud costs, not improve the underlying hotspot/raster evidence by itself. [Agents CLI guide](https://google.github.io/agents-cli/guide/getting-started/)

Recommended next cloud test, only if the team wants to test a concrete larger-area need: first verify the project’s noncommercial Earth Engine eligibility, then authorize the minimum Earth Engine setup and compare one Macedonia-wide seasonal HLS/VIIRS aggregation with the existing local workflow. Keep outputs small and export them locally. Do not enable unrelated APIs or upload the raw archive for this experiment. At present, use Cloud as an optional research compute path, not as the default app backend.

## 8. Reproduction and verification boundaries

- [File inventory](data-audit/file-inventory.csv): all CSV paths, families, years, country labels, byte/record counts, SHA-256, headers and boundary-row samples.
- [Audit summary](data-audit/audit-summary.json): family/year totals and complete Macedonia field/date/category/duplicate statistics.
- Audit command: `python3 tools/audit_data.py`. Uses the Python standard library and edits only its generated reports.
- All 7,263 CSVs were read byte-for-byte for counts and hashes. No quoted fields or blank lines were observed, so line counts yield record counts; headers and up to six boundary records were parsed. Every Macedonia record was fully parsed and checked; global interior rows were **not** fully validated.
- No identical whole-CSV hashes were found. Repeat detections/events across files were not deduplicated. Missing observation coverage, country boundaries and external provenance were not validated.
- Original FIRMS data and logos were not changed. The new Mariovo subset and derived rasters/maps/metrics are documented separately; no app, spread model or deployment was created.
- Some NASA pages returned 403, the challenge page 502, and the Earthdata search required JavaScript. Official alternative metadata and guides supplied the research. A direct Open-Meteo Historical Forecast API download was verified for the Mariovo case; live app integration, free-service operational reliability and Meteomatics account entitlements were not checked.

Used: local FIRMS audit, NASA/NOAA/ESA/Copernicus/Open-Meteo/Meteomatics primary-source research, bounded Mariovo acquisition/analysis, read-only Cloud metadata checks via ADC, and review of the colleague handoff; delegated research requested `gpt-6-luna` at medium effort, applied settings unverified. Friction: Earthdata's dynamic catalog and network review; system Python lacked Rasterio, resolved with ApexFire's cached `uv` environment; the Cloud SDK's normal log path was blocked by workspace permissions, so one permitted read-only ADC metadata check was used. Unverified: full global row-level validity, authenticated Earthdata downloads, the newest IMERG V08 state, an official EFFIS perimeter file for this case, local fuel parameters, Meteomatics account entitlements, Earth Engine eligibility/registration, Cloud credit balance/expiry, local-vs-BigQuery performance, the full Space Apps judging brief and fire-spread accuracy.
