# ApexFire fire stories (EFFIS-mapped fires, 2016–2025)

Eight stories in `web/public/data/stories/fires/`. The list lives in `tools/fire_stories.json`, the raw inputs are fetched by `tools/fetch_fire_stories.py` into `Data/readiness/stories/<id>/`, and `export_fire_stories()` in `tools/export_web_data.py` builds the files. Retrieved 15 Nov 2026.

## Selection rule

The source of truth is the EFFIS burned-area WFS (`ms:modis.ba.poly.<year>`, country bounding box, `COUNTRY = MK`). The layers for 2016–2025 were queried. Stories were chosen for mapped size, at least four days with satellite detections in the ApexFire archive, and a spread of years and regions. Brvenica 2017 and the September 2024 Mariovo/Prilep event (EFFIS 240660) already have stories, so they are excluded. Novaci 2024 (EFFIS 237729, 9–13 Aug) is a separate, earlier event.

Detections are archive MODIS and VIIRS points inside the perimeter buffered by 1.5 km. Algorithm type 2 (static land source) is excluded. The window opens two days before the EFFIS fire date and ends one day after the last detection day of the fire's run, where a run allows at most two empty days in a row. A window is at most 21 days. Weather is ERA5 hourly data from the Open-Meteo archive API at the cell nearest the perimeter centroid. It covers the window plus the 60 noon (11:00 UTC) values before it, so the site can spin up the Fire Weather Index.

| Story | EFFIS id | EFFIS dates | Area (ha) | Window | Detections | Peak day |
| --- | --- | --- | --- | --- | --- | --- |
| saraj-2017 | 11439 | 2017-07-31 → 2017-08-05 | 1,813 | 2017-07-29 → 2017-08-10 (13 d) | 112 | 2017-08-05 |
| makedonski-brod-2019 | 17776 | 2019-09-13 → 2019-09-17 | 1,749 | 2019-09-11 → 2019-09-18 (8 d) | 140 | 2019-09-15 |
| pehcevo-2021 | 52627 | 2021-08-02 → 2021-08-07 | 5,413 | 2021-07-31 → 2021-08-11 (12 d) | 645 | 2021-08-05 |
| kumanovo-2021 | 52629 | 2021-08-02 → 2021-08-05 | 1,723 | 2021-07-31 → 2021-08-06 (7 d) | 115 | 2021-08-03 |
| stip-2024 | 234079 | 2024-07-14 → 2024-07-18 | 13,335 | 2024-07-12 → 2024-07-31 (20 d) | 966 | 2024-07-15 |
| sveti-nikole-2024 | 235779 | 2024-07-28 → 2024-08-01 | 12,051 | 2024-07-26 → 2024-08-04 (10 d) | 1,109 | 2024-07-30 |
| novaci-2024 | 237729 | 2024-08-09 → 2024-08-13 | 11,224 | 2024-08-07 → 2024-08-17 (11 d) | 1,104 | 2024-08-11 |
| vasilevo-2025 | 275587 | 2025-07-17 → 2025-07-21 | 5,227 | 2025-07-15 → 2025-07-31 (17 d) | 1,405 | 2025-07-27 |
| cesinovo-2016 | 10145 | 2016-08-30 → 2016-08-31 | 1,789 | 2016-08-28 → 2016-09-01 (5 d) | 53 | 2016-08-30 |
| negotino-2022 | 206923 | 2022-07-25 → 2022-07-27 | 587 | 2022-07-23 → 2022-07-28 (6 d) | 83 | 2022-07-26 |
| prilep-2023 | 221991 | 2023-09-30 → 2023-09-30 | 1,259 | 2023-09-28 → 2023-10-01 (4 d) | 8 | 2023-09-30 |
| mogila-2023 | 221254 | 2023-09-23 → 2023-09-24 | 1,214 | 2023-09-21 → 2023-09-25 (5 d) | 160 | 2023-09-23 |

Added 15 Nov 2026 at SAI's request: the largest North Macedonia fire in the EFFIS 2016, 2022 and 2023 layers. 2022 was a mild year (no fire over 600 ha). **Prilep 2023 has thin detection coverage** (8 detections, one day) although EFFIS maps 1,259 ha in a one-day record; a short, fast fire, clouds or overpass timing can explain it, the data cannot say which. Mogila 221254 (1,214 ha, 23–24 Sep) was added the same day for better 2023 coverage: 160 detections on 3 days. No other EFFIS 2023 perimeter lies within 5 km of it, so detections just outside its outline (inside the 1.5 km margin) are not from a neighbouring mapped fire; the Novaci 221543 fire of 21–23 Sep is not near it. Another 2023 option: Češinovo-Obleševo 219182 (1,030 ha, 25–26 Aug).

Each story file records its exact EFFIS query URL and land-cover percentages, and the raw metadata records each file's sha256.

## Context sources (verified pages only)

- Pehčevo 2021: [MIA, 4 Aug 2021](https://mia.mk/en/story/ten-wildfires-active-nationwide-firefighting-helicopters-ordered-to-retreat-from-pehchevo-region). A squadron of five firefighting helicopters was pulled back because of extreme heat, and the fire was spreading toward Berovo.
- Štip 2024: [ANSA, 14 Jul 2024](https://ansa.it/nuova_europa/en/news/sections/culture/2024/07/14/wild-fires-and-heatwave-n.-macedonia-proclaims-state-of-crises_a0066ed4-b940-47fc-b6c3-7d85a79a581b.html). Parliament declared a 30-day nationwide crisis situation on the night of 13 July. The article does not name Štip.
- No context was added for the other stories: nothing about them specifically was verified on a reputable page.

## Limits

- **Mapped area, detections and ignition are three different measures.** The EFFIS area is a satellite-mapped final perimeter, and its FIREDATE and FINALDATE are mapping dates. A detection is a hot pixel at an overpass time. The first detection is not the ignition, and the last is not extinguishment. `hull_km2` is the span of detections, not burned area.
- **Some windows run past the EFFIS final date.** In Štip (to 31 Jul) and Vasilevo (peak on 27 Jul, six days after FINALDATE), detections keep appearing inside the perimeter. They can be later spread inside the mapped area, a later EFFIS update (LASTUPDATE 26 Jul 2024 and 28 Jul 2025), or a separate fire on the same ground. The data cannot tell these apart.
- **Detection counts depend on the sensors available.** Years with three VIIRS satellites (2023 on) have far more points than 2017 (MODIS + S-NPP). Counts are not comparable across years as a measure of intensity.
- **ERA5 is regional weather.** The grid is about 25 km, and valley winds and slope effects are not resolved.
