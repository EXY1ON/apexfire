import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ExpressionSpecification, LayerSpecification, Map as MLMap } from 'maplibre-gl';
import { load, SENSOR_KEYS, validateCatalog, validateGeoJSON, validatePartition, type Catalog, type Detection, type SensorKey } from '../lib/data';
import { applyFilters, dailyCounts, describeFilters, inRange, passesQuality, SENSOR_LABEL, toCSV, toGeoJSON, toProvenance, TYPE_LABEL, VIIRS_CONF, yearNotes } from '../lib/history';
import { ALL_TYPES, FIRST_YEAR, LAST_YEAR, parseExplore, serializeExplore, type ExploreState } from '../lib/explore-state';
import { navigate, useLocation } from '../lib/router';
import { useData, useReducedMotion } from '../lib/useData';
import { download, fmtInt, fmtUTC } from '../lib/format';
import { addLayers, CLUSTER, clusterLayers, expandCluster, MapView, markLayer, sensorPointLayer, SENSOR_COLOR, SensorMark, SHAPE_NAME, setGeoJSON, setRaster } from '../components/MapView';
import { Link } from '../lib/router';
import { Calendar } from '../components/Calendar';
import { PlaceSearch, validatePlaces, type Place } from '../components/PlaceSearch';
import { DetectionDetail } from '../components/DetectionDetail';
import { FlameGlyph, LayersDrawer, LineGlyph, RingGlyph, type LegendItem } from '../components/LayersDrawer';
import { WindParticles } from '../components/WindParticles';
import { DayWeather, YearWeather } from '../components/YearWeather';
import { Chip, Icon, IconHeading } from '../components/Icon';
import { dayField, dayIndex, insideNodes, validateWeatherYear } from '../lib/weather-history';
import { mkDetail, MkLegends, NowMode, STREAK_GLYPH } from './Now';
import { MKFFIS_BOUNDS, MKFFIS_CREDIT, MKFFIS_ON, tileUrl, useMkffis } from '../lib/mkffis';
import { usePointWeather } from '../lib/openmeteo';
import { fwiClass, fwiMeaning } from '../lib/fwi';
import { fmt1 } from '../lib/format';
import { useExpert } from '../lib/mode';

export type Update = (patch: Partial<ExploreState>) => void;
export type SheetState = 'peek' | 'half' | 'full';

export interface ModeProps {
  map: MLMap | null; state: ExploreState; update: Update; reduced: boolean;
  shell: (left: { eyebrow: string; title: string; body: ReactNode }, right: ReactNode, overlay?: ReactNode) => ReactNode;
  openSheet: (s: SheetState) => void;
  /** Centre the map on a point in the part of the map that panels and the phone sheet leave visible. */
  focus: (lon: number, lat: number, minZoom: number) => void;
}

/** Phone sheet heights in px, matching styles.css (peek 132 px, half 52dvh, full up to just below the map buttons). */
function sheetHeights() {
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 56;
  return { peek: 132, half: 0.52 * vh, full: vh - head - 68 } as Record<SheetState, number>;
}

/** Phone bottom sheet: drag the grab handle or the sheet's header and it follows the finger, then snaps to peek, half or full
 *  by where it was released and how fast it was flicked. A tap on the handle (or Enter) still steps through the sizes. */
function useSheetDrag(setSheet: (s: SheetState) => void) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let drag: { id: number; y0: number; h0: number; moved: boolean; y: number; t: number; v: number } | null = null;
    let clear = 0;
    const down = (e: PointerEvent) => {
      if (window.innerWidth > 900 || !e.isPrimary || e.button > 0 || !(e.target as Element).closest('.handle, .list-head, .detail-head')) return;
      drag = { id: e.pointerId, y0: e.clientY, h0: el.getBoundingClientRect().height, moved: false, y: e.clientY, t: e.timeStamp, v: 0 };
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y0;
      if (!drag.moved) {
        if (Math.abs(dy) < 6) return; // below this it is a tap
        drag.moved = true;
        el.classList.add('dragging');
        clearTimeout(clear);
        try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone: the drag still follows bubbling moves */ }
      }
      const s = sheetHeights();
      el.style.height = `${Math.min(s.full + 16, Math.max(s.peek - 16, drag.h0 - dy))}px`;
      if (e.timeStamp > drag.t) { drag.v = 0.7 * ((e.clientY - drag.y) / (e.timeStamp - drag.t)) + 0.3 * drag.v; drag.y = e.clientY; drag.t = e.timeStamp; }
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      if (!d.moved) return;
      const s = sheetHeights();
      const aim = el.getBoundingClientRect().height - d.v * 200; // where a flick of this speed would carry it
      const [state, px] = (Object.entries(s) as [SheetState, number][]).reduce((a, b) => (Math.abs(b[1] - aim) < Math.abs(a[1] - aim) ? b : a));
      el.classList.remove('dragging');
      el.style.height = `${px}px`; // animate from the finger to the snap point, then hand the height back to the stylesheet
      setSheet(state);
      clear = window.setTimeout(() => { el.style.height = ''; }, 320);
      // The release must not also count as a click on whatever was under the finger.
      const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 350);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      clearTimeout(clear);
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    };
  }, [setSheet]);
  return ref;
}

/** Camera padding matching the floating panels (widths mirror --left-w / --right-w and the sheet heights in styles.css). */
function panelPadding(collapsed: boolean, sheet: SheetState) {
  if (window.innerWidth <= 900) return { left: 0, right: 0, top: 60, bottom: sheet === 'peek' ? 132 : Math.round(window.innerHeight * 0.52) };
  const [l, r] = window.innerWidth <= 1180 ? [320, 340] : [352, 368];
  return { left: collapsed ? 0 : l + 24, right: r + 24, top: 50, bottom: 0 };
}

/** Full-screen map application: one map shared by the archive (History) and Now modes, floating panels over it. */
export function Explore() {
  const loc = useLocation();
  const state = parseExplore(loc.searchParams);
  const update = useCallback<Update>((patch) => {
    navigate(`/explore${serializeExplore({ ...parseExplore(new URLSearchParams(location.search)), ...patch })}`, { replace: true });
  }, []);
  const [map, setMap] = useState<MLMap | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetState>('peek');
  const reduced = useReducedMotion();
  const sheetRef = useSheetDrag(setSheet);

  useEffect(() => {
    document.body.classList.add('mapapp-active');
    return () => document.body.classList.remove('mapapp-active');
  }, []);

  // Keep the camera centre in the visible gap between floating panels and above the phone sheet.
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      // setPadding is a jumpTo: never interrupt a move under way (it carries its own padding), and skip when unchanged.
      if (map.isMoving()) { map.once('moveend', apply); return; }
      const pad = panelPadding(collapsed, sheet === 'full' ? 'half' : sheet);
      const now = map.getPadding();
      if (now.left !== pad.left || now.right !== pad.right || now.top !== pad.top || now.bottom !== pad.bottom) map.setPadding(pad);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => { window.removeEventListener('resize', apply); map.off('moveend', apply); };
  }, [map, collapsed, sheet]);
  const focus = useCallback<ModeProps['focus']>((lon, lat, minZoom) => {
    map?.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), minZoom), padding: panelPadding(collapsed, 'half'), animate: !reduced });
  }, [map, collapsed, reduced]);

  const setMode = (mode: ExploreState['mode']) => update({ mode, sel: null });
  const shell: ModeProps['shell'] = (left, right, overlay) => (
    <>
      <button type="button" className="sheet-toggle" aria-expanded={leftOpen} aria-controls="map-left" onClick={() => { setLeftOpen(true); setCollapsed(false); }}>Filters</button>
      <button type="button" className="reopen" onClick={() => setCollapsed(false)} aria-controls="map-left">Show panel</button>
      <aside id="map-left" className="sheet sheet-left" aria-label={left.title}>
        <header className="sheet-head">
          <div className="row">
            <span className="eyebrow">{left.eyebrow}</span>
            <button type="button" className="collapse-btn btn-quiet" onClick={() => (leftOpen ? setLeftOpen(false) : setCollapsed(true))}
              aria-label="Hide panel">{leftOpen ? 'Close' : 'Hide'}</button>
          </div>
          <h1 id="page-title" tabIndex={-1}>{left.title}</h1>
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed={state.mode === 'current'} onClick={() => setMode('current')}>Fires now</button>
            <button type="button" aria-pressed={state.mode === 'history'} onClick={() => setMode('history')}>Archive 2000–2026</button>
          </div>
        </header>
        <div className="sheet-body">{left.body}</div>
      </aside>
      <aside ref={sheetRef} className="sheet sheet-right" aria-label="Results and details">
        <button type="button" className="handle" aria-label={`Resize results panel (now ${sheet})`}
          onClick={() => setSheet((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'))}><span /></button>
        <div className="sheet-body">{right}</div>
      </aside>
      {overlay}
    </>
  );

  return (
    <div className={`mapapp${collapsed ? ' left-collapsed' : ''}${leftOpen ? ' left-open' : ''}`} data-sheet={sheet}>
      <MapView label="Fire map of North Macedonia" onReady={(m) => { m.setPadding(panelPadding(false, 'peek')); setMap(m); }} />
      {state.mode === 'current'
        ? <NowMode map={map} state={state} update={update} reduced={reduced} shell={shell} openSheet={setSheet} focus={focus} />
        : <HistoryMode map={map} state={state} update={update} reduced={reduced} shell={shell} openSheet={setSheet} focus={focus} />}
    </div>
  );
}

/** Removes a mode's layers and sources when it unmounts, so the shared map starts clean for the other mode. */
export function useMapCleanup(map: MLMap | null, layers: string[], sources: string[]) {
  useEffect(() => () => {
    if (!map) return;
    try {
      layers.forEach((id) => map.getLayer(id) && map.removeLayer(id));
      sources.forEach((id) => map.getSource(id) && map.removeSource(id));
    } catch { /* map already removed, or mid basemap switch (rare): stale layers may remain until reload */ }
  }, [map]); // ids are constant per mode
}

type Parts = Partial<Record<SensorKey, { dets?: Detection[]; error?: string }>>;

function usePartitions(catalog: Catalog | null, year: number) {
  const [parts, setParts] = useState<{ year: number; parts: Parts } | null>(null);
  useEffect(() => {
    if (!catalog) return;
    let live = true;
    const files = catalog.history.files.filter((f) => f.year === year);
    Promise.allSettled(files.map((f) => load(f.data, validatePartition))).then((res) => {
      if (!live) return;
      const out: Parts = {};
      res.forEach((r, i) => { out[files[i].sensor] = r.status === 'fulfilled' ? { dets: r.value } : { error: (r.reason as Error).message }; });
      setParts({ year, parts: out });
    });
    return () => { live = false; };
  }, [catalog, year]);
  return parts?.year === year ? parts.parts : null;
}

const FRP_GLYPH = (
  <svg width="26" height="18" viewBox="0 0 26 18"><rect x="1" y="7" width="5" height="5" fill="#AD921A" stroke="#0C0D0A" /><rect x="8" y="5" width="7" height="7" fill="#AD921A" stroke="#0C0D0A" /><rect x="16" y="2" width="9" height="9" fill="#AD921A" stroke="#0C0D0A" /></svg>
);

/** Simple mode: each detection is a small flame, bigger for more heat (sqrt of fire radiative power), like the fires on Fires now. */
const FLAME_SIZE: ExpressionSpecification = ['interpolate', ['linear'], ['sqrt', ['coalesce', ['get', 'frp'], 5]], 0, 0.75, 3, 0.9, 8, 1.1, 20, 1.35];
const flameLayer = (id: string, source: string): LayerSpecification => ({ id, type: 'symbol', source, filter: ['!', ['has', 'point_count']],
  layout: { 'icon-image': 'fw-flame', 'icon-anchor': 'bottom', 'icon-offset': [0, 2], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'frp'],
    'icon-size': ['interpolate', ['linear'], ['zoom'], 8, ['*', 0.5, FLAME_SIZE], 12, ['*', 0.75, FLAME_SIZE]] } });

function HistoryMode({ map, state, update, shell, openSheet, focus, reduced }: ModeProps) {
  const expert = useExpert();
  const catalog = useData('catalog.json', validateCatalog);
  const boundary = useData('boundary-mk.geojson', validateGeoJSON);
  const parts = usePartitions(catalog.data, state.year);
  const [page, setPage] = useState(1);
  const [place, setPlace] = useState<Place | null>(null);
  const [announce, setAnnounce] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [show, setShow] = useState({ dets: true, boundary: true, wind: true, mkFwi: false });
  const wx = useData(catalog.data?.weather?.years.includes(state.year) ? `weather/weather-${state.year}.json` : null, validateWeatherYear);
  const allPlaces = useData(state.place && !place ? 'places.json' : null, validatePlaces);
  useMapCleanup(map, ['fw-boundary-line', 'fw-dets-cluster', 'fw-dets-count', 'fw-dets-pt', 'fw-dets-flame', 'fw-sel-ring', 'fw-sel-flame', 'fw-place-pt', 'fw-mkffis-fwi-layer'], ['fw-boundary', 'fw-dets', 'fw-sel', 'fw-place', 'fw-mkffis-fwi']);

  const all = useMemo(() => (parts ? SENSOR_KEYS.flatMap((s) => parts[s]?.dets ?? []).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)) : []), [parts]);
  const quality = useMemo(() => all.filter((d) => passesQuality(d, state)), [all, state]);
  const shown = useMemo(() => applyFilters(all, state), [all, state]);
  const counts = useMemo(() => dailyCounts(quality), [quality]);
  const inRangeAll = useMemo(() => all.filter((d) => state.sensors.includes(d.sensor) && inRange(d, state.from, state.to)), [all, state]);
  const selected = state.sel ? all.find((d) => d.id === state.sel) ?? null : null;
  const country = boundary.data?.features[0]?.geometry ?? null;
  const nodes = useMemo(() => (wx.data ? insideNodes(wx.data, country) : []), [wx.data, country]);
  // The wind drawn on the map is that of one day: the selected detection's, or a single day picked on the calendar.
  const windDay = selected ? selected.t.slice(0, 10) : state.from === state.to ? state.from : null;
  const field = useMemo(() => (wx.data && windDay ? dayField(wx.data, dayIndex(wx.data, windDay)) : null), [wx.data, windDay]);
  const mk = useMkffis(show.mkFwi && windDay ? windDay : null, { vdm: false, back: 0 });
  useEffect(() => { if (map) setRaster(map, 'fw-mkffis-fwi', show.mkFwi && mk.fwi ? tileUrl(mk.fwi.name) : null, { attribution: MKFFIS_CREDIT, bounds: MKFFIS_BOUNDS }); }, [map, show.mkFwi, mk.fwi]);

  useEffect(() => setPage(1), [state.from, state.to, state.year, state.sensors.join(), state.modisMin, state.viirs.join(), state.types.join()]);
  useEffect(() => {
    if (state.place && allPlaces.data) setPlace(allPlaces.data.find((p) => p.id === state.place) ?? null);
  }, [state.place, allPlaces.data]);

  useEffect(() => {
    if (!map || !boundary.data) return;
    setGeoJSON(map, 'fw-boundary', show.boundary ? boundary.data : { type: 'FeatureCollection', features: [] }, 'Boundary: geoBoundaries 2016 (CC BY 4.0)');
    addLayers(map, [{ id: 'fw-boundary-line', type: 'line', source: 'fw-boundary', metadata: { 'fw:ink': 'line' }, paint: { 'line-width': 1.4, 'line-opacity': 0.75 } }]);
  }, [map, boundary.data, show.boundary]);
  useEffect(() => {
    if (!map) return;
    setGeoJSON(map, 'fw-dets', {
      type: 'FeatureCollection',
      features: show.dets ? shown.map((d) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [d.lon, d.lat] }, properties: { id: d.id, sensor: d.sensor, frp: d.frp } })) : [],
    }, 'Detections: NASA FIRMS', CLUSTER);
    setGeoJSON(map, 'fw-sel', { type: 'FeatureCollection', features: selected ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [selected.lon, selected.lat] }, properties: { size: 1.3 } }] : [] });
    addLayers(map, [
      ...clusterLayers('fw-dets'),
      sensorPointLayer('fw-dets-pt', 'fw-dets', [0.55, 0.8, 1.15]),
      flameLayer('fw-dets-flame', 'fw-dets'),
      { id: 'fw-sel-ring', type: 'circle', source: 'fw-sel', paint: { 'circle-radius': 13, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#FF6A00', 'circle-stroke-width': 3 } },
      markLayer('fw-sel-flame', 'fw-sel', 'fw-flame'),
    ]);
    // Expert: sensor shapes and a selection ring. Simple: flames, the selected one larger.
    const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('fw-dets-pt', expert); vis('fw-sel-ring', expert); vis('fw-dets-flame', !expert); vis('fw-sel-flame', !expert);
  }, [map, shown, selected, show.dets, expert]);
  useEffect(() => {
    if (!map) return;
    setGeoJSON(map, 'fw-place', { type: 'FeatureCollection', features: place ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [place.lon, place.lat] }, properties: {} }] : [] });
    addLayers(map, [{ id: 'fw-place-pt', type: 'circle', source: 'fw-place', paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#0C0D0A', 'circle-stroke-width': 2.5 } }]);
  }, [map, place]);
  useEffect(() => {
    if (place) focus(place.lon, place.lat, 10.5);
  }, [map, place]); // eslint-disable-line react-hooks/exhaustive-deps -- fly once per picked place

  useEffect(() => {
    if (!map) return;
    const click = (e: { features?: { properties?: Record<string, unknown> }[] }) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) { update({ sel: id }); openSheet('half'); setAnnounce(`Selected detection ${id}`); }
    };
    const on = () => { map.getCanvas().style.cursor = 'pointer'; };
    const off = () => { map.getCanvas().style.cursor = ''; };
    const group = (e: { features?: { properties?: Record<string, unknown>; geometry?: GeoJSON.Geometry }[] }) => e.features?.[0] && expandCluster(map, 'fw-dets', e.features[0]);
    map.on('click', 'fw-dets-pt', click);
    map.on('click', 'fw-dets-flame', click);
    map.on('click', 'fw-dets-cluster', group);
    for (const l of ['fw-dets-pt', 'fw-dets-flame', 'fw-dets-cluster']) { map.on('mouseenter', l, on); map.on('mouseleave', l, off); }
    return () => {
      map.off('click', 'fw-dets-pt', click); map.off('click', 'fw-dets-flame', click); map.off('click', 'fw-dets-cluster', group);
      for (const l of ['fw-dets-pt', 'fw-dets-flame', 'fw-dets-cluster']) { map.off('mouseenter', l, on); map.off('mouseleave', l, off); }
    };
  }, [map, update, openSheet]);

  const pickFromList = (d: Detection) => { update({ sel: d.id }); openSheet('half'); };
  // Centre once per selected detection: from the list, the map or a shared ?sel= link.
  const centred = useRef<string | null>(null);
  useEffect(() => {
    if (!selected) { centred.current = null; return; }
    if (!map || centred.current === selected.id) return;
    centred.current = selected.id;
    openSheet('half');
    focus(selected.lon, selected.lat, 9);
  }, [map, selected, focus, openSheet]);

  if (catalog.error) return <>{shell({ eyebrow: 'Satellite detection archive', title: 'Archive unavailable', body: <p className="error" role="alert">Historical catalog failed to load: {catalog.error}. No detection data is shown.</p> }, null)}</>;
  if (!catalog.data) return <>{shell({ eyebrow: 'Satellite detection archive', title: 'Loading archive…', body: <p role="status">Loading historical catalog…</p> }, null)}</>;
  const cat = catalog.data;
  const notes = yearNotes(state.year, cat);
  const partErrors = SENSOR_KEYS.filter((s) => parts?.[s]?.error).map((s) => `${SENSOR_LABEL[s]}: ${parts?.[s]?.error}`);
  const excluded = inRangeAll.length - shown.length;
  const bySensor = SENSOR_KEYS.map((s) => [s, shown.filter((d) => d.sensor === s).length] as const);
  const typeCounts = Object.fromEntries(ALL_TYPES.map((t) => [t, inRangeAll.filter((d) => d.type === t).length]));
  const listed = shown.slice(0, page * 100);
  const wholeYear = state.from === `${state.year}-01-01` && state.to === `${state.year}-12-31`;
  const exportMeta = () => ({ filters: { from: state.from, to: state.to, sensors: state.sensors, modisMin: state.modisMin, viirs: state.viirs, types: state.types },
    generated: new Date().toISOString(), credit: cat.credit, transformation: cat.transformation_version });
  const fname = `apexfire-mk-detections-${state.from}_${state.to}`;
  const startYear = (s: SensorKey) => Number(cat.history.sensors[s].record_start?.slice(0, 4) ?? FIRST_YEAR);
  const hasFile = (s: SensorKey) => cat.history.files.some((f) => f.sensor === s && f.year === state.year);
  const absent = (s: SensorKey) => (state.year < startYear(s) ? 'before its record starts' : 'no data');
  const filtered = state.sensors.length !== SENSOR_KEYS.length || state.modisMin > 0 || state.viirs.length !== 3 || state.types.length !== ALL_TYPES.length;

  const legend: LegendItem[] = [
    ...(expert ? state.sensors.map((s) => ({ glyph: <SensorMark sensor={s} size={15} />, label: `${SENSOR_LABEL[s]} detection`, note: `${SHAPE_NAME[s]}; one hot pixel, not a fire` }))
      : [{ glyph: <FlameGlyph height={18} />, label: 'Place where a satellite saw heat', note: 'Bigger flame = more heat, not a bigger burned area. Not always a wildfire.' }]),
    ...(expert ? [{ glyph: FRP_GLYPH, label: 'Bigger = more radiant power', note: 'Fire radiative power (MW), not area' }] : []),
    { glyph: <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="#181915" stroke="#FF6A00" strokeWidth="2" /><text x="11" y="15" fontSize="9" textAnchor="middle" fill="#f4f1ea" fontWeight="700">24</text></svg>, label: 'Group of detections', note: 'Number = detections; click or zoom in to split (from zoom 9)' },
    expert ? { glyph: <RingGlyph />, label: 'Selected detection' } : { glyph: <FlameGlyph height={24} />, label: 'Selected sighting', note: 'Shown larger' },
    ...(field && show.wind && !reduced ? [{ glyph: STREAK_GLYPH, label: expert ? `Wind, daily mean ${windDay}` : 'Wind that day',
      note: expert ? 'Streaks follow the MERRA-2 daily mean 10 m wind (NASA POWER, 0.5° × 0.625°, interpolated), sped up to be visible. Inside North Macedonia only.' : 'Moving lines show that day’s average wind, sped up.' }] : []),
    { glyph: <span className="swatch" style={{ background: '#fff', border: '2px solid #0C0D0A', width: 14, height: 14 }} />, label: 'Place you searched' },
    { glyph: <LineGlyph />, label: 'Country outline', note: 'geoBoundaries, 2016 reference' },
  ];

  const left = (
    <>
      <p className="lede" style={{ fontSize: 'var(--step-0)', margin: '14px 0 6px' }}>{expert
        ? <>Every mark is a satellite <em>detection</em>: one pixel flagged hot at one overpass. Sensors are kept apart; their counts are not interchangeable.</>
        : <>Every mark is a place where a satellite saw heat on one pass. It may be a wildfire, a field burn or another hot surface.</>}</p>
      {!expert && filtered && <p className="banner warn" role="note">Some satellites or filters are switched off (set in Expert mode), so fewer sightings are shown. <button type="button" className="link-btn"
        onClick={() => update({ sensors: SENSOR_KEYS, modisMin: 0, viirs: ['l', 'n', 'h'], types: ALL_TYPES })}>Show everything</button></p>}
      <section>
        <PlaceSearch onPick={(p) => { setPlace(p); update({ place: p.id }); }} />
      </section>
      <section aria-labelledby="period-h">
        <IconHeading icon="calendar" id="period-h" className={expert ? 'eyebrow' : undefined}>{expert ? 'Period (UTC)' : 'Pick a year, then a day'}</IconHeading>
        <div className={`period${expert ? '' : ' year-only'}`}>
          <label className="stack year">Year
            <select value={state.year} onChange={(e) => { const y = Number(e.target.value); update({ year: y, from: `${y}-01-01`, to: `${y}-12-31`, sel: null }); }}>
              {Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => LAST_YEAR - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          {expert && <label className="stack">From<input type="date" value={state.from} min={`${state.year}-01-01`} max={`${state.year}-12-31`} onChange={(e) => e.target.value && update({ from: e.target.value })} /></label>}
          {expert && <label className="stack">To<input type="date" value={state.to} min={`${state.year}-01-01`} max={`${state.year}-12-31`} onChange={(e) => e.target.value && update({ to: e.target.value })} /></label>}
        </div>
        <p className="hint"><Link href="/data-methods#coverage">Coverage by year and sensor</Link></p>
        {!wholeYear && <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => update({ from: `${state.year}-01-01`, to: `${state.year}-12-31` })}>Show the whole of {state.year}</button>}
        {notes.length > 0 && <ul className="notes" aria-label="Coverage notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        {partErrors.length > 0 && <p className="error small" role="alert">Failed to load: {partErrors.join('; ')}. Affected sensors are omitted, not treated as zero.</p>}
        {parts ? <Calendar year={state.year} counts={counts} sensors={state.sensors} failed={SENSOR_KEYS.filter((s) => parts?.[s]?.error)} catalog={cat} from={state.from} to={state.to}
          onSelectRange={(from, to) => update({ from, to, sel: null })} /> : <p role="status">Loading {state.year} detections…</p>}
      </section>
      <section aria-labelledby="wx-h">
        <IconHeading icon="thermo" id="wx-h" className={expert ? 'h3' : undefined}>Weather in {state.year}</IconHeading>
        {wx.data ? <YearWeather w={wx.data} nodes={nodes} counts={counts} from={state.from} to={state.to} onDay={(d) => update({ from: d, to: d, sel: null })} />
          : wx.error ? <p className="error small" role="alert">Weather for {state.year} failed to load: {wx.error}</p>
          : cat.weather?.years.includes(state.year) ? <p className="small muted" role="status">Loading weather…</p>
          : <p className="hint">{cat.weather ? `Daily weather covers ${cat.weather.years[0]}–${cat.weather.years[cat.weather.years.length - 1]}; ${state.year} is not in it yet.` : 'Daily weather is not in this build.'}</p>}
      </section>
      {expert && <><fieldset>
        <legend className="ih"><Chip icon="satellite" small />Sensors</legend>
        {SENSOR_KEYS.map((s) => {
          const has = hasFile(s);
          return (
            <label key={s} className="check">
              <input type="checkbox" checked={state.sensors.includes(s)} disabled={!has}
                onChange={(e) => update({ sensors: e.target.checked ? SENSOR_KEYS.filter((k) => k === s || state.sensors.includes(k)) : state.sensors.filter((k) => k !== s) })} />
              <SensorMark sensor={s} />{SENSOR_LABEL[s]}
              <span className="muted small num">{has ? fmtInt(bySensor.find(([k]) => k === s)?.[1] ?? 0) : absent(s)}</span>
            </label>
          );
        })}
      </fieldset>
      <fieldset>
        <legend className="ih"><Chip icon="gauge" small />Native confidence</legend>
        <label className="stack">MODIS, 0–100 scale
          <select value={state.modisMin} onChange={(e) => update({ modisMin: Number(e.target.value) })}>
            {[0, 30, 50, 80].map((v) => <option key={v} value={v}>{v === 0 ? 'All values' : `${v} and above`}</option>)}
          </select>
        </label>
        <div className="inline-checks" role="group" aria-label="VIIRS confidence classes">
          <span>VIIRS classes</span>
          {['l', 'n', 'h'].map((c) => (
            <label key={c} className="check"><input type="checkbox" checked={state.viirs.includes(c)}
              onChange={(e) => update({ viirs: e.target.checked ? ['l', 'n', 'h'].filter((k) => k === c || state.viirs.includes(k)) : state.viirs.filter((k) => k !== c) })} />{VIIRS_CONF[c]}</label>
          ))}
        </div>
        <p className="hint">The two scales differ and are not probabilities, so each is filtered on its own terms.</p>
      </fieldset>
      <fieldset>
        <legend className="ih"><Chip icon="layers" small />Algorithm label</legend>
        {ALL_TYPES.filter((t) => t !== 9 || typeCounts[9] > 0).map((t) => (
          <label key={t} className="check"><input type="checkbox" checked={state.types.includes(t)}
            onChange={(e) => update({ types: e.target.checked ? ALL_TYPES.filter((k) => k === t || state.types.includes(k)) : state.types.filter((k) => k !== t) })} />
            {TYPE_LABEL[t]} <span className="muted small num">{fmtInt(typeCounts[t])}</span></label>
        ))}
        <p className="hint">All labels are included by default. The share of label 2 (static land source) drops sharply after 2020 in MODIS and NOAA-20, an unexplained classification change.</p>
      </fieldset>
      <section><AnnualSeries catalog={cat} year={state.year} onYear={(y) => update({ year: y, from: `${y}-01-01`, to: `${y}-12-31`, sel: null })} /></section></>}
      {!expert && <section><p className="small muted" style={{ margin: 0 }}>Satellite records go back to November 2000; newer satellites joined in 2012, 2018 and 2023, so recent years are seen in more detail.</p></section>}
    </>
  );

  const right = selected ? (
    <DetectionDetail d={selected} outsideFilters={!shown.includes(selected)} onClose={() => update({ sel: null })}>
      <HistoricDanger d={selected} />
    </DetectionDetail>
  ) : (
    <>
      <div className="list-head" aria-live="polite">
        <span className="eyebrow">{wholeYear ? `All of ${state.year}` : `${state.from} to ${state.to}`} · UTC</span>
        <h2 className="display ih"><span className="ih-icon"><Icon name="flame" size={18} /></span><span>{fmtInt(shown.length)} {expert ? `detection${shown.length === 1 ? '' : 's'}` : `satellite sighting${shown.length === 1 ? '' : 's'}`}</span></h2>
        {expert
          ? <p className="small muted" style={{ margin: '4px 0 0' }}>{bySensor.filter(([s]) => state.sensors.includes(s)).map(([s, n]) => `${SENSOR_LABEL[s]} ${parts?.[s]?.error ? 'failed to load' : !hasFile(s) ? absent(s) : fmtInt(n)}`).join(' · ')}</p>
          : <p className="small muted" style={{ margin: '4px 0 0' }}>All satellites added together. More satellites watch in later years, so a bigger number does not always mean more fires.</p>}
        {!expert && partErrors.length > 0 && <p className="error small" role="alert">Some satellite data failed to load, so this count is incomplete.</p>}
        {excluded > 0 && <p className="small muted" style={{ margin: '2px 0 0' }}>{fmtInt(excluded)} of {fmtInt(inRangeAll.length)} in this period hidden by confidence or label filters.</p>}
      </div>
      {expert && <div className="btn-row">
        <button type="button" disabled={!shown.length} onClick={() => download(`${fname}.csv`, toCSV(shown), 'text/csv')}><Icon name="download" size={16} />CSV</button>
        <button type="button" disabled={!shown.length} onClick={() => download(`${fname}.geojson`, JSON.stringify(toGeoJSON(shown, exportMeta())), 'application/geo+json')}><Icon name="download" size={16} />GeoJSON</button>
        <button type="button" disabled={!shown.length} onClick={() => download(`${fname}.provenance.json`, JSON.stringify(toProvenance(shown, exportMeta(), cat.history.files, fname), null, 1), 'application/json')}><Icon name="download" size={16} />Provenance</button>
        <button type="button" className="btn-quiet" onClick={() => { navigator.clipboard?.writeText(location.href).then(() => setAnnounce('Link to this view copied')); }}><Icon name="share" size={16} />Copy link</button>
      </div>}
      {expert ? <p className="hint" style={{ marginTop: 0 }}>CSV holds data only. Sources, filters, column meanings and credit are in the provenance file.</p>
        : <div className="btn-row"><button type="button" className="btn-quiet" onClick={() => { navigator.clipboard?.writeText(location.href).then(() => setAnnounce('Link to this view copied')); }}><Icon name="share" size={16} />Copy link</button></div>}
      <p className="sr-only" role="status">{announce}</p>
      {wx.data && state.from === state.to && <DayWeather w={wx.data} nodes={nodes} day={state.from} />}
      {shown.length === 0 && parts && <p className="note">{expert ? 'No detections recorded in the selected files for these filters.' : 'No satellite sightings on these days.'} That is not evidence that no fire occurred.</p>}
      <ol className="det-list" aria-label="Detections">
        {listed.map((d) => (
          <li key={d.id}>
            <button type="button" className={d.id === state.sel ? 'selected' : ''} onClick={() => pickFromList(d)} aria-current={d.id === state.sel}>
              {expert ? <SensorMark sensor={d.sensor} /> : <FlameGlyph height={16} />}
              <span className="det-time">{fmtUTC(d.t)}</span>
              <span className="muted small">{SENSOR_LABEL[d.sensor]}{expert && <> · {d.sensor === 'modis' ? `conf ${d.conf}` : VIIRS_CONF[d.conf as string]} · {d.frp} MW</>}</span>
            </button>
          </li>
        ))}
      </ol>
      {listed.length < shown.length && <button type="button" className="more" onClick={() => setPage((p) => p + 1)}>Show {Math.min(100, shown.length - listed.length)} more ({fmtInt(shown.length - listed.length)} left)</button>}
      {expert && <p className="hint">Filters: {describeFilters(state)}.</p>}
    </>
  );

  return <>{shell(
    { eyebrow: 'Satellite detection archive', title: `North Macedonia, ${state.year}`, body: left },
    right,
    <><LayersDrawer open={drawer} onOpenChange={setDrawer} legend={legend} layers={[
      { id: 'dets', label: expert ? 'Satellite detections' : 'Satellite sightings', detail: `${fmtInt(shown.length)} ${expert ? 'in view filters' : 'shown'}`, checked: show.dets, onChange: (on) => setShow((s) => ({ ...s, dets: on })) },
      { id: 'boundary', label: 'Country outline', detail: expert ? 'geoBoundaries 2016 reference' : undefined, checked: show.boundary, onChange: (on) => setShow((s) => ({ ...s, boundary: on })) },
      { id: 'wind', label: expert ? 'Wind, daily mean' : 'Wind that day', checked: show.wind && !!field, disabled: !field, onChange: (on) => setShow((s) => ({ ...s, wind: on })),
        detail: field ? `${windDay}${expert ? ', NASA POWER (MERRA-2)' : ''}${reduced ? '; hidden while reduced motion is on' : ''}` : wx.data || !cat.weather ? 'Pick one day on the calendar or a sighting first' : `No daily weather for ${state.year}` },
      ...(MKFFIS_ON ? [{ id: 'mkfwi', label: expert ? 'National Fire Weather Index that day (MKFFIS)' : 'Official fire danger that day (MKFFIS)', checked: show.mkFwi, disabled: !windDay,
        onChange: (on: boolean) => setShow((s) => ({ ...s, mkFwi: on })), detail: !windDay ? 'Pick one day on the calendar or a sighting first' : show.mkFwi ? mkDetail(mk, 'fwi') : 'Daily national maps since 2012' }] : []),
    ]} footer={<MkLegends mk={mk} fwi={show.mkFwi} vdm={false} />} />
    {show.wind && field && map && country && !reduced && <WindParticles map={map} field={field} boundary={country} />}</>,
  )}</>;
}

/** Annual record counts per sensor from the catalog; gaps are marked, not drawn as zero. */
function AnnualSeries({ catalog, year, onYear }: { catalog: Catalog; year: number; onYear: (y: number) => void }) {
  const years = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
  const max = Math.max(...catalog.history.files.map((f) => f.records));
  const rec = (s: SensorKey, y: number) => catalog.history.files.find((f) => f.sensor === s && f.year === y)?.records ?? null;
  const W = 300; const bw = W / years.length; const H = 30;
  return (
    <div className="series">
      <IconHeading icon="chart" className="eyebrow">Detections per year, by sensor</IconHeading>
      {SENSOR_KEYS.map((s) => (
        <div key={s} className="series-row">
          <span className="series-label">{SENSOR_LABEL[s]}</span>
          <svg viewBox={`0 0 ${W} ${H + 2}`} width="100%" role="img" aria-label={`${SENSOR_LABEL[s]} annual detections; see table`}>
            {years.map((y, i) => {
              const r = rec(s, y);
              return r === null
                ? <text key={y} x={i * bw + bw / 2} y={H - 2} fontSize="7" textAnchor="middle" fill="#77766d">×</text>
                : <rect key={y} x={i * bw + 0.5} width={bw - 1} y={H - (r / max) * H} height={Math.max(1, (r / max) * H)} rx="1"
                    fill={y === year ? '#FF6A00' : SENSOR_COLOR[s]} opacity={y === year ? 1 : 0.6}><title>{`${y}: ${fmtInt(r)}`}</title></rect>;
            })}
          </svg>
        </div>
      ))}
      <div className="series-axis small muted"><span>{FIRST_YEAR}</span><span>{LAST_YEAR}</span></div>
      <p className="hint">All records before filters. × marks a year without a file (before the record starts, or a gap), not zero. Separate sensors, not one continuous trend. <Link href="/data-methods#coverage">Coverage by year and sensor</Link></p>
      <details>
        <summary>Show as table</summary>
        <div className="table-scroll">
          <table className="compact">
            <thead><tr><th scope="col">Year</th>{SENSOR_KEYS.map((s) => <th key={s} scope="col">{SENSOR_LABEL[s]}</th>)}</tr></thead>
            <tbody>{years.map((y) => (
              <tr key={y}><th scope="row"><button type="button" className="link-btn" onClick={() => onYear(y)}>{y}</button></th>
                {SENSOR_KEYS.map((s) => { const r = rec(s, y); return <td key={s}>{r === null ? <span className="muted">{y < Number(catalog.history.sensors[s].record_start?.slice(0, 4) ?? FIRST_YEAR) ? 'before record' : 'no file'}</span> : fmtInt(r)}</td>; })}</tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Fire Weather Index on the day of a past detection, from ERA5 reanalysis (Open-Meteo historical API). */
function HistoricDanger({ d }: { d: Detection }) {
  const expert = useExpert();
  const day = d.t.slice(0, 10);
  const recent = Date.now() - Date.parse(`${day}T00:00Z`) < 6 * 864e5; // ERA5 lags about five days
  const w = usePointWeather(recent ? null : d.lat, recent ? null : d.lon, recent ? undefined : day);
  if (recent) return <p className="hint">{expert ? 'Reanalysis weather for this date is not published yet; see Fires now for live fire danger.' : 'Weather records for this date are not ready yet; Fires now shows today’s fire danger.'}</p>;
  if (w.loading) return <p className="small muted" role="status">Loading fire weather for {day}…</p>;
  const x = w.data?.fwi.find((f) => f.date === day);
  if (w.error || !x) return <p className="hint">Fire weather for {day} unavailable{w.error ? ` (${w.error})` : ''}.</p>;
  const c = fwiClass(x.value.fwi);
  return (
    <div style={{ margin: '4px 0 12px' }}>
      <span className="eyebrow">{expert ? 'Fire danger that day · Fire Weather Index' : 'Fire danger that day'}</span>
      <div className="danger"><span className="danger-chip" style={{ background: c.color }}>{c.label}</span>{expert && <span className="danger-num num">{fmt1(x.value.fwi)}</span>}
        <span className="small muted">{fmt1(x.noon.t)} °C, {Math.round(x.noon.rh)} %, {Math.round(x.noon.wind)} km/h at noon</span></div>
      {expert ? <p className="hint">ERA5 reanalysis (~28 km grid) via Open-Meteo, 60 days of spin-up to {day}; EFFIS classes. Weather-driven danger, not proof of fire behaviour.</p>
        : <p className="hint">{fwiMeaning(c.label)} Worked out from weather records for that day, not an official rating.</p>}
    </div>
  );
}
