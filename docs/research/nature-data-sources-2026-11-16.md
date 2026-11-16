# Nature, agriculture and fuel data for North Macedonia — source survey

16 Nov 2026. Purpose: choose sources for land cover, crops, fuels and biodiversity context (what grows where, what fire destroys, what ignites and spreads). Live = a keyless API the browser can call (CORS checked with `Origin: https://apexfire.web.app`). **V** = verified in this session by a direct request; other rows come from two research passes and still need a product-page check before building.

## awesome-public-datasets

About 800 entries swept (Agriculture, Biology, Climate+Weather, EarthScience, GIS, Government; README on `master`). Roughly ten are useful for North Macedonia; none gives vegetation, fuel or crop type directly, and it lists no GBIF, CORINE, Copernicus Land, FIRMS or EFFIS. Useful: iNaturalist (species, live **V**), NASA GIBS (MODIS NDVI/LAI/IGBP tiles, live), Catalogue of Life (names, CC BY 4.0), GloBI (species interactions such as oak pests), Geofabrik OSM extract (landuse, orchards, vineyards; ODbL), WorldClim 2.1 (bioclimate), Eurostat crop statistics (MK coverage unconfirmed), GDHY crop yields (0.5°, to 2016). Dead: kanari ignitions archive.

## Primary sources

| Group | Source | What it gives for MK | Access | Licence | Live |
| --- | --- | --- | --- | --- | --- |
| What burned | EFFIS burned-area WFS `modis.ba.poly.YYYY` | Every mapped fire with land-cover shares (broadleaf, conifer, mixed, sclerophyll, transitional, agricultural…); **V** 2019: 158 fires / 31,709 ha, 2021: 135 / 21,505, 2024: 250 / 97,660, 2025: 199 / 32,640; the 2012 layer did not answer | WFS GeoJSON | CC BY 4.0 | offline |
| Land cover | CORINE Land Cover 2018 | 44 classes, 100 m / 25 ha MMU; MK is in EEA39 | Copernicus download (EU Login); EEA ArcGIS services | Copernicus open, attribution | offline |
| Land cover | CLC+ Backbone 2023; HRL Tree Cover Density / Forest Type 2018 | 10 m cover; broadleaf vs conifer — MK footprint unconfirmed | Copernicus download | Copernicus | offline |
| Land cover | ESA WorldCover 2021 v200 (already used) | 10 m tree/shrub/grass/crop; no newer version on S3 | S3 | CC BY 4.0 | offline |
| Forest change | Hansen GFC v1.12 | Tree cover 2000, loss by year 2001–2024, 30 m | GCS GeoTIFF | CC BY 4.0 (to confirm) | offline |
| Fuels | EFFIS fuel map (already used for Spread Lab) | NFFL classes; "ver. 2017" on a 2000 base, ~290 m local detail | WMS/WCS | CC BY 4.0 | WMS |
| Fuels | FirEUrisk European fuel map | 20 fuel types, 1 km (ESSD 2023) | download | to confirm | offline |
| Danger | EFFIS `mf010.*` (FWI, FFMC, DMC, DC, ISI, BUI, anomaly) | Daily maps with forecast days; **V** MK GetMap 200 PNG, CORS `*` | WMS with time | EFFIS | **live V** |
| Greenness | ORNL DAAC MODIS web service MOD13Q1 | 250 m 16-day NDVI/EVI per point since 2000 | keyless REST; CORS echoes origin **V** (request format still to confirm) | NASA open | live |
| Severity | EFFIS fire severity (dNBR, ≥ ~30 ha fires); HLS S30 dNBR offline | Burn severity and recovery | WMS / Earthdata | EFFIS / NASA open | WMS |
| Species | GBIF occurrence API | **V** 201,235 georeferenced records without geospatial issues: 180,790 animals, 17,181 plants, 2,091 fungi; licences CC BY 117,775, CC BY-NC 80,334, CC0 3,126; CORS `*` | keyless REST | per record | **live V** |
| Species | iNaturalist API | ~84k observations in the MK bbox, `species_counts` per area; CORS `*` **V** | keyless REST | per observation (mixed CC) | **live V** |
| Trees | JRC European Atlas of Forest Tree Species | Modelled distribution per species | ~800 MB download | open, no dedicated licence text found | offline |
| Protected areas | WDPA / Protected Planet | Terms forbid redistribution; API non-commercial | — | restrictive: **do not use** | — |
| Protected areas | Emerald Network | MK nominates candidate sites (not Natura 2000) | CoE portal | to confirm | — |
| Red List | IUCN API | Token required; commercial use needs permission | — | restrictive: **do not use** | — |
| Crops | FAOSTAT bulk Europe CSV | Area/production for 77 items 1961–2024; 2024: cereals 149,249 ha, wheat 67,226, barley 44,739, maize 28,334, grapes 21,534 | static zip (live API returned 521) | FAO terms (to confirm) | offline |
| Crops | MAKStat PX-Web API | National agriculture tables (not opened yet) | keyless REST, CORS `*` | SSO terms (to confirm) | live |
| Crops | ESA WorldCereal 2021 | 10 m winter cereals and maize extent | download | CC BY 4.0 | offline |

## Findings that shape the design

- GBIF/iNaturalist records are presence-only and biased toward birds and accessible places; they show what was recorded, not what lives everywhere. About 40% of GBIF records are CC BY-NC, usable only while ApexFire stays non-commercial (already true for the free Open-Meteo service).
- No MK study of crop-residue burning seasons was found; Serbian evidence (2012–2024) points to autumn. ApexFire's own 47k detections joined with land cover can test this directly.
- EFFIS's per-fire land-cover shares make a national "what burned" record possible without a new provider.
