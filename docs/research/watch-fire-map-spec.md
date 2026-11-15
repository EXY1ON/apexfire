# Watch Fire /map: behavioural spec

Date: 14 November 2026. Subject: https://www.watch-fire.com/map (public page, observed read-only).
Scope: behavioural research only. No code, text, icons, logos or brand assets are adopted; ApexFire designs its own.
Method: Brave headless (REA scenario capture, network list) + Browser pane at 1440x900 and 390x844; shipped JS/CSS read as data, never executed.
Tags: FACT (evidence given), LIKELY, GUESS, UNKNOWN. Evidence keys: `D8bgtvSO.js` = lazy app chunk (map + panels), `BaCMA1eT.css`/`D7DNNUwi.css` = styles, `liberty` = style JSON.
Not exercised: cookies (not accepted), Follow, Email alert, Share, Add a photo, Support. Only UI toggles (tour Skip, Filters drawer, Weather) were used.

## 1. Basemap
- FACT: one style only: `https://tiles.openfreemap.org/styles/liberty` (111 layers; sources `openmaptiles` vector + `ne2_shaded` raster). Constant `En` in `D8bgtvSO.js`, passed straight to `new maplibregl.Map({style})`.
- FACT: tiles `tiles.openfreemap.org/planet/<date>/{z}/{x}/{y}.pbf` (maxzoom 14), glyphs `.../fonts/{fontstack}/{range}.pbf` (Noto Sans Bold/Italic), sprite `sprites/ofm_f384/ofm`, Natural Earth shaded relief `natural_earth/ne2sr/{z}/{x}/{y}.png` (maxzoom 6, raster layer; gives low-zoom relief look).
- FACT: attribution (TileJSON): OpenFreeMap, OpenMapTiles, OpenStreetMap data. Map uses compact `AttributionControl` plus custom "All sources" link and "ADSB.lol (ODbL)".
- FACT: NO raster-dem/hillshade source in liberty or in app code (grep). Terrain look = NE2 shaded raster only (zoom <= 6) + liberty landcover. UNKNOWN: nothing else.
- FACT: NO basemap switcher (no light/dark/satellite); no `setStyle` except a retry of the same style (15 s backoff, max 20). Basemap is LIGHT while all chrome is DARK.
- FACT: app adds GeoJSON overlay `firewatch-countries` (fill #071a2a @0.02, border #d8e5ed @0.2, 0.7 px) from a bundled topojson.
- FACT: initial view `bounds [[-25,34],[45,72]]` (Europe), padding 36, `minZoom 1`, `maxZoom 19`; zoom control only (`showCompass:false`).

## 2. Weather layer (Filters > Layers > Weather toggle, off by default; state persists across reload)
- FACT: it is NOT a wind field. No particles/arrows grid/contours. It draws per-fire symbols: a translucent blue "plume" wedge (symbol, rotated to downwind bearing `to = (from+180)%360`, size scales 0.5 to 1.15 with wind 0 to 60 km/h, opacity 0 at z5 to 1 at z7), a coloured ring (circle, stroke width 1 / 1.5 / 2 / 2.2 by level), a pulsing ring for level 3 (3.2 s loop, static when reduced-motion), a dark pill chip (compass arrow + wind icon + speed number + "km/h", icon canvas-drawn at 2x), and a "turn" icon when a wind shift is detected. Layers `weather-plume/-rings/-pulse/-chips/-turn`, GeoJSON source `weather-fires`, inserted below `hotspot-clusters`.
- FACT: data = `GET /api/weather?points=lat,lng;lat,lng...` (own proxy; max 20 fires in view, coords rounded to 0.1 deg, client cache 25 min, polls up to 4 times at 3.5 s while `pending`). Response: `{attribution:"Weather data: MET Norway (CC BY 4.0)", points:[{lat,lng,key,series:{start:ISO, t[25], rh[25], ws[25], wd[25], rain[25]}}]}`. Hourly, 25 values (now to +24 h). Units: C, % RH, ws km/h (legend/UI says km/h; values consistent with m/s*3.6, LIKELY), wd degrees FROM, rain mm/h.
- FACT: time handling = 4 tabs Now / +6 h / +12 h / +24 h (`Ke=[0,6,12,24]`) in the drawer; label "Forecast for HH:MM" in the user's timezone.
- FACT: risk level 0-3 = `(T-15)*0.5 + (60-RH)*0.55 + ws*0.9 - min(rain3h,3)*6`; thresholds >18 / >32 / >45. Colours `#4f8f6b #d1a642 #cf7048 #b8433f` (low/moderate/high/extreme). Fire level = max over hours 0..24 step 3 (for sorting; chip shows selected tab).
- FACT: wind-shift flag: direction change >= 60 deg within a 3 h step with ws >= 15; shows a shift note in the panel.
- FACT: legend when on: horizontal gradient bar low to extreme + hint "Zoom in to see the fires with the highest risk"; Weather chip appears top-left below the Filters tab (removable with x); count badge on the tab.
- FACT: panel "Weather at this fire": temperature, humidity, wind-towards, small charts (wind, humidity, rain), "how" disclaimer (not an official danger index; no gusts or drought).
- UNKNOWN: whether wind arrows are shown without a selected fire at low zoom (chips visible at about z4+ in Brazil sample, FACT by screenshot).

## 3. Fire symbols
- FACT: data layer = GeoJSON source `hotspots`, `cluster:true`, `clusterRadius 42`, `clusterMaxZoom 8` (clusters up to z8; individual flames from z9), `clusterProperties`: possiblyExtinguishedCount, maxRisk, officialCount.
- FACT: single fire = symbol `hotspot-flame` (grey variant `hotspot-flame-gray` if possibly out), `icon-anchor bottom`, size = interpolate(radius 6 to 12 => 0.72 to 1.08). `radius = max(6, clamp(10 + sqrt(FRP_MW)*0.65, 11, 24)/2)`. So bigger = higher FRP, capped.
- FACT: halo `hotspot-age-halo` circle, radius = radius+7, blur 0.6, opacity 0.25 active / 0.14 otherwise, colour by age hours: <=1 #ff4b32, <=3 #ff7a1a, <=6 #ffad2f, else #ffd275.
- FACT: cluster = flame icon, size step by count: <25 0.95, 25-99 1.25, 100+ 1.6; count label Noto Sans Bold 10/11/12 px (steps 100, 1000), white with #421400 halo 1.5; grey flame if all members possibly out; blue dot (#2f78c4, white 1.5 stroke, offset 8,-19) = official report linked.
- FACT: selected state = `hotspot-selected` circle, transparent fill, white 3 px stroke, radius = radius+6, filtered by id.
- FACT: type colours/glyphs (8 hotspot classes: nature/agri/urban/industrial/waste/volcano/recurring/unknown; industrial, volcano, urban, recurring OFF by default) `er` map; size classes by FRP: <5 / <50 / <500 / <1500 / more MW; MW format 1 decimal under 10.
- FACT: aircraft layer (ADSB.lol) with plane/helicopter icons, rotated by track, size 0.46 (z2) to 0.72 (z10); wording "0/0 live".
- LIKELY: when a fire is selected, the map flies to it and a white ring marks it (mobile screenshot: wedge + ring + chip).

## 4. Filters & legend drawer
- FACT: trigger is a tab hanging from the top bar centre ("Filters & legend", chevron, orange count badge = active filters). Opens a full-map-width sheet sliding down from the top (`translateY(-104%)` to 0, 0.26 s), blur 12 px, bg #060f19f7, bottom radius 16, max-height calc(100% - 28px), bottom grab handle.
- FACT: sections (3 auto-fit columns, min 190 px, max 1180): AREA (6 continents, checkboxes, count each "~N", header "6/6"), RISK (radio: All fires / High risk only / People / Nature / Air / Infrastructure; header "N high"), LAYERS (Weather with sub-tabs, Other natural hazards, Official reports without satellite detection, Firefighting aircraft live count). Then LEGEND below, 3-column grid.
- FACT: legend items (about 16): fire seen by satellite (bigger = hotter); cluster (number = count); possibly out; fire close to buildings; chosen fire; ring = risk (elevated/high/very high); what is at stake (people/nature/air/infrastructure icons); expected fire direction (darker = sooner: 3, 6, 12 h); protected nature; threatened species; town/village/school; power/fuel/industry; official report linked (NIFC, CWFIS, EFFIS); official report without satellite detection (US/Canada, switch under Layers); official fire perimeter; photos/videos; firefighting aircraft; other natural hazard. Footer: roads/rivers/buildings appear as you zoom.
- FACT: bottom-left chip "On the map now: 8 nature areas [Explain]" (context legend) is separate from the drawer.
- FACT: first-visit coach-mark tour (Skip / Next, 3 dots) anchored to the Filters tab.
- FACT mobile (<=850 px): legend column hidden from `.filters`; a "Filters" button becomes a bottom sheet (radius 18 18 0 0, max-height min(76dvh,680px), backdrop #00000094), and the 2-col legend (11.5 px) stays inside the top-drop `filter-panel` variant. UNKNOWN: exact final mobile composition (both variants exist in CSS).

## 5. Right detail panel (`aside.incident-panel`)
- FACT desktop: grid `236px | 1fr | 352px` in topbar, panel 352 px wide x (100% - 62 px), border-left 1 px #223245, padding 26/26/22, bg #07121df5, scrolls; map column 1088 px at 1440.
- FACT order: H1 place + country (25 px); status line (dot + "Probably out/Recent detection"); key-figures 2x2 (Size with MW + ha estimate, Age, Detections, Wind); Risk overview card (kicker, "Most at stake: X", risk pill, explanation box, "If it still burns" 5-tile grid: People/Nature/Air/Infrastructure/Weather, then 1-line bullets: rain/emissions/no-exposure); disclaimer footer; Weather at this fire; "Fire dossier (print / PDF)" link; Media from this area strip; Reported impact card; details list (detection time, etc.). Share / Follow / Add a photo are red-orange gradient pills floating top-left on the map (radius 10, shadow 0 8 20 rgba(232,60,30,.35)).
- FACT mobile 390x844: panel becomes a bottom sheet over the map, `data-sheet` peek (visible 140-150 px) / half (starts at 46% = y 393 px) / full (top = 8 px under top bar), radius 18 18 0 0, grab handle 42x5, close button 36 px, drag on header, transition 0.3 s cubic-bezier(.2,.8,.2,1); key figures stay 2 columns, risk themes 3 columns; map controls move above the sheet peek; empty state hides the sheet. Tapping a flame opens it at "half".

## 6. Top bar and floating controls
- FACT desktop: 62 px bar, bg #050d16f5, bottom 1 px line. Left: brand mark (orange ring) + "Watch Fire" (22/750). Centre pill nav: Home, Map (active: orange 14% bg + inset orange underline, radius 9), Media, Blogs, FAQ (14/650). Right: Rate us, Email alert, Support (outlined orange buttons), Language select (EN/FR/DE), "Live . HH:MM" status button (green dot, aria "Reload live data", clicking reloads data).
- FACT mobile: top bar 56-58 px (brand, round language pill "EN", status dot only); primary nav moves to a fixed 64 px bottom tab bar: Map, Media (blue count badge), Blogs, More (overflow menu radius 16, items 48 px); Home/FAQ hidden.
- FACT map overlays: zoom +/- top right (44 px on mobile), Share/Follow/Add-a-photo stack top left, active-filter chip under the drawer tab, attribution info button bottom right, context legend bottom left.
- FACT data cadence: snapshot poll `data.watch-fire.com/snapshots/current.json` (versioned, 14 regions, 10 deg shards, `overview.json.gz`, windowHours 24, statusPolicy very_recent 0-3 h, recent 3-6 h, possibly_active 6-12 h, unknown 12-24 h); client re-polls every 20 s on `moveend`/visibility. `optimized-current.json` returned 404 (console error, FACT).

## 7. Typography and spacing (values only)
- FACT fonts: Inter (body, UI) with system-ui fallback; Geist and Geist Mono woff2 are loaded (variable classes on body) but computed UI text is Inter. Canvas map chips use `system-ui` 12 px 600 / 9 px.
- FACT tokens (`:root`): --bg #07101a, --panel #0b1622, --panel-2 #101d2a, --line #223245, --muted #91a0b2, --text #f1f5f8, --orange #ff6b0b, --green #31c995. Chip/panel fills #07121d to #0d1a27; text #dbe5ed.
- FACT sizes: body 16; H1 panel 25 (20 mobile); nav 14/650; filter tab 12/750; legend text 13 (11.5 mobile); buttons 16/700; risk card title 17.
- FACT radii/shadows: cards 8; nav buttons 9; floating pills 10; drawer bottom 16; mobile sheets 18 top; menus 16; shadows: tab 0 8 22 rgba(0,0,0,.28), sheet 0 -14 34 #00000073, filter sheet 0 -18 50 #00000080.
- FACT breakpoints: 1280, 1100, 850 (mobile layout switch), 760, 720, 520, 420, 390.

## Remaining unknowns
- Exact DEM/terrain: none present, so no encoding to report. Live `/api/weather` units: km/h inferred from UI strings.
- Hotspot icon bitmaps (`hotspot-flame*`) generated by `ur()` canvas code, not inspected pixel-wise.
- Behaviour with selected fire at z>=9 on desktop (sheet vs panel), media/news layers, official perimeter layer styling, and Weather chip density limits were not exercised.
- Backend contract of `/api/near`, `/api/heat-sources`, `/api/risk`, `/api/reported-impact` not analysed.
