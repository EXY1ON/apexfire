# WildfireSignal North Macedonia: sources and implementation research

Inspected 14 November 2026. **Locally verified public-source investigation, not a review of server code or scientific accuracy.** The target was [the North Macedonia map](https://wildfiresignal.com/countries/north-macedonia/#ws-country-map-title). Read PROJECT.md, website-spec.md and readiness index first. The parent session owns rendered-browser evidence; this report owns public HTML/JavaScript, JSON and original-provider checks. No accounts, credentials, communications, production changes or competitor integration were used.

## Findings that change ApexFire

1. **Add a small original-provider EFFIS seasonal dataset**, with separate mapped-event/area statistics and a stated baseline. Both direct weekly and annual APIs returned North Macedonia data. WildfireSignal's displayed totals do not match these original responses; importing its numbers would introduce an unresolved discrepancy.
2. **MKFFIS is a real additional national source**, beyond a link: its public WMS returned current dated FWI/vegetation-dryness maps, legends and a numeric FWI pixel value without authentication. Public reuse rights and scientific production details remain unresolved. This earns an investigation path, not a production dependency or operational claim.
3. Reuse the ideas of explicit source health, separate acquisitions/check timestamps, a country observation summary and clearly separated burned-area records. Do not copy branding, code, imagery or the proprietary service's cache as ApexFire data.

## What the target actually provides

The downloaded page separates NASA heat, recent GWIS burned areas and EFFIS seasonal statistics. It explicitly says MKFFIS/Crisis Management Center are linked national resources and that it does **not import a Macedonian operational incident feed**. Current Copernicus results are a seven-day lookup, not confirmed active incidents. The seasonal list has twelve qualifying mapped-fire cards, approximate directional names and source mapping periods; its detail-page threshold is not established here. Empty recent records do not establish no fires.

Observed public implementation: WordPress custom `wildfiresignal-nasa-map` plugin, Leaflet 1.9.4, OSM raster tiles, lazy map initialization and custom frontend controls. Country viewport is `20.3138,40.6934,23.1017,42.4696`. Map requests include days, intensity, zoom, viewport and region; the sampled response says `heat_scope=region`, so the map request's bbox alone does not establish its counting domain. JavaScript uses abort controllers/request IDs, fetch deduplication, ten-minute timers, visibility checks and postponed updates while a popup is open. Those are useful interaction patterns, not evidence of server scheduling reliability.

The markup offers 24 h/48 h/7 d heat windows, all/strong/very-strong filters, mapped-area list/search, official links and saved-country UI. Technical popup fields include confidence, FRP, satellite and acquisition time. No current local forecast, calibrated spread model, evaluated MODIS/VIIRS harmonization or historical calendar comparable to ApexFire's planned full archive was established. Generic U.S. incident/perimeter controls exist in shared markup; their presence does not establish MK layers. The sampled response explicitly says incidents unavailable.

**Heat classes are display heuristics:** JavaScript classifies brightness `>330 K` as very strong, `>=300 K` as strong, everything else as other. These thresholds are neither FWI nor a fire-danger/spread forecast, and brightness temperature is not a ground flame-temperature measurement. ApexFire should preserve native confidence/FRP and explain any derived visual class instead of implying validated danger.

## Public request contracts and semantics

Evidence snapshots live in [wildfiresignal/](wildfiresignal/). Public routes are observations of this service's implementation, not an API license or dependency recommendation:

| Route, under `https://wildfiresignal.com` | Actual response / evidence |
| --- | --- |
| `/wp-json/wildfiresignal/v1/country-summary/north-macedonia` | `total,strong,very,other,recent_6h,recent_window_end,night,max_brightness,newest,fetched_at,stale,partial,rolling_hours`, plus separate `fire_snapshot`; [capture](wildfiresignal/country-summary.json). |
| `/wp-json/wildfiresignal/v1/global-fires/north-macedonia` | `fires`, count, coverage state, regional tile completion/errors, generated/check/source times, plus season archive; [capture](wildfiresignal/global-fires.json). |
| `/wp-json/wildfiresignal/v1/effis-stats/north-macedonia` | Area/count and averages/ratios, `data_date`, fetched time and stale/status; [capture](wildfiresignal/effis-stats.json). |
| `/wp-json/wildfiresignal/v1/map?days=1&zoom=7&intensity=all&incidents=0&perimeters=0&high_activity=0&region=north-macedonia&west=20.314&south=40.693&east=23.102&north=42.470` | Five VIIRS NOAA-20/21 points with native fields and UTC times; `is_stale=true`; [capture](wildfiresignal/map-response.json). |

The sampled recent GWIS result is `week_complete`, one of one tile complete, zero polygons, source observation date absent. `generated_at` is not an observation timestamp. The five heat points span 13 November 23:35–14 November 01:13 UTC; fetch is 20:27 UTC. The statistic `recent_6h=5` is anchored to **latest signal**, not the current clock; the HTML explains that window. Avoid presenting this as five detections in the last six hours now.

The source-check claim is every ten minutes, not a guarantee of new satellite data every ten minutes. The initial HTML narrative did not include the cached warning later present in summary JSON. A map-returned country narrative also reported incident availability differently from the dedicated summary. These are sampled response disagreements, not a demonstrated permanent defect or proof of server internals.

## Original EFFIS APIs: verified and recommended

The official [season portal](https://forest-fire.emergency.copernicus.eu/apps/effis.statistics/seasonaltrend/MKD/2026/CO2) references a public app asset that builds these routes:

- [Weekly mapped area/events](https://api2.effis.emergency.copernicus.eu/statistics/v2/effis/weekly?country=MKD&year=2026): `banfweekly` and `banfcumulative`, 52 rows each. Fields include `iso3,week,min_year,mddate,events,events_min/avg/max,area_ha,area_ha_min/avg/max`. Future weeks contain null current-year values, which must stay unknown rather than zero.
- [Annual estimates](https://api2.effis.emergency.copernicus.eu/statistics/v2/effis/estimatesbycountry?country=MKD): 21 records, 2006–2026, fields `year,ba,nf`.
- [Weekly thermal anomalies](https://api2.effis.emergency.copernicus.eu/statistics/v2/ta/weekly?country=MKD&year=2026): `taweekly,tacumulative`, separate Suomi/NOAA VIIRS and MODIS counts and historical min/average/max. Useful external aggregate comparison; not a replacement for validated raw-record harmonization.

Direct weekly latest nonnull cumulative row is week 45, **11 November: 25,323 ha, 69 mapped events**, area average 16,873.5, events average 41.8, `min_year=2006`. Annual 2026 agrees. WildfireSignal instead reports 27,913 ha/94 and averages 29,461.86/106.79 for that date, while its explanatory text claims history since 2012. Reason unknown: cache, filtering or product difference remains possible. Use original files, record definitions, and resolve before publishing any ratio. The original season portal describes weekly updates. The [RDA method](https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/rapid-damage-assessment) qualifies the approximately 30 ha threshold: smaller Sentinel-2 scars are included since 2018; intentional vegetation burning may also be included. Do not copy a universal 30 ha cutoff.

[EFFIS license](https://forest-fire.emergency.copernicus.eu/about-effis/data-license) permits EU-owned website content under CC BY 4.0 unless indicated otherwise, with credit and modifications identified; third-party content can require separate permission. Snapshot evidence preserves source/license pages. No auth was needed for tested APIs; quotas/SLA/CORS were not established. Fetch centrally and cache, retain exports and dates, and tolerate schema/service failure.

## MKFFIS: additional national evidence

The official [MKFFIS portal](https://mkffis.cuk.gov.mk/index.php/pocetna_strana/pocetna?lang=en) loads public `js/map_igor_backup.js`, which names `http://mkffis1.cuk.gov.mk:8080/geoserver/wms` and WFS. A normal unauthenticated [WMS capabilities request](http://mkffis1.cuk.gov.mk:8080/geoserver/wms?service=WMS&request=GetCapabilities&version=1.3.0) returned 6,885 named layers. Counts by name/title match: 5,108 FWI and 625 VDM. Representative metadata is in [selected catalog](wildfiresignal/mkffis-selected-layers.json) and [capability excerpt](wildfiresignal/mkffis-capabilities-excerpt.xml); redundant full metadata was reduced, with original hashes retained.

Verified layers: `fwibeta:fwi20261114_tif`, `fwibeta:fwi20261115_tif`, `VDM:VDM_20261109_20261116_tif`. Future names are not proof of actual valid forecast periods. `Makedonija:Opstini` and `Makedonija:NaseleniMesta` advertise municipal/settlement context, not a verified current boundary dataset/license.

Actual GetMap PNGs and legends were downloaded and visually inspected. FWI legend: Very Low/Low/Moderate/High/Very High; VDM: NA/Low/Medium/High. WMS 1.1.1 uses `srs=EPSG:4326`, bbox `20.3,40.7,23.1,42.5`, 500×360 output. `GetFeatureInfo` at x225/y200 returned `GRAY_INDEX=2.2018487453460693` for dated FWI ([value](wildfiresignal/mkffis-fwi-feature-info.txt)). This proves one numeric sample, not local accuracy, units, methods, issue time or an entire scientific raster.

WCS 2.0.1 DescribeCoverage returned a server NullPointerException; no WCS raster download was proved. JSON GetFeatureInfo was rejected with supported formats listed; text/plain then succeeded. Plain HTTP/8080 prevents straightforward loading within an HTTPS website and exposes transport to alteration. Public access is not a reuse license: no redistribution permission, update contract or forecast validation was located. Keep downloaded samples as research; obtain provenance/rights before publication. Do not silently proxy an unapproved national feed or substitute legend classes for calibrated spread inputs.

## Next action

Parent can promote the three proven official EFFIS JSON responses with manifest and attribution, and the small MKFFIS sample/legend/value evidence with publication blocked pending rights/methods. ApexFire's strongest existing distinction remains honest multi-year exploration, incident progression and an inspectable experimental model. Add one sourced seasonal panel first; do not expand scope into unverified incident alerts or heuristic risk scores.

Used: public GETs, standard-library JSON/XML parsing, image inspection; no subagents. Friction: restricted network needed approved public reads; WCS metadata failed. Unverified: server internals, quotas/CORS/SLA, boundary currency, MKFFIS reuse rights/methods/accuracy, operational latency and cause of EFFIS-total discrepancy.
