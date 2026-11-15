# Firemap Live: capabilities, data interfaces and reuse

Inspected 14 November 2026. Target: https://www.firemap.live/#2/35/-40. Status: **public interface and bounded data access verified; private processing, scientific accuracy and reuse scope unresolved**.

## Conclusion

Firemap is a useful monitoring benchmark, with substantial overlap with ApexFire: satellite hotspots, agency records, burned-area layers, wind, satellite imagery, geographic context and shareable map views. It is not evidence that ApexFire's historical MODIS/VIIRS harmonization or experimental spread objective is already solved. In particular, its “Hotspot forecast” code queries upcoming **satellite passes**, not the future movement of a fire front. Wind particles display a weather field, not burning vegetation.

The public map exposes readable JavaScript, standard WFS feature queries, WMTS vector/raster tiles, weather manifests and satellite-image manifests. These interfaces let us identify and inspect publicly served data. They do not reveal the private database, server-side ETL, clustering/noise-filtering algorithms, all historical records, or private account resources. No official Firemap source repository was established by the bounded GitHub search.

## Evidence and scope

- Root HTML: HTTP 200; 55,259 bytes; SHA-256 `47632bc8c3f808ff879006e94fc93ecbf20fcff603b8848af00189254d3b40b0`; version marker `20261110d`.
- Downloaded six explicitly referenced public scripts and extracted inline scripts into `/private/tmp/firewatch-firemap-research/client`. This disposable research material is outside ApexFire application source. No proprietary code was copied into an application.
- REA static analysis parent: `ev_a3636b20a73047d1ac748f7a4e79b23bab5022454990f529330024b41ae031f1`; extracted-tree identity `e5ab86092fe68e498662109d69e35feb8bfd23f347b063de95ee3e05947e7fdd`. Seven selected JavaScript files parsed without syntax failures. Eight inventoried files were outside the selected analysis; semantic graph coverage was partial and node-budget limited. This is not a complete code audit.
- REA global browser scenario: `ev_eedfbb4381f88db703c3a5e8b70f7ffc549536ce8421b86838f9de77d0d9b5a1`. Initial navigation plus a seven-second wait. Selected network bodies exceeded the provider's 16 concurrent-read budget; some content unavailable. Complete network capture is not claimed.
- REA Macedonia browser scenario: `ev_6e2cc391cc849edafb44f2f242dfce8238391679bbbad042584adc4a0db46192`. Opened `?lat=41.6&lng=21.7&zoom=7`, waited six seconds and opened Toggle Layers. DOM/accessibility and response metadata established the map location, visible controls and requests. Provider reported complete selected capture, no page errors, and terminated its owned browser. This does not establish every layer's accuracy, freshness or geographic completeness.
- Independently fetched WFS capabilities and at most one feature for five selected layers, five features for one MK-area query, and one European-point feature. Saved response bytes and hashes; no whole-database download, credential reuse, login or access bypass.

Retained evidence: [sanitized REA summary](firemap-live/rea-evidence-summary.json), [acquisition summary](firemap-live/acquisition-summary.json), [WFS capabilities](firemap-live/wfs-capabilities.xml), [investigation state](firemap-live/REA-TASK.md). Raw global browser captures are not published; they contain unrelated analytics and vendor URL material. The summary retains only relevant response metadata and limitations.

## Observed capabilities against ApexFire

| Capability | Evidence in Firemap | Implication for ApexFire |
| --- | --- | --- |
| Global map and regional layers | Live map, search, share, distance, basemap and layer controls | Strong interaction reference; implement our own identity and flows |
| NASA thermal observations | Global hotspot tiles and sampled WFS points; sensor/time fields | Direct NASA acquisition remains preferable for raw confidence/FRP/provenance |
| Multi-sensor clusters | Cluster point layer with activity and area summaries | Clustering is not historical sensor harmonization; server method unverified |
| Agency incident context | US/Canada/Australia layers; European point path | Country-specific context does not establish complete official MK reporting |
| European geostationary heat | FCI footprint layer and related point fields | Promising additional observations; obtain original LSA SAF products and verify local access |
| Burned-area polygons | Public polygon layer and historical layer references | Sample geometry alone does not establish dates, product or progression |
| Wind | GFS forecast frames and moving particles | Weather context only; ApexFire can retain its Open-Meteo direction |
| Fire weather | US feature FWI values; Canadian danger card | Does not establish an available Macedonian FWI feed |
| Smoke | ECCC RDAQA, explicitly North America in current About | Does not fill the MK smoke-data gap |
| Satellite imagery and tracks | GeoColor manifests and satellite orbit requests | Monitoring context, not a spread simulator |
| “Hotspot forecast” | `satellite_next_pass_northamerica` and upcoming-pass card | Predicts observation opportunity, not burning or ignition |
| Long-term sensor-harmonized calendar | Not demonstrated by inspected runtime/source subset | ApexFire still needs a method and evaluation |
| Fire-front growth/arrival model | Not established in inspected evidence | Do not infer it from wind, imagery animation or “forecast” labels |
| Fire notifications | No subscription/alert-delivery flow established | New-feature banner code is not wildfire notification delivery |

## Public data-source registry

The [WFS capabilities response](firemap-live/wfs-capabilities.xml) advertised **24 feature types** at capture, including deprecated/test variants. That is an exposed service inventory, not every internal dataset. WFS base: `https://geo.firemap.live/geoserver/ows`; WMTS base: `https://geo.firemap.live/geoserver/gwc/service/wmts`.

| Layer or family | Public interface observed | Data and limitations | Preferred ApexFire route |
| --- | --- | --- | --- |
| Global thermal points | `FireDB:firms_hotspot_pt_slim`, WMTS + WFS | One point sampled; 226,323 matches reported at that instant. Fields include satellite name, detection epoch and age; the sample lacks raw FRP/confidence/product revision | NASA FIRMS NOAA-20/21 plus historical archive; retain original attributes |
| Hotspot clusters | `FireDB:combined_fire_pt_active`, WFS | One global sample; fields activity rating, area, returns in 24 h. These are processed summaries, not confirmed incident counts or measured burned hectares | Define and validate our own transparent grouping if needed |
| Early detection candidates | `global_fire_early_detection_latest`, `global_fire_early_detection_buffer1km` | Advertised by service and present in source; not independently sampled or algorithm-validated | Treat as research reference, not training truth |
| European fire points | `FireDB:modis_ba_pt_7day`, WFS | One record sampled; fields include name/source/status, ignition date, size, boundary update, FWI and FCI heat times. Names and field existence do not establish their upstream provenance or ignition accuracy | Original EFFIS/LSA SAF plus verified national incident sources |
| European FCI footprints | `FireDB:europe_fci_footprint`, WMTS + WFS | One polygon sampled; 2,550 matches at capture. Includes FRP, uncertainty, confidence, parallax coordinates, pixel geometry and acquisition time | LSA SAF MTFRPPIXEL / LSA-509 after a local sample test |
| Current burned polygons | `FireDB:fire_pg_combined`, WMTS + WFS | One polygon sampled; 5,681 matches at capture. Sample properties contain only `fid`; provenance/timing cannot be reconstructed from that sample | Original burned-area/perimeter product with metadata |
| European recent polygons | `FireDB:europe_fire_pg_7d` | Advertised; not sampled | Verify original source before use |
| Historical polygons | Source references `FireDB:fire_pg_historical_2025` WMTS | Bounded WFS request returned HTTP 200 containing an OGC `InvalidParameterValue` exception: feature type unknown. This does not prove the WMTS source is empty or all history unavailable | Use our existing archive and documented incident cases |
| USA agency points | `FireDB:usa_fire_pt_active_2026` | Runtime WFS HTTP 200; vendor describes US agency integration | Benchmark only for a Macedonia-first site |
| Canada points | `FireDB:fire_pt_cad_active` plus Saskatchewan variants | Runtime WFS HTTP 200; regional provider context | Benchmark only |
| Australia points | `FireDB:fire_pt_aus_active` in runtime/source | Runtime WFS HTTP 200; absent from the captured capabilities list. Service publication can differ from advertised metadata | Benchmark only |
| GDACS | Runtime requests `FireDB:GDACS_7D`; capabilities lists `GDACS_7D_` | Runtime HTTP 200; naming discrepancy demonstrates drift | GDACS original published feeds; incident-specific validation |
| Smoke | `FireDB:smoke_latest` raster WMTS; `radqps_smoke_polygon` advertised | Runtime tiles HTTP 200; site identifies ECCC RDAQA, North America, hourly, resampled display | Find a separately documented European/Macedonian smoke product if required |
| GFS wind | `/data/wind/gfs/manifest.json` and time PNGs | Downloaded manifest: GFS 06Z cycle on 14 Nov, 49 frames; source grid names `0p25`. Frontend overrides declared encoding bounds ±50 to ±40; producer mismatch not independently resolved | Use Open-Meteo numerical weather; do not copy encoded PNG forcing |
| GeoColor imagery | `https://sat.disasterdb.com/geocolor/latest-v2.json`, plus latest/times references | Runtime manifest HTTP 200; site names GOES, Meteosat and GK2A; Himawari parked | Original imagery services where supported; not fire-front observations |
| Satellite tracks | `FireDB:satellite_orbit_12hr`, `satellite_next_pass_northamerica` | Orbit request HTTP 200; passes limited to North America by source contract. A satellite icon, including S-NPP, is not evidence of active data delivery | Optional later observation-opportunity layer |
| Infrastructure | OSM-derived power/pipeline/point PMTiles; browser-side service worker route | Off by default; sources in `infra.js`; not independently enabled/sample-validated. OSM is incomplete and carries separate terms | Bounded OSM extracts with ODbL attribution and source dates |
| Hurricane tracks | `FireDB:google_deepmindhurricanetracks` | Runtime HTTP 200; site identifies DeepMind forecast | Outside current ApexFire purpose |
| Basemap/geocoding | Mapbox styles, OSM/Maxar attribution, `geocode.disasterdb.com` | Working branded vendor stack and hosted geocoder | Our chosen licensed basemap/geocoder; no copied credentials/styles |

The sampled MK-area query used the rectangle **20.4–23.1°E, 40.8–42.5°N**, which includes neighboring territory. It matched **17 cluster points**, of which five were downloaded. This is neither a national incident count nor proof of 17 current wildfires. The exact query and capture timestamp are retained in [the sample](firemap-live/mk-current-bbox-sample.json).

## Can we extract and reuse it?

**Public data: technically yes, selectively.** The saved samples demonstrate unauthenticated public WFS access and geospatial formats. Bbox-limited requests can support research. Do not turn public accessibility into an assumption of complete coverage, guaranteed service or unlimited bulk mirroring.

**Data rights: a real license declaration exists, but scope matters.** Root HTML has schema.org Dataset metadata declaring CC BY 4.0 for “Global Wildfire Data” and GDACS data. Its `contentUrl` points to the site root rather than particular WFS exports. The provider's other pages state all rights reserved; source datasets, imagery, OSM and code have separate rights. Preserve the declaration as evidence, but check the selected transformed layer's terms and attribution before bundling it into a public product. Do not call all FireDB layers unlicensed, or assume that one metadata declaration licenses the frontend and every upstream feed.

**Code: no reuse license established.** Browser-delivered scripts are readable for investigation. Without an applicable grant, use the observed behavior and interface contracts to build our own implementation. Do not ship the scripts, brand assets, proprietary map styles or someone else's access token.

**Durable dependency: prefer original providers.** NASA FIRMS, LSA SAF, Copernicus/EFFIS and OpenStreetMap preserve clearer provenance and reduce reliance on one aggregator. Firemap is valuable for source discovery and cross-checking; choosing it as a live dependency would add service/terms drift, opaque post-processing and an exit requirement. A future adapter should be replaceable and cache small attributed outputs.

## Important corrections to the initial hypothesis

1. **“They do everything ApexFire intends” — unsupported.** Monitoring overlap is strong; historical harmonization, alert delivery and a modeled spread forecast were not established.
2. **“Forecast means fire spread” — false for the inspected pass card.** Source lines 3175 and 3543–3549 query `satellite_next_pass_northamerica`. The forecast concerns when a sensor may observe an existing fire.
3. **“More layers means more accurate” — unsupported.** Regional coverage, product support, age and source-specific uncertainty still govern usefulness.
4. **“All data can be recovered from the frontend” — false.** Only public interfaces and browser-delivered material are visible; private ETL and databases remain unknown.
5. **“Their About/profile pages agree” — false.** Older marketing names EFFIS, while current About leaves some European point provenance unresolved. Trust exact selected-product metadata over general marketing.

## Sources

- [Current map/About](https://www.firemap.live/), [profile](https://firemap.live/profile.html), [provider FireDB description](https://www.disasterdb.com/firedb).
- Public source files: [main map](https://www.firemap.live/script-test.js?v=20261110d), [FWI card](https://www.firemap.live/us-fwi.js?v=20260926a), [GeoColor](https://www.firemap.live/geocolor-sat.js?v=20261110d), [infrastructure](https://www.firemap.live/infra.js?v=20261110d), [wind renderer](https://www.firemap.live/wind-particles-cpu.js?v=20261110d), [wind UI](https://www.firemap.live/wind-ui.js?v=20261110d).
- [Public WFS metadata](https://geo.firemap.live/geoserver/ows?service=WFS&version=1.0.0&request=GetCapabilities), [wind manifest](https://www.firemap.live/data/wind/gfs/manifest.json).
- Original-product access and new engine/data candidates: [spread-model/data research](spread-models-and-data.md). Reusable code candidates: [repository research](repository-landscape.md).

No exhaustive private-source extraction, operational-accuracy validation, user notification test or full historical WMTS test was performed. Research access succeeded; product adoption remains a separate decision.
