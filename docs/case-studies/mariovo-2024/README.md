# Mariovo / Prilep fire, September 2024

**Later provenance check, 14 November 2026:** an original EFFIS 2024 regional WFS query returned 387 polygons (206 marked MK), with none spatially intersecting the secondary WorldFires reference used below. This does not establish no fire or invalidate the separately sourced imagery, but the claimed EFFIS attribution/extent has not been matched to that original product. Treat reference-based overlap/area figures as conditional on an unconfirmed secondary geometry; do not use it as authoritative incident extent or model-validation truth. [Query/comparison evidence](../../readiness/additional-sources.md). Existing inputs and metrics are preserved.

This case study checks whether ApexFire's local hotspot archive and a small set of public satellite, terrain, land-cover and weather products support a useful historical incident view. It is evidence about data coverage and processing, not an app-scope decision or a validated fire-spread model.

## Event and reference boundary

Copernicus describes a major Mariovo fire visible on 4 September 2024, affecting more than 11,000 ha, with rain on 6–7 September bringing it under control. The Prilep Red Cross reported impacts around Bonče, Peštani, Kruševica, Kokre, Kalen, Dunje and Volkovo. The case boundary is a public geometry attributed by WorldFires to EFFIS / Copernicus EMS; WorldFires reports 10,265 ha. Its projected geometry is valid, one polygon part and 10,242 ha, 0.22% below that reported figure. The 11,000 ha visual estimate and this mapped polygon are different reporting products, not a matched-area validation. This is a secondary mirror of an EFFIS-attributed geometry; the official EFFIS archive was not independently downloaded.

Sources: [Copernicus event overview](https://eu-space.europa.eu/components/earth-observation-copernicus/image-of-the-day/north-macedonia-has-faced-severe-fire-season-2024), [Prilep Red Cross field report](https://www.crvenkrst-prilep.org.mk/pozhar-vo-mariovo/), [WorldFires record and API](https://worldfires.org/en/fire/mariovo-2024-09), [EFFIS data and services](https://forest-fire.emergency.copernicus.eu/applications/data-and-services).

## Data acquired

| Input | Local coverage | What it supports | Limit |
| --- | --- | --- | --- |
| HLS Sentinel-2 S30 | Three dates: 23 Aug, 2 Sep and 12 Sep; six bands/QA per date, cropped to the perimeter plus buffer | Pre/post spectral comparison and 30 m visual context | Snapshots, not daily growth observations; QA masks remove substantial area on 2 Sep |
| MODIS MCD64A1 C6.1 | September 2024 Burn_Date and QA, native grid about 463 m | Independent coarse burned-area product and approximate burn timing | A cell is about 21.5 ha; 500 m cells cannot trace a detailed incident edge |
| NASADEM | Elevation crop from the 2000 source | Elevation and rough slope context | Old terrain surface; slope is derived after reprojection and is not a fuel or wind model |
| ESA WorldCover 2021 | 10 m source sampled to the 30 m HLS grid | Broad pre-fire cover context | The map is three years old and its classes are not fuel types, canopy parameters or fuel moisture |
| ApexFire FIRMS-style CSVs | Existing MODIS, NOAA-20 and Suomi-NPP detections in 1–7 Sep | Hotspot timeline by sensor | Detections are not boundaries; sensor counts can include repeat observations and are not added as unique fires |
| Open-Meteo Historical Forecast | ECMWF IFS HRES requested; 1–7 Sep hourly wind, gust, temperature, humidity and precipitation at the model's snapped point | Retrospective forecast-weather context | One model-grid point, not local station data; archived forecast context is not fire-spread validation |

The downloaded reference perimeter, raster windows, original STAC metadata, weather response and checksums are in [`Data/case-studies/mariovo-2024`](../../../Data/case-studies/mariovo-2024). Weather output snaps the requested coordinate (41.27, 21.65) to 41.300526, 21.692970 at 898 m. The request explicitly selects ECMWF IFS HRES; Open-Meteo documents its Historical Forecast API as archived forecast output and its ECMWF IFS HRES grid as 9 km. That grid is suitable for broad incident weather context, not resolving valley-scale winds. [Historical Forecast documentation](https://open-meteo.com/en/docs/historical-forecast-api), [ECMWF model details](https://open-meteo.com/en/docs/ecmwf-api).

HLS QA interpretation follows the [NASA/USGS HLS v2 guide](https://lpdaac.usgs.gov/documents/1698/HLS_User_Guide_V2.pdf); the burned-area band and QA follow the [MCD64A1 Collection 6.1 guide](https://modis-land.gsfc.nasa.gov/pdf/MODIS_C61_BA_User_Guide_1.0.pdf).

Open-Meteo's hosted free endpoint is limited to non-commercial use, has request limits and no uptime or accuracy guarantee. The data licence and service terms are separate; if ApexFire becomes commercial or carries advertising, the free endpoint is not an authorized default. [Terms](https://open-meteo.com/en/terms).

## Findings

- HLS strict-usable coverage inside the reference boundary is 82.2% on 23 Aug, 59.4% on 2 Sep and 99.8% on 12 Sep. On 2 Sep the whole-tile cloud metadata says 1%, while 40.4% of pixels inside this particular perimeter are high-aerosol QA class. This is why the local mask is a better guide than the tile-wide cloud percentage.
- The 23 Aug to 12 Sep median dNBR is 0.271 in the perimeter, with both dates usable over 82.0% of the polygon. A threshold of 0.2 marks about 5,801 ha inside the boundary; a threshold of 0.1 also marks 1,255 ha in the surrounding crop. These are threshold-sensitivity results, not calibrated severity classes or a burned-area estimate.
- MCD64A1 marks 185 valid 500 m cells with burn dates 1–6 Sep inside the perimeter. Multiplying by nominal cell area gives about 3,971 ha, 38.7% of the EFFIS-reported area. This is a coarse-product discrepancy to investigate, not evidence that the other 62% did not burn.
- Existing CSVs contain 16 MODIS, 259 NOAA-20 and 263 Suomi-NPP detections inside the reference polygon from 1–7 Sep. Counts differ across sensors; repeat passes, resolution, overpass timing and archive versions prevent treating these as unique fires or exact perimeter evidence.
- The boundary covers roughly 524–1,648 m elevation, with an approximate median slope of 17.0°. Sampled WorldCover classes are about 70.1% grassland and 29.7% tree cover. Neither says what the live fuel model or moisture was during the event.
- The hourly weather archive supplies wind direction/speed/gusts, temperature, humidity and precipitation. At its single grid point, 10 m wind speed has a 1.25 m/s median and 4.25 m/s maximum, gusts peak at 12.1 m/s, total precipitation is 3.3 mm, temperature ranges 14.6–28.3°C and relative humidity 26–81%. The circular mean wind direction is 59.9° **from** north under the meteorological convention. One gridded series cannot establish local wind or explain observed fire growth.

The machine-readable results and methods are in [`metrics.json`](metrics.json); the derived figure is [`evidence-overview.png`](evidence-overview.png). Recreate the figure, rasters and metrics with `UV_CACHE_DIR=/private/tmp/firewatch-uv-cache MPLCONFIGDIR=/private/tmp/firewatch-mpl uv run --offline --with-requirements tools/requirements.txt python tools/analyze_mariovo_case.py`. Re-fetch public inputs with `UV_CACHE_DIR=/private/tmp/firewatch-uv-cache uv run --offline --with-requirements tools/requirements.txt python tools/fetch_mariovo_data.py`; this requires access to the public source endpoints.

## What this can support before deciding scope

This is enough to prototype a **historical incident evidence view**: map hotspots over time, show a source perimeter, compare selected pre/post HLS scenes, and display broad terrain, cover and weather context with visible dates, QA and provenance. The data also support a small retrospective product comparison exercise.

This case does **not** yet support an operational fire-front forecast, rate-of-spread, arrival-time estimate, calibrated probability or reliable burned-hectare estimate from hotspots. Those require incident starting perimeters with times, local fuel/canopy parameters and moisture, appropriate weather history, and multiple independently mapped perimeters for validation. Treat any future spread calculation as an experiment until it beats simple baselines on held-out local incidents.

Open-Meteo requests use no key. No Meteomatics credential, Google Cloud ADC, project ID or credits were used. Meteomatics is technically useful as a second weather source: its official MCP is an AI-agent connector using OAuth and account entitlements, while a deployed app would need to call its REST API with credentials protected outside the client. The provider lists wind speed/direction, gusts and historical/current/forecast data, but the user's account entitlements and quota were not checked. [Meteomatics MCP](https://www.meteomatics.com/en/api/data-connectors/mcp/), [weather parameters](https://www.meteomatics.com/en/api/available-parameters/weather-parameter/).
