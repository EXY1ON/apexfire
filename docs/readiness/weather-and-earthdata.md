# Weather and Earthdata readiness

**Later provider extension, 14 November:** [additional-source proofs](additional-sources.md) now include a tested MET Norway point forecast (91 steps) and 48 hours of CAMS Europe air quality via Open-Meteo. Keep Open-Meteo primary; MET is a fallback/comparison with at least three hours between identical MK queries and its own cache headers. Neither sample establishes superior local accuracy, and CAMS concentrations are not wildfire-attributed smoke. Earlier tests and Earthdata proof below remain unchanged.

Checked 14 November 2026. Scope: public weather access, a reusable hourly 2017 event record, provider selection and a bounded authenticated NASA download proof. No website, cloud resources, accounts or subscriptions were created or changed.

## Result

**Weather access and an Earthdata-protected download path are locally verified. Weather accuracy and local fire-spread validity remain unverified.** Open-Meteo remains the simplest prototype interface: three real requests returned complete UTC arrays with explicit units. An existing Earthdata bearer token successfully authorized a small VIIRS scientific-file read through LP DAAC; it is not a FIRMS MAP_KEY or a general data API.

Files: [weather manifest](../../Data/readiness/weather/manifest.json), [Earthdata proof](../../Data/readiness/weather/earthdata-auth-proof.json), [verification tool](../../tools/check_weather.py). No credential values, signed download URLs or account identity were retained in these artifacts.

## Actual weather calls

All responses were HTTP 200, retrieved on 14 November 2026 at approximately **18:43:48 UTC**. Exact request URLs, HTTP response Date/Content-Type, response byte counts, SHA-256, requested/returned coordinates, returned elevation, units and validation results are in the manifest and each `.metadata.json`. Raw JSON preserves the exact response bytes.

| Query | Explicit requested model | Requested lat, lon | Returned lat, lon | Coverage and result |
| --- | --- | --- | --- | --- |
| Skopje | `icon_global` | 41.9981, 21.4254 | 42.0, 21.375 | Current-model time 18:30 UTC; 72 hourly values per variable, 14 Nov 00:00–16 Nov 23:00 UTC |
| Mariovo | `icon_global` | 41.27, 21.65 | 41.25, 21.625 | Current-model time 18:30 UTC; same three-calendar-day hourly window |
| FireSpread_MedEU event 12376 | `era5` | 41.8, 21.1 | 41.75, 21.0 | **576 complete hours**, 23 Jul 2017 00:00–15 Aug 2017 23:00 UTC |

Every hourly temperature, RH, precipitation, sustained wind, direction and gust value was numeric/non-null; arrays were equal-length, strictly hourly, ordered and contiguous. Metadata returned `timezone=GMT` and `utc_offset_seconds=0`. Explicit Celsius, mm and m/s requests matched response unit labels. Current-model values were about 14 minutes older than retrieval and passed a two-hour freshness guard. The current interval is **900 seconds**; its precipitation must not be confused with the separate hourly precipitation column. Three forecast calendar days include elapsed hours of the first day; this is not 72 future hours from retrieval.

These JSON responses **do not echo an independently identifiable model run or initialization timestamp**. The retained requested model establishes the request selection, not an independently verified backend run. Model run time is therefore recorded as null. Model current conditions are not a local weather-station observation.

**Upcoming compatibility issue:** the current [DWD API documentation](https://open-meteo.com/en/docs/dwd-api) labels legacy ICON Global/EU/D2 choices for discontinuation on **30 November 2026** and lists native replacements. `icon_global` worked in this dated proof. Before ongoing deployment, choose and verify a supported native/explicit model or documented `best_match`; do not infer that DWD is discontinuing the underlying forecast models.

## 2017 hourly contract for spread experiments

Use [event-12376-era5-2017-07-23_2017-08-15.csv](../../Data/readiness/weather/event-12376-era5-2017-07-23_2017-08-15.csv), backed by the corresponding raw `.json` and `.metadata.json`. CSV SHA-256: `8b157c61ea5936d140e43c6c2d9caa2c908396f3e538f68d1684156c8f9ff2a6`.

| Column | Contract |
| --- | --- |
| `time_utc` | ISO 8601 with explicit `+00:00`; 576 rows, hourly, inclusive endpoints |
| `temperature_2m` | °C; model/reanalysis screen-level air temperature |
| `relative_humidity_2m` | Percent 0–100; divide by 100 only if an engine explicitly requires a fraction |
| `precipitation` | mm accumulated over the preceding hourly interval; not a cumulative series |
| `wind_speed_10m` | m/s at 10 m above ground; sustained/model wind, not midflame wind |
| `wind_direction_10m` | Meteorological direction **from** which wind arrives, degrees clockwise from north |
| `wind_gusts_10m` | Provider-returned m/s gust series; do not substitute for sustained wind |

CSV transformation only adds UTC offsets and arranges the unchanged hourly values into columns. No interpolation, lapse-rate adjustment by us, wind-height conversion, missing-value fill, spatial resampling or fuel/moisture conversion was applied. Open-Meteo applies its own grid/elevation selection and possible downscaling; the returned 1670 m elevation is provider metadata, not a field survey or our terrain raster's measured elevation.

The [historical API](https://open-meteo.com/en/docs/historical-weather-api) documents ERA5 as global hourly 0.25° data, distinct from ERA5-Land and the historical forecast archive. We explicitly selected ERA5 rather than the blended default. **Retrospective reanalysis incorporates information unavailable to a forecaster in 2017.** Use this as retrospective environmental forcing, not evidence of forecast skill available at ignition. The documentation's variable matrix and the successful returned ERA5 gust series are not perfectly aligned; retain gusts as provider output until their exact derivation is resolved if they become a scientific input. No native gust provenance beyond the requested product was established.

For spread forcing, convert direction/height only in the engine adapter and record the convention. For example, a wind **from** 270° blows east; feeding 270° as a propagation heading reverses the result. Treat one coarse weather point as spatially uniform only as an explicit scenario assumption. Compare modeled fronts at the actual observed progression acquisition times; do not convert missing progression days into zero spread.

## Provider comparison for this Macedonian prototype

Scores express **integration fit now**, considering access already proved, needed variables/history, cost, rights clarity and work before the deadline. They do not rank meteorological accuracy. No local station comparison, valley-wind assessment or forecast-skill evaluation was performed.

| Route | MK coverage, scale and time range | Cost, accounts and rights | Fit now / reliability boundary |
| --- | --- | --- | --- |
| **Open-Meteo** | Global point forecasts; underlying model resolution varies. Explicit current ICON and 2017 hourly ERA5 access proved. ECMWF interface documents ~9 km IFS and up to 15 days. | No account/key for noncommercial public API. Free endpoint limits: fewer than 10,000/day, 5,000/hour, 600/minute; pricing also lists 300,000/month. Data CC BY 4.0; paid service needed for commercial API use. | **9/10** interface fit. Small JSON, straightforward caching; free service has no uptime guarantee. Keep raw snapshots and last-success/error timestamps. [Terms](https://open-meteo.com/en/terms), [pricing](https://open-meteo.com/en/pricing), [ECMWF API](https://open-meteo.com/en/docs/ecmwf-api) |
| **Meteomatics, user's free access** | Global model/observation/history API. EURO1k advertises native 1 km European forecasts, 15-minute steps, hourly updates, 72-hour lead; other source horizons vary. 90 m post-processing is not native 90 m atmospheric simulation. | User reports free access; exact account entitlement, expiry, quota, historic coverage, EURO1k access and redistribution terms were **not inspected**. Public pages currently direct API users to accounts/contracts, not a verified universal free entitlement. Credentials belong server-side. | **6/10 provisionally**, potentially useful comparison if existing access covers the required source/variables. Do not equate free access with all products or public redistribution. No authenticated Meteomatics request made. [API](https://www.meteomatics.com/en/weather-api/), [EURO1k](https://www.meteomatics.com/en/weather-model-europe/), [account quotas](https://www.meteomatics.com/en/api/faq/) |
| **Direct ECMWF forecasts / Copernicus CDS history** | Global. Current IFS open output is available at 0.25° and, since 20 Oct 2026, 0.1°; forecast to 15 days. CDS ERA5 is hourly 0.25° back to 1940. | Open forecast subset is free CC BY 4.0; specialized delivery can cost money. CDS requires account, personal access token and acceptance of selected dataset terms. GRIB/subsetting and service queues add work. | **6/10 now, 9/10 source-control fit later.** Avoids an aggregator, preserves source fields/run identity, but needs ingestion and format handling. No direct full weather dataset downloaded. [Open data](https://www.ecmwf.int/en/forecasts/datasets/open-data), [ERA5](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels?tab=overview), [CDS access](https://cds.climate.copernicus.eu/licences/terms-of-use-cds) |
| **Direct DWD open data** | ICON global and European products cover MK; European grid is roughly 7 km and commonly up to 120 h, depending on run/product. ICON-D2's regional domain must not be assumed to cover MK. | Public forecast files avoid a proprietary account. GRIB/remapping, variable selection, accumulation conventions and rolling retention are our responsibility. Exact selected feed's current terms/attribution must be retained. | **5/10 now.** Useful low-lock-in alternative after the prototype, but a direct data ingest was not proved here. DWD web endpoints returned 403 in this environment; no uptime/accuracy conclusion follows. [DWD model reference](https://www.dwd.de/DWD/forschung/nwv/fepub/icon_database_main.pdf), [DHMZ's ICON-EU domain description](https://meteo.hr/infrastruktura.php?param=dwd_icon&section=prognosticki_modeli) |
| **NASA POWER** | Global meteorological history; typical meteorology grid 0.5° × 0.625°, hourly since 2001, daily since 1981. Product-specific near-real-time delay is days, not a local live forecast. High-resolution precipitation aliases do not improve all meteorology. | No cost/account needed. Retain NASA POWER/source citations. Hourly defaults to local solar time; explicitly request UTC. | **7/10 climate/calendar context; 3/10 local live spread forcing.** Convenient historical cross-check, coarse for Macedonian terrain and not a substitute for current forecast wind. [Hourly API](https://power.larc.nasa.gov/docs/services/api/temporal/hourly/), [resolution](https://power.larc.nasa.gov/docs/tutorials/service-data-request/api/), [access and latency](https://power.larc.nasa.gov/resources/power-one-pager.pdf) |

**Recommendation:** retain Open-Meteo for prototype weather, with explicit product, units and cached evidence. Test Meteomatics as a second source only under the user's actual free entitlement; a worthwhile test compares identical coordinates/time/variables and records the model source. Smaller grid spacing and vendor testimonials do not demonstrate superior MK accuracy. Add a station-based comparison later before claiming one forecast is more accurate.

**Privacy and exit:** any remote point query reveals coordinates/time and requester IP to its provider. Fetch/cache on the project's controlled side rather than expose each visitor's location to multiple vendors. Public case-study coordinates are low-sensitivity; private user watch areas would change the threat model. Keep a provider-neutral hourly CSV/JSON contract, units, source/run metadata and raw snapshots so Open-Meteo, direct public models or another provider can be substituted without rewriting the spread engine. Never embed Meteomatics or NASA credentials in a browser.

## Earthdata: capability and actual authentication proof

NASA [EDL token documentation](https://urs.earthdata.nasa.gov/documentation/for_users/user_token) currently gives user tokens a **60-day validity** and a maximum of two valid tokens. These are identity/authorization credentials for compatible applications. A token neither selects a satellite product nor provides universal authorization to every NASA service. App authorization and product availability still apply; actual expiration of the supplied token was not queried.

| Service | What it does / how the credential relates |
| --- | --- |
| **Earthdata Login / URS** | Identity, compatible-app authorization and user-token management. It is not a fire-data query service. No token generation, refresh, deletion, password operation or profile request was made. |
| **CMR** | Searches collection/granule metadata and returns data links; public discovery generally works without a token. EDL Bearer is supported when authorization is required. The actual archive/cloud host serves the bytes. [CMR API](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html) |
| **LAADS / LANCE** | Standard and NRT MODIS/VIIRS science files, with product-specific quality, geolocation and other variables. LAADS documents `Authorization: Bearer` EDL downloads; older LAADS/nrt3/nrt4-generated tokens were discontinued. [Download guide](https://ladsweb.modaps.eosdis.nasa.gov/learn/download-files-using-edl-tokens/), [token transition](https://ladsweb.modaps.eosdis.nasa.gov/alerts-and-issues/199578) |
| **LP DAAC protected data** | Protected product files from discovered NASA catalogue links. **This route was actually proved below**, for a historical 375 m VIIRS active-fire scientific granule. It is not proof of all LP DAAC products or all account entitlements. |
| **AppEEARS** | Subsets/processes supported collections into requested point/area outputs. Its documented API login exchanges Earthdata credentials for its own roughly **48-hour** Bearer token. Do not assume an EDL 60-day token is interchangeable with that service token; AppEEARS login/tasks were not exercised. [API authentication](https://appeears.earthdatacloud.nasa.gov/api/#authentication) |
| **FIRMS API** | A separate free **MAP_KEY**, used in area/map-service requests with its own quota. Earthdata Bearer is not a substitute. Existing public bulk CSV routes can be keyless. This worker did not read/use the supplied MAP_KEY. [FIRMS guide](https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html) |

NRT is a processing/latency class, not an authorization mode. NASA describes many LANCE products as available within three hours, using faster ancillary inputs; standard products have different processing/latency and suit retrospective analysis. Product-specific exceptions and retention matter. Preserve SP/NRT, collection/version, acquisition time, retrieval time and quality flags separately. A token cannot turn an NRT observation into a validated historical result. [NASA LANCE explanation](https://forum.earthdata.nasa.gov/viewtopic.php?t=5201)

### What was actually tested

1. Public CMR lookup selected **VNP14IMG.002**, granule **G3232529426-LPCLOUD**, title `VNP14IMG.A2024245.0112.002.2024245104311`, intersecting 21–22°E / 41–42°N on 1–2 September 2024. [LAADS product metadata](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP14IMG) confirms the product family/archive set.
2. LAADS's documented archive README returned 200 both anonymously and with the supplied bearer. This is reachability, **not authentication evidence**. Its archive granule path returned 303 for both; that route was not followed and did not establish access.
3. The catalogue's exact `data.lpdaac.earthdatacloud.nasa.gov` protected granule URL returned **302 to URS anonymously**, but **303 to the file CDN with Bearer authentication**.
4. A fresh request to that NASA-provided CDN URL, with **no Authorization header or cookies forwarded**, returned **206**, `Content-Range: bytes 0-1023/1093760`, and the expected HDF5 signature. Only **1,024 bytes** were read, not the full 1,093,760-byte granule. Prefix SHA-256 and sanitized status/host/path metadata are retained in the proof file. The signed CDN URL and its query were discarded.

This demonstrates that the supplied bearer authorized this protected historical scientific file through LP DAAC at approximately **18:50 UTC**. It does not demonstrate current LANCE NRT access, every token-compatible host, AppEEARS, full-file integrity, scientific variable parsing or weather-service credentials.

**Host/secret rule:** send the bearer only to the exact owning NASA HTTPS host verified by discovery and documentation; no wildcard token forwarding. In this proof it was sent to `ladsweb.modaps.eosdis.nasa.gov` and `data.lpdaac.earthdatacloud.nasa.gov`. A returned file-CDN redirect was followed only with a new credential-free request. Never forward the bearer to Open-Meteo, Meteomatics, Microsoft, Google, arbitrary CMR link domains or a redirected third party. Logs/manifests retain sanitized URLs and statuses, never Authorization, token-bearing query strings or signed links. Do not copy the credential file into a public artifact tree.

## Verification and limits

`python3 tools/check_weather.py --self-test` passes checks for valid UTC input and rejection of unit mismatch, duplicate/missing hour, null values, invalid RH, wrong grid coordinate, wrong timezone and stale current-model time. `python3 tools/check_weather.py --verify-saved` verifies all three response hashes, date coverage, units, physical ranges and the historical CSV hash/row count without network calls. `--fetch` explicitly performs only the three bounded public weather calls; it does not touch credentials.

The first network attempt under the restricted shell failed DNS resolution; the specifically approved public-fetch command succeeded. Public DWD pages were blocked by the browsing environment and were not repeatedly retried. No untrusted repository code or package was installed/run. No Meteomatics authenticated request, station comparison, weather accuracy evaluation, spatially varying wind field, fuel-moisture validation or operational spread validation was completed. Full NASA granule download/parsing and live LANCE access remain pending; the bounded protected-file access proof is complete.
