# Additional sources from Watch Fire and WildfireSignal

Checked 14 November 2026. **Sixteen original-provider assets (9.27 MB) are downloaded and contract/hash-checked, plus seven small MKFFIS research artifacts and a local perimeter-comparison summary. No website or cloud integration was built.** These findings extend the earlier readiness work; the roadmap remains in PROJECT.md (local-only), and implementation contracts in [the website specification](../website-spec.md).

Read the separate investigations for competitor behavior and evidence: [Watch Fire](../research/watch-fire.md), [WildfireSignal North Macedonia](../research/wildfiresignal.md). The parent also inspected both rendered interfaces; [observation summary](../research/watch-fire/parent-ui-observations.json). No competitor application code or proprietary feed is adopted as a production dependency.

## What was acquired and what to use

All original requests, local paths, byte counts, hashes, retrieval times and checks are in [the source manifest](../../Data/readiness/additional-sources/manifest.json). The download area is private preparation storage; publication still requires a small attributed export, never a copy of this whole folder.

| Source / local artifact under `Data/readiness/additional-sources/` | Verified result | Recommendation / material limit |
| --- | --- | --- |
| `effis-weekly-mkd-2026.json` | Original EFFIS `banfweekly`/`banfcumulative`, 52 rows each | Add a separate seasonal mapped-area/event panel. Latest nonnull cumulative row: **11 Nov 2026, 25,323 ha / 69 mapped events**. Future weeks are null, not zero. |
| `effis-annual-mkd.json` | 21 original country rows, 2006–2026, `year,ba,nf`; 2026 agrees with weekly | Historical mapped-area context; partial current year is not a completed annual total. This differs from FIRMS detector counts and our MODIS burned-area raster. |
| `effis-thermal-weekly-mkd-2026.json` | 52 weekly + 52 cumulative rows with separate MODIS / NOAA VIIRS / Suomi counts and reference ranges | External aggregate cross-check for research. Product aggregation and coverage differ from our raw archive; it is not a harmonized metric or a substitute for missing source files. |
| `effis-mk-region-burned-areas-2024.geojson`, `effis-mk-region-burned-areas-recent-week.geojson` | Original EFFIS WFS: **387 regional 2024 polygons, 206 marked COUNTRY=MK**; valid empty recent-week collection. 2024 `numberMatched=387` equals the returned count; the valid empty response omits that optional field. | Source-backed mapped-area/case candidates. Empty recent view is not an all-clear. No 2024 geometry intersects the earlier Mariovo reference; that discrepancy remains unresolved. |
| `gibs-epsg3857-capabilities.xml`, two dated JPEG tiles | Selected MODIS Terra true-color layer and `GoogleMapsCompatible_Level9` verified; 256 px browse tiles at z6 and z9, **2 Sep 2024**; z9 x286/y191 covers Mariovo | Add optional dated satellite imagery for a case. Tiles visually inspected; clouds/obscuration remain. Browse color is not numeric reflectance, severity or a perimeter. |
| `cams-europe-skopje-48h.json` | **48 contiguous hourly samples**, PM10/PM2.5/CO in **μg/m³**, European AQI unit **EAQI**, explicit `cams_europe`, UTC; returned grid 42.0 N / 21.400002 E | Optional modeled air-quality context, about 11 km domain resolution. Does not attribute pollution to a wildfire, represent a station reading or provide a smoke plume. |
| `met-norway-skopje.json` | 91 forecast samples; source updated 14 Nov 19:17:36 UTC; 14 Nov 20:00–24 Nov 00:00 UTC; explicit units and cache headers | A viable alternative/fallback, not evidence of superior local skill. Forecast steps are not uniformly hourly. Keep Open-Meteo primary. |
| `geoboundaries-mkd-adm0-metadata.json` + `geoboundaries-mkd-adm0.geojson` | One national polygon feature, 2,099 coordinate vertices, 2016 represented boundary, CC BY 4.0 | Country mask/context and fit-to-country. It is a dated reference geometry, not legal/current border authority. Use actual `.geojson` filename from manifest. |
| `geoboundaries-mkd-adm1-metadata.json` + `geoboundaries-mkd-adm1.geojson` | **Eight regional features**, 3,886 coordinate vertices, 2016 represented boundary, CC BY 4.0 | Regional views later; **not 80 municipalities**. No assumed ID crosswalk with other providers. |
| `geonames-mk.zip` | **25,482 records**, 19-column UTF-8, WGS84, including **2,773 populated places** | Prepare a small local place-search/context subset. No API key or per-user geocoding call needed. Preserve names/alternates/IDs; population is not live and nearest place is not an official incident name. |
| `mkffis-research/` + separate manifest | Current dated FWI/vegetation-dryness PNGs, legends, selected capabilities and **one numeric FWI pixel** | Research only until reuse rights, methods, issue/valid times and transport are established. Do not publish these layers or use VDM as fuel-moisture forcing by assumption. |

For exact boundary filenames: `geoboundaries-mkd-adm0-metadata.json`, `geoboundaries-mkd-adm0.geojson`, and the corresponding `adm1` pair. Source counts exclude earlier readiness/case data.

## Direct acquisition routes and credentials

**No new API key or paid account was required for these acquisitions.** The NASA Earthdata bearer is not needed by GIBS or EONET, and FIRMS retains its separate MAP_KEY. Do not create additional accounts simply because a competitor lists a source.

| Source | Best route | Access / attribution / refresh |
| --- | --- | --- |
| EFFIS seasonal area/events | `https://api2.effis.emergency.copernicus.eu/statistics/v2/effis/weekly?country=MKD&year=2026`; annual: `/statistics/v2/effis/estimatesbycountry?country=MKD` | Public HTTPS JSON; cache centrally, suggested daily check for a weekly publication, not per visitor. EU/EFFIS credit, CC BY 4.0 unless source exception. The public application endpoint has no verified SLA/quota contract. |
| EFFIS thermal aggregates | Same host, `/statistics/v2/ta/weekly?country=MKD&year=2026` | Public JSON; keep native product fields and null future values; suitable for a source comparison, not scientific validation. |
| EFFIS mapped polygons | `https://maps.effis.emergency.copernicus.eu/effis`, WFS 2 GetFeature, tested `ms:modis.ba.poly.2024` / `ms:modis.ba.poly.week` | Use exact requests in manifest: EPSG:4326 bbox is **latitude first** under WFS 2; returned GeoJSON is longitude/latitude. Check `numberMatched`; bounded count 500 is not a global download. EFFIS CC BY/source exceptions. |
| GIBS | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/` plus layer/date/matrix/z/y/x from capabilities | No auth. Tested layer `MODIS_Terra_CorrectedReflectance_TrueColor`, matrix `GoogleMapsCompatible_Level9`, JPEG, max zoom 9. Never invent `current` dates or interpolate acquisition time from a day composite. NASA/GIBS plus product attribution/terms. |
| CAMS through Open-Meteo | `https://air-quality-api.open-meteo.com/v1/air-quality`, explicit coordinates, variables, `domains=cams_europe`, `timezone=UTC` | No key for eligible free noncommercial service; credit **CAMS ENSEMBLE and Open-Meteo**, retain validity/model/grid and original units. Hourly values do not imply hourly model updates. Cache with named-area weather pipeline; domain refresh is daily. |
| MET Norway | `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=41.9981&lon=21.4254` | Identifying application User-Agent and server cache required. Outside Nordic region, allow at least **three hours between identical requests**, honor longer Expires/conditional-cache rules, avoid synchronized on-the-hour calls. CC BY 4.0; review current terms before operating the client. |
| geoBoundaries | `https://www.geoboundaries.org/api/current/gbOpen/MKD/ADM0/` and `ADM1/`; follow `gjDownloadURL` | No key; metadata pins source/release/license. Download once and publish a versioned compact derivative with CC BY 4.0/source credit. Do not treat the API's word “current” as the represented border year. |
| GeoNames | `https://download.geonames.org/export/dump/MK.zip` | No key for country download, CC BY 4.0. Read only `MK.txt` with a size bound, not unsafe ZIP extraction. A live GeoNames web-service username/credit budget is unnecessary for local search. |
| EONET v3 | `/api/v3/events?category=wildfires&status=all&start=2024-01-01&end=2024-12-31&bbox=20.4,42.5,23.1,40.8&limit=100` on `https://eonet.gsfc.nasa.gov` | No key; **four curated 2024 regional events** downloaded. Bbox order is west,north,east,south. Retain upstream source links. Some events reference the same GDACS inputs already held, so this is not independent corroboration. Incomplete incident catalog; closed/date times are not exact incident truth. |

## Source discrepancy that must survive integration

WildfireSignal showed **27,913 ha / 94** and historical averages **29,461.86 ha / 106.79** for 11 November 2026. Original EFFIS weekly and annual responses both instead yield **25,323 ha / 69**; the weekly same-row reference values are **16,873.5 ha / 41.8**, with `min_year=2006`. The competitor text says since 2012. Cause remains **UNKNOWN**; an older cache, filtering or product selection may differ. Do not repeat its totals, ratios or baseline claim. Use one named original product/cutoff and document its baseline before publishing a comparison. Avoid adding area measurements from unrelated products together.

Also distinguish a “six-hour window ending at latest observation” from “last six hours now.” The former can contain old data. ApexFire should anchor live rolling windows to an explicit current UTC end and separately show observation age.

The direct EFFIS 2024 regional query returned 387 features, 206 marked MK, with **no geometry intersecting the existing secondary Mariovo reference**. [Comparison summary](../../Data/readiness/additional-sources/mariovo-official-comparison.json) records the tested layer and country counts. Absence in this product does not establish no fire. It does leave the earlier roughly 10,265 ha reference unconfirmed, with derived overlap statistics conditional on that geometry. Do not call it an independently verified official perimeter or predictive ground truth. Brvenica remains the stronger confirmed replay.

The [official RDA method](https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/rapid-damage-assessment) also qualifies the competitor's approximately 30-ha cutoff: Sentinel-2 supports smaller scars since 2018. Classified MODIS/Sentinel-2 scars and automatic VIIRS hotspot-derived polygons have different methods and statistical use. Source start/last dates need not equal ignition/extinction.

## MKFFIS national service: proven access, pending adoption

The [official national portal](https://mkffis.cuk.gov.mk/index.php/pocetna_strana/pocetna?lang=en) declares public WMS/WFS services at `http://mkffis1.cuk.gov.mk:8080/geoserver/`. Selected WMS capabilities advertise FWI, vegetation-dryness, municipality and settlement layers. Exact successful GetMap/GetLegendGraphic/GetFeatureInfo URLs and hashes are retained in [the original research manifest](../research/wildfiresignal/manifest.json) and [promoted research manifest](../../Data/readiness/additional-sources/mkffis-research-manifest.json).

Actual samples: `fwibeta:fwi20261114_tif`, `VDM:VDM_20261109_20261116_tif`, their legends, and `GRAY_INDEX=2.2018487453460693` at one requested FWI pixel. The later file name advertises a period, but does not independently establish forecast issue/valid times. WCS DescribeCoverage failed with a server exception, so **no numeric raster download is verified**. The numeric pixel is not a fuel-moisture ratio, probability or spread rate. WMS images are styled visualizations.

The observed endpoint is plain HTTP/8080: HTTPS browsers can block it, and the connection lacks TLS integrity. No public reuse license or operational update/method contract was found. Keep it as an outbound official reference now. Later request/locate permission and a documented HTTPS or controlled source-extraction path; do not silently proxy it or assume that another website's link grants rights. No email or request to officials has been sent.

## Useful sources deliberately not bulk-downloaded

These are real acquisition paths, not missing core inputs hidden as completed work. Their features remain later in PROJECT.md.

- **GHSL:** use the [original download wizard](https://human-settlement.emergency.copernicus.eu/downloadWizard.php) / [population tiles](https://human-settlement.emergency.copernicus.eu/download.php?ds=pop), choose release/epoch/resolution/CRS and only intersecting tiles, then crop locally. No key. Keep source acknowledgments and sum-conserving population treatment. 2025/2030 population may be projections, not counts of people present. Full tiles were not acquired because no first-release population/exposure calculation is specified.
- **Overture buildings/places:** [official area download](https://docs.overturemaps.org/getting-data/) supports bbox-filtered GeoJSON through the Explorer/Python client or GeoParquet/DuckDB; no key for public data. Pin the actual release; retain per-theme/source [attribution and license](https://docs.overturemaps.org/attribution/). This is an additional provenance candidate found in Watch Fire's public client but absent from its inspected source FAQ; runtime use is not established. Do not adopt its “exact” label as building completeness or exposure accuracy. No new package/global download is needed for the first demo.
- **Protected Planet WDPA:** v4 requires a token, acceptance of current terms and noncommercial eligibility; v3 is obsolete. Download country data or use API only after verifying redistribution/geometry rights. Public website access is insufficient. **GBIF:** small anonymous occurrence lookup is possible; reproducible bulk download uses account/DOI and per-record CC0/CC BY/CC BY-NC licenses. Do not republish sensitive coordinates or infer casualties/present population. **IUCN:** token and restrictive use/visualization terms need review. These are not universal unrestricted datasets.
- **ReliefWeb:** needs a pre-approved appname under current API rules; preserve publisher content rights. **GDELT:** useful article discovery, not a licensed news-image archive or a complete official MK incident registry. **EMS Rapid Mapping:** acquire by actual activation/product, where available. **GDACS:** retain existing case inputs and add bounded official GeoJSON searches only for a needed case. EONET can help locate links without duplicating source evidence.
- **OpenTopoData:** point elevation fallback with dataset-specific rights; existing NASADEM rasters are better model inputs here. **US NIFC/Canada CWFIS/national FR/IT/NL reports** do not solve Macedonian coverage. **ADSB.lol aircraft** add no first-release core value; flight location does not establish firefighting assignment. Avoid broad background ingestion of these sources.

See [Watch Fire research](../research/watch-fire.md) for primary links and access conditions for restricted sources. None of these account/token workflows was initiated.

## Integration order and checks

Use the boundary/gazetteer in N1–N2 exports; keep lookup offline and small. Add the sourced EFFIS season panel to N4, with an explicit saved/connected state. GIBS is optional N3 imagery after the existing HLS evidence works. CAMS is an optional N4 context card; missing AQ never prevents detection browsing. Keep MET as a tested fallback/comparison with its own cache policy; do not silently merge forecasts. MKFFIS link/context is usable now; data ingestion remains pending rights/method/transport.

Reproduce without re-polling:

```sh
python3 tools/check_additional_sources.py --self-test
python3 tools/check_additional_sources.py --verify-saved
```

`--fetch` performs new bounded original-provider requests and refreshes its own proof manifest. Do not repeat it within MET's minimum interval merely to verify unchanged files. The first CAMS validator expected a human-readable AQI unit; the actual API returns `EAQI`. The assumption was corrected and a regression check added; the retained response now passes. The manifest records the resolved issue. National research has separate hashes/rights status and is not silently approved by these source checks.

Verified: saved JSON/geometry/ZIP contracts, byte hashes, original EFFIS consistency, actual map interfaces and imagery inspection. Unverified: forecast/spread skill, operational latency, MKFFIS rights/methods/secure distribution, GHSL/Overture local binaries, restricted accounts, source API uptime and any website integration.
