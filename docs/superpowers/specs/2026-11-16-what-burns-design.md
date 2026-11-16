# What burns in North Macedonia — design (slice 1 of 4)

16 Nov 2026 · Status: **approved by SAI (25 grilling decisions + D26–D27)** · Builder: Claude · Reviewer: Codex · Sources: [nature data survey](../../research/nature-data-sources-2026-11-16.md)

## Goal

Answer, from evidence, questions nobody publishes for North Macedonia, for everyday visitors (Simple) and specialists (Expert):

1. **What catches fire, and when?** Fire starts by land-cover type and month.
2. **What does fire destroy?** Burned area by land-cover type per year, from NASA (2001–2025) and EFFIS (2016–2026).
3. **What spreads?** How large fires get and how long they stay visible, by land type.

Done when `/landscape` shows all three from exported, validated data, both map layers work where D9 puts them, the downloads work, and the checks under Testing pass.

**Not in this slice:** fuel types and how they burn, the danger-forecast layer and greenness (slice 2); species, trees and the "what's here" card (slice 3); crop statistics, calendars, burn severity and recovery (slice 4); a Macedonian interface.

## Decisions

Agreed with SAI in three grilling rounds on 16 Nov 2026 (D1–D25), while planning (D26) and while building (D27). Sections below implement them; a change to any of these reopens the design.

| # | Decision |
| --- | --- |
| D1 | New page `/landscape`, named "Landscape", in the main navigation; slices 2–4 extend it. |
| D2 | The headline unit is the **fire start**: detections grouped into one fire, classed by the land under its first detection ("first seen", not confirmed ignition). Raw detections appear only as an Expert "fire activity" view. |
| D3 | Each fire uses the CORINE edition at or before its year: 2000 for 2000–05, 2006 for 2006–11, 2012 for 2012–17, 2018 for 2018–26. The map layer shows 2018. |
| D4 | NASA MCD64A1 burned area 2001–2025 is a second, separate series; it is never added to EFFIS. |
| D5 | EFFIS charts count fires of 30 ha and up (EFFIS's own statistics rule); the map shows every mapped fire, with smaller ones marked. |
| D6 | Burned areas are a static export covering 2016–2026; the 2026 bar reads "to ⟨export date⟩"; the live season panel on Fires now stays the week-by-week source. |
| D7 | The land-cover layer is our own image in the ten chart colours (≤ 700 KB), not EEA's 44-class tiles at runtime. |
| D8 | Ten land-cover groups for charts; Expert adds a table by every CORINE code present. |
| D9 | The burned-area layer appears on the Landscape map and in Archive, not in Fires now. |
| D10 | Two "more than its share" figures per land type: **catches fire** = share of fire starts ÷ share of land; **fire consumes** = share of burned area ÷ share of land, for NASA and EFFIS separately. Land shares come from the same CORINE edition as each fire. Expert adds fire starts per 100 km² per year. 1 = in proportion to its area. |
| D11 | Default sensor VIIRS S-NPP 2012–2025; MODIS 2001–2025 and NOAA-20 2018–2025 selectable; NOAA-21 not offered (too short). |
| D12 | Detection-based charts end at 2025: 2026 near-real-time rows carry no source type (type 9), so factories cannot be removed. Burned-area charts keep 2026. |
| D13 | Fire starts use the site's grouping rule (2 km and 24 h, single linkage); Expert methods report how counts change with a 48 h gap. |
| D14 | "What spreads" is observed, not modelled: EFFIS fire size (fires ≥ 30 ha; median, 90th percentile and largest) by each fire's main EFFIS land-cover field, and days from first to last detection of each start by its land group. |
| D15 | One "What burned" chart with a source switch: NASA MCD64A1 2001–2025 by the ten groups by default; EFFIS 2016–2026 by its nine fields as the alternative. Expert adds a table comparing yearly totals for 2016–2025. |
| D16 | The season chart shows the average number of fire starts per month by land group, stacked, over the chosen sensor's full years; Expert adds a switch to shares within each month. |
| D17 | A fire start counts only if its first detection lies inside the 2016 national boundary; burned area is clipped to the boundary, so a fire that crosses from a neighbour contributes only its part inside. |
| D18 | Simple shows three takeaways generated from the exported numbers by fixed templates (what most fires start on, when farmland fires peak, what lost the most area); no hand-typed figures; SAI reviews the first output. |
| D19 | Release order: build, verify locally, deploy hosting and push, then a Codex handoff on the deployed revision. |
| D20 | Page order: takeaways; map; what catches fire, and when; burns more than its share; what burned; what spreads; methods and limits. |
| D21 | The Landscape map shows every mapped burned area in one colour with a year selector (All, 2016 … 2026); tapping one shows year, dates, hectares and land-cover shares. Land cover is colour and legend only; tap-to-identify is slice 3. |
| D22 | In Archive the burned-area layer follows the selected year; years before 2016 show nothing, with a note saying EFFIS mapping starts in 2016. |
| D23 | Expert downloads: `what-burns.json`, `burned-areas.geojson` and one CSV per chart table (built in the browser with the existing `download()` helper), each with credits and licences. |
| D24 | Only North Macedonia crops of the MCD64A1 granules are kept, with each granule ID and SHA-256; full tiles are deleted after cropping and can be re-downloaded by ID. |
| D25 | The export is re-run by hand after each fire season and whenever EFFIS revises a year; the routine is recorded in PROJECT.md; no scheduled job. |
| D26 | MCD64A1 comes from NASA LP DAAC for all 300 months (Planetary Computer lacks Sep 2023, Jul 2024, May and Aug–Oct 2025). The HDF4 files are read with pyhdf (MIT) in `tools/fetch_mcd64a1.py`, run by `uv run --python 3.14` with its dependencies declared in the script; the project `.venv` is unchanged. |
| D27 | Charts use **eight** validated groups instead of ten (amends D8): the ten colours failed the dataviz checks and the method caps a chart at eight. Sparse/bare/burnt, urban and water fold into a grey "Other land"; EFFIS charts fold sclerophyll + transitional into one shrubland series and artificial + water into "Other". Colours (dark mode, all checks pass, worst adjacent colour-blind ΔE 9.4): broadleaf #0ca30c, conifer #3987e5, mixed #199e70, shrub #d95926, grassland #9085e9, arable #c98500, orchards #d55181, other #7d7c76. Per-fire EFFIS shares keep all nine EFFIS fields; the Expert table keeps every CORINE code; the map image uses the same eight colours. |

## Sources

| Source | Use | Access (verified 16 Nov) | Credit / licence |
| --- | --- | --- | --- |
| CORINE Land Cover 2000, 2006, 2012, 2018 vector (EEA, Copernicus Land) | Land grids per edition (D3), land shares, start classes, map layer (2018) | EEA MapServer `Corine/CLC{year}_WM/MapServer/0/query`, GeoJSON, 1,000 features per page, no login; each edition covers MK (~1,400 polygons in central MK each; 18,917 in the MK box for 2018) | © European Union, Copernicus Land Monitoring Service, EEA; free with attribution |
| EFFIS burned areas `ms:modis.ba.poly` (all years) | Burned area by EFFIS field, fire sizes, burned-area layer | One WFS GeoJSON request over the MK box returns 2016–2026 (1,244 MK fires, 262,341 ha; 12.5 MB with neighbours), CORS `*` | EFFIS, European Commission JRC, CC BY 4.0 |
| EFFIS annual estimates | Cross-check of yearly totals | statistics API (already live on Fires now) | as above |
| NASA MCD64A1 v061 | Burned area 2001–2025 (D4, D15) | 300 monthly HDF4 granules of tile h19v04 (covers all of MK; 1.2 GB) listed by NASA CMR and downloaded from LP DAAC with the Earthdata bearer (D26) | NASA LP DAAC, open data |
| ApexFire detection archive (`web/public/data/history`) | Fire starts, activity, duration | local; `type` 0 vegetation, 2 static land source, 3 offshore, 9 unknown (2026 NRT) | NASA FIRMS |

Static sources are a large share of the archive (type 2: 8,307 of 18,544 MODIS and 14,926 of 41,630 S-NPP detections), so only type 0 is used.

## Land-cover groups

Eight chart groups from the 44 CORINE codes (D8 as amended by D27). The export asserts that every code present in the MK clips maps to exactly one group and one charted EFFIS field.

| Group | CORINE codes | Charted EFFIS field for the same codes (inferred from EFFIS field names; checked against EFFIS's own shares during export) |
| --- | --- | --- |
| Broadleaf forest | 311 | broadleaf (BROADLEA) |
| Conifer forest | 312 | conifer (CONIFER) |
| Mixed forest | 313 | mixed (MIXED) |
| Shrubland and young woodland | 322, 323, 324 | 322 other natural · 323, 324 shrubland (SCLEROPH + TRANSIT) |
| Grassland and pasture | 231, 321 | 231 agricultural · 321 other natural |
| Arable land | 211, 212, 213 | agricultural (AGRIAREAS) |
| Orchards, vineyards and mixed farming | 221, 222, 223, 241, 242, 243, 244 | agricultural |
| Other land (bare, urban, water) | 331–335, 1xx, 4xx, 5xx | 331–335 other natural · 1xx, 4xx, 5xx other (ARTIFSURF + OTHERLC) |

EFFIS charts use the seven charted fields; their land shares for D10 come from the code-to-field column. Each burned area keeps EFFIS's own nine shares for the tap details.

## Data pipeline

Follows the existing pattern: a fetch tool caches raw inputs with a manifest; `tools/export_web_data.py` validates and writes compact web files. No new Python dependencies (numpy, shapely, rasterio and Pillow are installed).

**`tools/fetch_landscape.py`** (new) writes to `Data/readiness/landscape/` with a manifest of URL, SHA-256 and retrieval time per file. It fetches:

- CORINE vector for each of the four editions, paged over the MK box. It refuses short pages and non-polygon geometry.
- The EFFIS `ms:modis.ba.poly` response. It refuses a response whose `numberMatched` differs from the features returned.
- **`tools/fetch_mcd64a1.py`** (new, D26) lists MCD64A1 h19v04 granules for 2001–2025 in NASA CMR, downloads each from LP DAAC with the Earthdata bearer, crops Burn Date and QA to the MK box, and saves the crop with its granule ID and SHA-256 before deleting the HDF (D24).

**`tools/landscape.py`** (new) holds the land-cover tables, the pure helpers and `export()`, which `tools/export_web_data.py` calls:

1. **Land grids.** Rasterise each CORINE edition, clipped to the 2016 boundary, at 100 m in EPSG:3035 for statistics. Rasterise 2018 once more in Web Mercator for display. Compute each group's and each EFFIS field's share of land per edition.
2. **Fire starts.** Take archive rows with `type = 0` for full years only: MODIS 2001–2025, S-NPP 2012–2025, NOAA-20 2018–2025 (D11, D12). Group them per sensor with `tools/firelib.py` (2 km / 24 h, D13). Keep a start only if its first detection is inside the boundary (D17). The start's land comes from the first detection's footprint: the `scan` × `track` km rectangle around its centre, giving fractional group shares from that year's edition (D3). A 1 km MODIS pixel half over pasture and half over oak counts 0.5 to each. Each start records month, year, group shares and duration (first to last detection, in days). The same counts are also computed with a 48 h gap for the Expert sensitivity line.
3. **Fire activity (Expert).** Fractional group shares of every type-0 detection inside the boundary, per sensor, month and year.
4. **NASA burned area.** MCD64A1 pixels with a valid burn date (Burn_Date 1–366), clipped to the boundary. Each 500 m pixel gets fractional group shares from that year's edition, and its burned hectares are summed per year and group (D15).
5. **EFFIS burned area.** Take every feature that intersects the boundary and clip it. A fire is "≥ 30 ha" by EFFIS's own `AREA_HA` for the whole fire (D5). Hectares by field = clipped area × that field's share (the shares are for the whole fire, so this is approximate for the few fires that cross the border). Yearly totals of MK-labelled fires ≥ 30 ha are compared with the annual estimates; differences are written into the file, not adjusted.
6. **"More than its share" (D10).** Catches fire per sensor = share of starts ÷ share of land, with land shares weighted by how many starts fall in each edition period. Fire consumes = share of burned area ÷ share of land, for NASA by group and for EFFIS by field. Rates are fire starts per 100 km² of each group per year.
7. **What spreads (D14).** EFFIS fires ≥ 30 ha are grouped by their largest field: count, median, 90th percentile and largest area. Duration of starts is grouped by start land group, per sensor: median and 90th percentile days.
8. **Takeaways (D18).** Three sentences are filled from fixed templates using the numbers above and stored in the JSON with the values they quote.

**Web files** go in `web/public/data/landscape/`, each listed in `catalog.json` with its hash and size:

- **`what-burns.json`** (schema `firewatch.landscape.v1`, budget ≤ 200 KB). It holds:
  - groups (id, label, colour, codes) and the code-to-field map;
  - land shares per edition;
  - fire starts by sensor × year × month × group, plus the 48 h variant;
  - activity by sensor × month × group;
  - NASA by year × group, and EFFIS by year × field (all mapped fires and ≥ 30 ha);
  - the EFFIS cross-check, both share figures and the rates;
  - spread statistics and takeaways;
  - the export date, provenance and credits.
- **`landcover-mk.png`** (budget ≤ 700 KB): indexed-colour Web Mercator image of CORINE 2018 at 100 m, transparent outside the country. Its bounds are stored in the JSON.
- **`burned-areas.geojson`** (budget ≤ 1.5 MB): EFFIS perimeters 2016–2026 clipped to the boundary and simplified to about 20 m. Properties: id, country label, year, fire and final dates, `AREA_HA`, clipped hectares, a `small` flag (under 30 ha) and the nine field shares.

## Page

**Route `/landscape`** (D1). It uses the fire-story layout: the map on the left and a text column on the right, stacked map-first on phones. Charts are inline SVG in the style of the EFFIS season panel, with no chart library. Sections follow D20:

1. **Takeaways.** Simple shows the three generated sentences (D18). Expert shows them with the values they quote.
2. **Map** (D21). The land-cover layer (2018) and every mapped burned area in one colour, with a year selector (All, 2016 … 2026). Tapping a burned area shows its year, dates, hectares, land-cover shares and a "smaller than 30 ha" note where it applies.
3. **What catches fire, and when** (D2, D11, D16). Average fire starts per month, stacked by group, with a sensor switch (S-NPP default, MODIS, NOAA-20). Expert adds the shares switch, the activity view (detections) and the 48 h sensitivity line.
4. **Burns more than its share** (D10). Two bars per land type: catches fire and fire consumes. The NASA and EFFIS consumes figures follow the source switch of section 5. Each bar is labelled with its land share. Expert adds the rates table.
5. **What burned** (D4, D15). Stacked hectares per year by land type, with a source switch: NASA 2001–2025 (default) or EFFIS 2016–2026, where the 2026 bar reads "to ⟨export date⟩" (D6). Expert adds the 2016–2025 overlap table and the cross-check against EFFIS annual estimates.
6. **What spreads** (D14). Fire size by main land type (EFFIS ≥ 30 ha) and days visible by start land type (the chosen sensor).
7. **Methods and limits.** Open by default in Expert. Covers:
   - fire starts are first sightings, not confirmed ignitions;
   - detections are not fires;
   - the footprint approximation;
   - which CORINE edition each fire uses;
   - the 30 ha rule;
   - the MCD64A1 limits (500 m pixels, misses small fires);
   - EFFIS shares applied to clipped areas;
   - the archive holds only detections inside the country, so a fire that crossed the border counts from its first sighting inside;
   - static sources and the 2026 exclusion.

Downloads sit under Methods (D23).

Every chart has a summary label (`role="img"`) and its numbers in a table inside `<details>`. Colours use the site's contrast tokens and always come with labels. Files load only when the page opens or a layer is switched on.

## Layers elsewhere

- **Fires now:** "Land cover (CORINE 2018)" in the Layers drawer.
- **Archive:** "Land cover (CORINE 2018)" and "Mapped burned areas". The burned areas follow the selected year. Before 2016 the layer is empty, with a note that EFFIS mapping starts in 2016 (D22).

Each layer adds its legend entries.

## Errors

Files are validated by schema id and shape like other data documents (`validateDoc`). A missing or invalid file shows an error in that section and nothing in its place. The fetch tool fails loudly on partial downloads, and the export fails when a self-check below fails.

## Testing

**Export self-checks (assert):**
- Every CORINE code present maps to one group and one EFFIS field.
- Land shares per edition sum to 1 ± 0.001.
- Every start's and every detection's fractional shares sum to 1.
- Start counts per sensor equal the number of inside-boundary first detections in the grouped type-0 rows.
- No type ≠ 0 rows and no 2026 rows enter detection results.
- MCD64A1 uses only Burn_Date 1–366.
- EFFIS per-fire shares sum to 100 ± 1.
- Češinovo 2016 (EFFIS 10145) reproduces 77.4 % agricultural, matching its story file.
- EFFIS 2025 MK fires ≥ 30 ha reproduce 82 fires / 31,338 ha before clipping.
- All web files are within budget.

**Vitest:**
- the `what-burns.json` validator;
- the year-selector filtering of burned areas;
- the Archive year rule (D22);
- the CSV builders (header, rows, credits line);
- the "N×" labelling of share figures.

**Browser:**
- `/landscape` on desktop and 375 px touch emulation, keyboard only and reduced motion.
- Every switch (sensor, source, shares, year).
- Both layers in Fires now and Archive, including a pre-2016 year.
- Each download.
- No console errors.

**Review:** SAI reads the first generated takeaways before deploy (D18).

## Release and operations

Order (D19):
1. Build.
2. Verify locally (the checks above).
3. Deploy hosting with the same build settings as the live site (`VITE_MKFFIS_WMS=` empty).
4. Push.
5. Write a Codex handoff naming the deployed commit.

Re-export by hand after each fire season and whenever EFFIS revises a year (D25); PROJECT.md records the command and the date of the last run.

## Files touched

- **New:** `tools/landscape.py`, `tools/fetch_landscape.py`, `tools/fetch_mcd64a1.py`, `tests/test_landscape.py`, `web/src/lib/landscape.ts` with its test, `web/src/components/StackedBars.tsx`, `web/src/components/LandscapeLayers.tsx`, `web/src/pages/Landscape.tsx`, and the three web files.
- **Changed:** `tools/export_web_data.py` (calls `landscape.export()`), `tools/firelib.py` (optional gap for the 48 h check), `web/scripts/check-dist.mjs` (allow `data/**/*.png`), `web/src/lib/history.ts` (export `csvCell`), `web/src/styles.css` (share bars), `web/public/data/catalog.json`, `web/src/App.tsx` (route and navigation), `web/src/pages/Explore.tsx` and `web/src/pages/Now.tsx` (layer toggles and legends), `firebase.json` (rewrite for `/landscape`), `web/src/pages/DataMethods.tsx` (CORINE, MCD64A1 and EFFIS rows), `README.md` (features and sources), `docs/website-spec.md` (screen entry), `PROJECT.md` (state and re-export routine).

## Risks and open points

- The EEA MapServer query is a public map service, not a download product, and could change. The cached raw files and manifest keep the build reproducible.
- CORINE for North Macedonia was produced by the national team. Its class accuracy is not separately validated here, and the editions differ in method, so some change between editions is mapping change rather than land change.
- The EFFIS code-to-field mapping in the groups table is inferred from field names. The build must confirm it against EFFIS documentation, and the Češinovo check guards it.
- The footprint rectangle is the nominal pixel. Real VIIRS/MODIS footprints are not rectangles and overlap, which is good enough for shares but not for exact area. The page says so.
- MCD64A1 misses small and short fires, so its farmland figures are a floor, not a total.
- The 300 MCD64A1 granules need a valid Earthdata bearer (they expire after 60 days). A failed or blocked download stops the fetch and is reported, never filled in.

## Next slices

2. **Fuel and danger:** the EFFIS fuel map with "how this fuel burns" from Spread Lab runs, the live EFFIS danger-forecast WMS, and greenness.
3. **Living landscape:** a "what's here" card with land cover, fuel, recorded species (GBIF/iNaturalist live) and trees.
4. **Agriculture and aftermath:** FAOSTAT/MAKStat crops and calendars, EFFIS burn severity, and recovery.
