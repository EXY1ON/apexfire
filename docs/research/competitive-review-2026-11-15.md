# Competitive review: ApexFire against wildfire maps (15 November 2026)

Question: for ApexFire's two audiences (everyday users who watch fires near them; experts who inspect, process and download data), what do comparable products offer that ApexFire does not, and what does ApexFire offer that they do not? Evidence: a delegated read-only survey of public product pages (Sonnet, 15 Nov), the earlier source-level investigations of [Watch Fire](watch-fire.md), [WildfireSignal](wildfiresignal.md) and [Firemap Live](firemap-live.md), and ApexFire's own code. JavaScript map viewers were not operated in a browser for this review, so a ✗ for a competitor means "not found on its public pages", not "proven absent".

## Capability matrix

✓ present · ~ partial · ✗ not found · ? unverified. ApexFire column is from the code (candidate 7b).

| Capability | ApexFire | Watch Fire | WildfireSignal (MK page) | EFFIS viewer | NASA FIRMS | Firemap Live | Zoom Earth | MKFFIS public | Watch Duty (US) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Everyday users** | | | | | | | | | |
| Live satellite hotspot map | ✓ 15-min ingest | ✓ | ✓ (feed stale on 15 Nov) | ✓ | ✓ | ✓ | ~ daily | ? | ✗ (official data) |
| Fires grouped, named by nearest place | ✓ | ✓ | ~ | ✗ | ✗ | ✓ | ✗ | ? | ✓ |
| Wind on the map | ✓ ECMWF 9 km, particles | ✓ | ✗ | ✗ | ✗ | ✓ GFS 22 km | ✓ | ✗ | ✓ |
| Fire danger (FWI) | ✓ any point, 3 days | ~ 24 h outlook | ✗ | ✓ 1-day forecast | ✗ | ~ US only | ✗ | ✓ national | ~ red flag |
| National official danger layer | ✓ MKFFIS (local demo) | ✗ | link only | ✗ | ✗ | ✗ | ✗ | ✓ owner | n/a |
| Smoke / air quality | ~ Expert sample only | ✗ | ✗ | ✗ | ✗ | ~ N. America | ✗ | ✗ | ~ |
| Satellite image of the day | ✓ GIBS | ✗ | ✗ | ✓ | ✓ | ✓ geostationary | ✓ geostationary loops | ✗ | ✗ |
| **Alerts that reach you** | ✗ in-site counts only | ✓ email, followed place | ~ saved-country UI | ✗ | ✓ email, polygon | ✗ | ✗ | ✗ | ✓ push |
| Locate me | ✗ blocked by Permissions-Policy | ? | ? | ? | ? | ? | ✓ (apps) | ? | ✓ |
| Installable app / offline | ✗ | ✗ | ✗ | ~ mobile-friendly | ✗ | ✗ | ✓ native | ✗ | ✓ native |
| Evacuation / official incident info | ✗ (no MK feed exists) | ✗ | ✗ (states none imported) | ✗ | ✗ | ✗ | ~ incident lists | ? | ✓ verified |
| User photos / reports | ✗ (deferred) | ✓ moderated | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Aircraft tracking | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ paid |
| Macedonian interface | ✗ (place names only) | ✗ (11 languages) | ✗ | ✗ | ✗ | ✗ | ? | ✓ | ✗ |
| Plain-language mode | ✓ Simple/Expert | ~ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Link previews when shared | ✗ no Open Graph tags | ? | ? | ? | ? | ? | ? | ? | ✓ |
| **Experts** | | | | | | | | | |
| Archive depth | ✓ 2000–2026, MK, 4 sensors | ✗ | ~ season | ✓ seasons | ✓ 2000– global | ~ FireDB | ✗ | ? | ✗ |
| Download with provenance | ✓ CSV, GeoJSON, provenance JSON | ✗ | ✗ | ✓ perimeters (SHP) | ✓ CSV/SHP/JSON | ✗ | ✗ | ? | ✗ |
| API / documented open files | ~ static JSON, undocumented | ✗ | ~ undocumented WP routes | ~ WMS, request form | ✓ API | ✗ | ✗ | ~ WMS | ✗ |
| Burned-area perimeters on the map | ~ only inside stories | ✓ official outlines | ✓ list | ✓ | ~ UMD sftp | ✓ | ~ | ? | ✓ |
| MODIS–VIIRS harmonization, tested | ✓ held-out tests | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Historical weather per day | ✓ 2000–2025 + ERA5 per fire | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Day-by-day fire case studies | ✓ 14 (EFFIS + detections + wind + FWI) | ~ weekly stories | ~ season cards | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Area statistics (region / drawn area) | ✗ | ✗ | ~ country summary | ✓ statistics portal | ✓ alerts by polygon | ✗ | ✗ | ? | ✗ |
| Printable fire dossier | ✗ (browser print only) | ✓ PDF (professionals) | ✗ | ~ reports | ✗ | ✗ | ✗ | ? | ✗ |
| Fire-danger forecast maps, days ahead | ~ point FWI, MKFFIS today | ~ | ✗ | ✓ | ✗ | ~ | ✗ | ✓ | ~ |
| Additional fast sensors (SLSTR, Landsat, geostationary FRP) | ✗ | ✗ | ✗ | ~ | ✓ Landsat 30 m | ✓ SLSTR + geostationary | ✓ imagery | ✗ | ✗ |
| Spread modelling | ~ one experimental run | ~ "expected spread" | ✗ | ~ risk viewer | ✗ | ✗ | ✗ | ✗ | ✗ |

## What only ApexFire does (for North Macedonia)

Tested MODIS–VIIRS harmonization; the full 2000–2026 national archive explorable in the browser with provenance exports; daily weather for every archive day; fourteen evidence-backed fire stories that align official mapped area, satellite detections, wind and fire danger day by day; a plain-language Simple mode beside an Expert mode; the national MKFFIS layers on the same map as satellite data. No surveyed product combines everyday tracking with expert data work for this country.

## Missing, ranked by value to each audience and cost

| # | Gap | Audience | Who has it | Value | Cost | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Locate me** (blue dot, "fires near me") | Everyday | Zoom Earth, Watch Duty | High | Very low: MapLibre `GeolocateControl`, allow `geolocation=(self)` | Do now |
| 2 | **Link previews** (Open Graph title, image, description) | Everyday | Most consumer apps | Medium (Viber/Facebook sharing is how news travels in MK) | Very low | Do now |
| 3 | **Installable app** (manifest, icons, offline shell) | Everyday | Native apps elsewhere | Medium; prerequisite for iOS web push | Low | Do with #4 |
| 4 | **Alerts that reach you** for followed fires and places | Everyday | Watch Fire, FIRMS, GFW, Watch Duty | Highest everyday gap | Medium–high: Web Push (no e-mail addresses to store), subscriptions in RTDB, check in `refresh_live`, dedup, unsubscribe, delivery test | Next milestone (roadmap X2) |
| 5 | **Macedonian interface** | Everyday | No competitor (only MKFFIS) | High; clear differentiator | Medium: extract ~400 strings, `lang="mk"`, Cyrillic typography is already supported | Next milestone |
| 6 | **All EFFIS burned areas as a map layer** (2016–2025, per year) | Expert, also everyday context | EFFIS, Watch Fire, Firemap | High | Low–medium: the story pipeline already queries these layers; export a simplified per-year file | Soon |
| 7 | **Fire-danger forecast map, days ahead** (EFFIS FWI forecast, CC BY 4.0) | Both | EFFIS, MKFFIS | Medium–high; cleaner reuse terms than MKFFIS | Medium (WMS access and CORS to test) | Soon |
| 8 | **Documented open data** (a downloads page plus a schema for every file) | Expert | FIRMS (API), EFFIS | High for researchers | Low: files already exist; document and link them; the GitHub release can carry them | With the GitHub task |
| 9 | **Area statistics** (pick a region or municipality: counts per year and month, export) | Expert | EFFIS, FIRMS, GFW | Medium–high | Medium (municipal boundaries need a sourced dataset) | Later |
| 10 | **Printable fire dossier** (story or fire detail to PDF) | Expert, journalists | Watch Fire | Medium | Low–medium (`@media print` styles) | Later |
| 11 | Smoke / air quality for everyone (CAMS forecast layer) | Everyday | Firemap (N. America), Watch Duty | Medium | Medium | Later |
| 12 | Faster or finer sensors (Sentinel-3 SLSTR, Landsat 30 m, MTG geostationary FRP) | Expert | Firemap, FIRMS | Medium | High | Research track |
| 13 | Aircraft tracking, user photos/reports, official evacuation info | Everyday | Watch Fire, Watch Duty | Medium | High; reuse terms, moderation, or an official partner (no MK incident feed exists) | Partnership / deferred |

Not recommended: copying risk scores, emissions or "expected spread" numbers without a validation method (see [Watch Fire](watch-fire.md)); brightness-temperature "intensity" classes (see [WildfireSignal](wildfiresignal.md)).

## Corrections and limits

- The survey worker reported WildfireSignal as not found (it matched a 2018 Twitter bot). That is wrong: `https://wildfiresignal.com/countries/north-macedonia/` returned HTTP 200 on 15 Nov 2026 and its summary endpoint answered, reporting `stale: true` (last fetch 14 Nov 20:39 UTC). It remains the direct North Macedonia competitor.
- Watch Duty prices come from secondary sources and disagree; Global Forest Watch now redirects to globalnaturewatch.org and its current fire features were not observed; MKFFIS public map functions were not operated. Rows marked ? need a browser check before any public claim.
- European consumer apps found in passing (EU Fires, Wildfire Tracker; EFFIS-based alerts) were not inspected.
