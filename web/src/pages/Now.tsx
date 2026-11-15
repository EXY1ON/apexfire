import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RasterSourceSpecification } from 'maplibre-gl';
import { fail, fetchJSON, validateDoc, validateGeoJSON, type SensorKey } from '../lib/data';
import { useData } from '../lib/useData';
import { classifySource, STATE_TEXT, type SourceState } from '../lib/source-status';
import { ageText, compass, compassWords, fmt1, fmtInt, fmtSkopje, fmtUTC, kmh, skopjeParts } from '../lib/format';
import { bearingSpread, haversineKm, pointInGeometry, wedge } from '../lib/geo';
import { SENSOR_LABEL } from '../lib/history';
import { fwiClass, fwiMeaning, FWI_CLASSES } from '../lib/fwi';
import { useExpert } from '../lib/mode';
import { AQ_POINT, eaqiBand, useAirQuality, usePointWeather, useLiveWind, type AqKey, type PointWeather } from '../lib/openmeteo';
import { newSince, toggleFollow, useFollows } from '../lib/follow';
import { addLayers, CLUSTER, clusterLayers, expandCluster, markLayer, sensorPointLayer, SensorMark, setGeoJSON, setRaster } from '../components/MapView';
import { legendUrl, MKFFIS_BOUNDS, MKFFIS_CREDIT, MKFFIS_ON, skopjeToday, tileUrl, useMkffis, type MkState } from '../lib/mkffis';
import { Icon, IconHeading } from '../components/Icon';
import { FlameGlyph, LayersDrawer, LineGlyph, PinGlyph, WindGlyph, type LegendItem } from '../components/LayersDrawer';
import { WindParticles } from '../components/WindParticles';
import { buildField } from '../lib/wind-field';
import { useMapCleanup, type ModeProps } from './Explore';

interface WeatherArea { area: string; retrieved_utc: string; model_requested: string; model_run_time: string | null; requested_lat_lon: [number, number];
  returned_lat_lon: [number, number]; returned_elevation_m: number; units: Record<string, string>;
  current: Record<string, number | string>; hourly: Record<string, (number | string)[]> }
interface WeatherSample { provider: string; credit: string; model_note: string; areas: WeatherArea[] }
interface EffisRow { week: number; mddate: string; events: number | null; area_ha: number | null; events_avg: number | null; area_ha_avg: number | null; min_year: number }
interface EffisSeason { retrieved_utc: string; product: string; source_url: string; credit: string; reference_note: string; weekly: EffisRow[]; cumulative: EffisRow[]; annual: { year: number; ba: number; nf: number }[] }
interface WindPoint { requested: [number, number]; grid: [number, number]; elevation_m: number; speed: number[]; dir: number[]; gust: number[] }
export interface WindGrid { retrieved_utc: string; model_requested: string; model_run_time: string | null; credit: string; note: string; spacing_deg: number; times: string[]; points: WindPoint[]; delivery?: string }
export interface RecentDet { id: string; sensor: SensorKey; product: string; t: string; lat: number; lon: number; conf: number | string; frp: number; dn: 'D' | 'N'; ver: string; inside: boolean; fire: string }
export interface Fire { id: string; lat: number; lon: number; first_seen: string; last_seen: string; detections: number; sensors: SensorKey[]; max_frp: number; sum_frp: number;
  spread_km: number; inside_mk: boolean; members: string[]; nearest?: { name: string; cyr: string | null; km: number }; within_5km?: { name: string; km: number; population: number }[] }
interface Recent { delivery?: 'saved_sample' | 'live'; retrieved_utc: string; window_start: string; window_end: string; latest_acquisition: string | null; bbox_wgs84: [number, number, number, number];
  products: string[]; grouping: string; credit: string; detections: RecentDet[]; fires: Fire[] }

const vWeather = validateDoc<WeatherSample>('firewatch.current.weather.v1', ['areas']);
const vEffis = validateDoc<EffisSeason>('firewatch.effis.season.v1', ['weekly', 'cumulative', 'annual']);
function vRecent(raw: unknown, path: string): Recent {
  const r = validateDoc<Recent>('firewatch.current.recent.v1', ['detections', 'fires', 'window_end'])(raw, path);
  if (!Array.isArray(r.detections) || !Array.isArray(r.fires)) fail(path, 'detections and fires must be arrays');
  for (const d of r.detections) if (!Number.isFinite(d.lat) || !Number.isFinite(d.lon) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(d.t)) fail(path, `invalid detection ${d.id}`);
  return r;
}
export function validateWind(raw: unknown, path: string): WindGrid {
  const w = validateDoc<WindGrid>('firewatch.current.wind.v1', ['times', 'points'])(raw, path);
  const n = w.times.length;
  if (!n || !w.points.length) fail(path, 'empty wind grid');
  for (const p of w.points) {
    if (p.speed.length !== n || p.dir.length !== n || p.gust.length !== n) fail(path, 'point arrays do not match the time axis');
    if (p.speed.some((v) => !Number.isFinite(v) || v < 0) || p.dir.some((v) => !Number.isFinite(v) || v < 0 || v > 360)) fail(path, 'invalid wind value');
  }
  return w;
}

// Static arrows (reduced motion) use every other point of the dense live grid, one per 0.25°, so they stay readable.
const onQuarterDegree = ([lat, lon]: [number, number]) => Math.abs(((lat - 40.875) / 0.25) % 1) < 1e-6 && Math.abs(((lon - 20.5) / 0.25) % 1) < 1e-6;
const lastNonNull = (rows: EffisRow[]) => [...rows].reverse().find((r) => r.area_ha !== null);
const mdDate = (n?: string) => (n ? `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}` : 'unknown');
const hoursBefore = (iso: string, h: number) => new Date(Date.parse(iso) - h * 3600e3).toISOString().slice(0, 16) + 'Z';

/** Index of the forecast hour nearest to now, clamped to the available range. */
export function nearestHour(times: string[], now = Date.now()): number {
  let best = 0;
  times.forEach((t, i) => { if (Math.abs(Date.parse(t) - now) < Math.abs(Date.parse(times[best]) - now)) best = i; });
  return best;
}

export function nearestWindPoint(grid: WindGrid, lat: number, lon: number) {
  let best = grid.points[0]; let km = Infinity;
  for (const p of grid.points) { const d = haversineKm(lat, lon, p.grid[0], p.grid[1]); if (d < km) { km = d; best = p; } }
  return { p: best, km };
}

/** Downwind sector for one fire: towards where the wind blows over the next 6 h; length grows with speed. Context, not a spread forecast. */
export function downwindWedge(f: { lat: number; lon: number }, grid: WindGrid, hour: number) {
  const { p } = nearestWindPoint(grid, f.lat, f.lon);
  const next = p.dir.slice(hour, Math.min(hour + 7, p.dir.length)).map((d) => (d + 180) % 360);
  const { mean, spread } = bearingSpread(next);
  const speed = kmh(p.speed[hour]);
  return { ring: wedge(f.lat, f.lon, mean, Math.min(45, Math.max(15, spread)), Math.min(12, Math.max(2, 1.5 + 0.35 * speed))), speed, from: p.dir[hour] };
}

// Realtime Database root of the deployed 15-minute ingestion (public read-only path); VITE_LIVE_URL overrides it, an empty value turns it off.
const LIVE_URL = (import.meta.env.VITE_LIVE_URL as string | undefined) ?? 'https://firewatch-ff023-default-rtdb.europe-west1.firebasedatabase.app';
const STALE_MS = 30 * 60e3;

/** Live snapshot from the Realtime Database (polled every 5 min) when configured; otherwise, or on failure, the saved file. */
function useRecent() {
  const saved = useData('current/recent.json', vRecent);
  const [live, setLive] = useState<{ data: Recent | null; error: string | null; checked: number }>({ data: null, error: null, checked: 0 });
  useEffect(() => {
    if (!LIVE_URL) return;
    let alive = true;
    const get = () => fetchJSON('live feed', () => fetch(`${LIVE_URL}/public/recent.json`))
      .then((raw) => vRecent(raw, 'live feed'))
      .then((data) => alive && setLive({ data, error: null, checked: Date.now() }), (e: Error) => alive && setLive((s) => ({ ...s, error: e.message, checked: Date.now() })));
    get();
    const id = setInterval(get, 5 * 60e3);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const data = live.data ?? saved.data;
  const stale = !!live.data && Date.now() - Date.parse(live.data.retrieved_utc) > STALE_MS;
  return { data, error: data ? null : saved.error, liveError: LIVE_URL ? live.error : null, isLive: !!live.data, stale, configured: !!LIVE_URL };
}

/** Detections acquired since this browser last looked (in-site notice; no push). */
function useNewSinceLastVisit(r: Recent | null) {
  const KEY = 'firewatch.lastSeenAcquisition';
  const [prev] = useState(() => { try { return localStorage.getItem(KEY); } catch { return null; } });
  useEffect(() => { if (r?.latest_acquisition) try { localStorage.setItem(KEY, r.latest_acquisition); } catch { /* storage blocked */ } }, [r?.latest_acquisition]);
  return r && prev ? r.detections.filter((d) => d.t > prev).length : 0;
}

function Health({ name, state, detail }: { name: string; state: SourceState; detail: ReactNode }) {
  return <li><span className="health-name">{name}</span> <span className={`badge ${state}`}>{STATE_TEXT[state]}</span><span className="small muted">{detail}</span></li>;
}

export const STREAK_GLYPH = <svg width="24" height="18" viewBox="0 0 24 18" aria-hidden="true"><g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4"><path d="M2 6 Q9 3 15 5" opacity="0.45" /><path d="M5 11 Q13 8 21 10" opacity="0.9" /><path d="M3 15 Q9 13 13 14" opacity="0.6" /></g></svg>;
const WEDGE_GLYPH = <svg width="24" height="18" viewBox="0 0 24 18"><path d="M3 9 L22 2 Q24 9 22 16 Z" fill="rgba(127,209,255,0.28)" stroke="#7fd1ff" strokeWidth="1.2" /><circle cx="3" cy="9" r="2.5" fill="#FF6A00" /></svg>;

export function NowMode({ map, state, update, shell, openSheet, focus, reduced }: ModeProps) {
  const expert = useExpert();
  const recent = useRecent();
  const saved = useData('current/wind-grid.json', validateWind);
  const live = useLiveWind();
  const effis = useData('current/effis-season.json', vEffis);
  const weather = useData('current/weather-sample.json', vWeather);
  const boundary = useData('boundary-mk.geojson', validateGeoJSON);
  const follows = useFollows();
  const [hour, setHour] = useState<number | null>(null);
  const [pick, setPick] = useState<{ lat: number; lon: number } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [insideOnly, setInsideOnly] = useState(false);
  const [show, setShow] = useState({ wind: true, wedges: true, dets: true, boundary: true, imagery: false, mkFwi: false, mkVdm: false });
  const mk = useMkffis(show.mkFwi || show.mkVdm ? skopjeToday() : null, { vdm: true, back: 2 });
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  useMapCleanup(map, ['fw-boundary-line', 'fw-wedge-fill', 'fw-wedge-line', 'fw-wind-arrows', 'fw-now-cluster', 'fw-now-count', 'fw-now-pt', 'fw-fires-cluster', 'fw-fires-count', 'fw-fires-mark', 'fw-fire-mark', 'fw-pick-mark', 'fw-gibs-layer', 'fw-mkffis-fwi-layer', 'fw-mkffis-vdm-layer'],
    ['fw-boundary', 'fw-wedges', 'fw-wind', 'fw-now', 'fw-fires', 'fw-fire', 'fw-pick', 'fw-gibs', 'fw-mkffis-fwi', 'fw-mkffis-vdm']);

  const grid: WindGrid | null = live.grid ?? saved.data;
  const country = boundary.data?.features[0]?.geometry ?? null;
  // Moving streaks show the wind; with reduced motion requested, static arrows at the model points inside the country instead.
  const particles = show.wind && !reduced && !!country && !!grid;
  const h = Math.min(hour ?? (grid ? nearestHour(grid.times) : 0), (grid?.times.length ?? 1) - 1);
  const field = useMemo(() => (grid ? buildField(grid.points, h) : null), [grid, h]);
  const r = recent.data;
  const fresh = useNewSinceLastVisit(r);
  const since = r ? hoursBefore(r.window_end, state.win) : '';
  const dets = useMemo(() => (r ? r.detections.filter((d) => d.t >= since && (!insideOnly || d.inside)) : []), [r, since, insideOnly]);
  const fires = useMemo(() => (r ? r.fires.filter((f) => f.last_seen >= since && (!insideOnly || f.inside_mk)) : []), [r, since, insideOnly]);
  const fire = state.fire && r ? r.fires.find((f) => f.id === state.fire) ?? null : null;
  const selectFire = (f: Fire | null) => { update({ fire: f?.id ?? null }); setPick(null); if (f) openSheet('half'); };
  // Centre once per selected fire, also when it comes from a shared ?fire= link; feed refreshes keep the same id and do not move the map.
  const centred = useRef<string | null>(null);
  useEffect(() => {
    if (!fire) { centred.current = null; return; }
    if (!map || centred.current === fire.id) return;
    centred.current = fire.id;
    openSheet('half');
    focus(fire.lon, fire.lat, 10.5);
  }, [map, fire, focus, openSheet]);

  // Map layers
  useEffect(() => {
    if (!map || !boundary.data) return;
    setGeoJSON(map, 'fw-boundary', show.boundary ? boundary.data : { type: 'FeatureCollection', features: [] }, 'Boundary: geoBoundaries 2016 (CC BY 4.0)');
    addLayers(map, [{ id: 'fw-boundary-line', type: 'line', source: 'fw-boundary', metadata: { 'fw:ink': 'line' }, paint: { 'line-width': 1.4, 'line-opacity': 0.75 } }]);
  }, [map, boundary.data, show.boundary]);
  useEffect(() => {
    if (!map || !grid) return;
    // A source keeps the attribution it was created with, so it names the provider only; live or saved is stated on the timebar.
    setGeoJSON(map, 'fw-wind', { type: 'FeatureCollection', features: show.wind && !particles && country ? grid.points.filter((p) => onQuarterDegree(p.requested) && pointInGeometry(p.grid[1], p.grid[0], country)).map((p) => ({ type: 'Feature',
      properties: { speed: p.speed[h], dir: p.dir[h], kmh: Math.round(kmh(p.speed[h])) }, geometry: { type: 'Point', coordinates: [p.grid[1], p.grid[0]] } })) : [] }, 'Wind: Open-Meteo, ECMWF IFS model');
    setGeoJSON(map, 'fw-wedges', { type: 'FeatureCollection', features: show.wedges ? fires.map((f) => ({ type: 'Feature', properties: { id: f.id }, geometry: { type: 'Polygon', coordinates: [downwindWedge(f, grid, h).ring] } })) : [] });
    addLayers(map, [
      { id: 'fw-wedge-fill', type: 'fill', source: 'fw-wedges', paint: { 'fill-color': '#7fd1ff', 'fill-opacity': 0.2 } },
      { id: 'fw-wedge-line', type: 'line', source: 'fw-wedges', paint: { 'line-color': '#7fd1ff', 'line-width': 1.1, 'line-opacity': 0.85 } },
      { id: 'fw-wind-arrows', type: 'symbol', source: 'fw-wind', metadata: { 'fw:ink': 'wind' }, layout: {
        'icon-image': 'fw-wind-light', 'icon-rotate': ['+', ['get', 'dir'], 180], 'icon-rotation-alignment': 'map',
        'icon-size': ['interpolate', ['linear'], ['get', 'speed'], 0, 0.95, 4, 1.25, 8, 1.6, 15, 2.1], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'text-field': ['step', ['zoom'], '', 7.4, ['to-string', ['get', 'kmh']]], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-optional': true },
        paint: { 'icon-opacity': 0.85, 'text-halo-width': 1.4 } },
    ]);
  }, [map, grid, h, show.wind, show.wedges, fires, particles, country]);
  useEffect(() => {
    if (!map) return;
    // Expert: every detection as its sensor shape, grouped into numbered circles. Simple: one flame per fire, bigger = more heat.
    setGeoJSON(map, 'fw-now', { type: 'FeatureCollection', features: show.dets && expert ? dets.map((d) => ({ type: 'Feature', properties: { id: d.id, fire: d.fire, sensor: d.sensor, frp: d.frp },
      geometry: { type: 'Point', coordinates: [d.lon, d.lat] } })) : [] }, 'Detections: NASA FIRMS', CLUSTER);
    setGeoJSON(map, 'fw-fires', { type: 'FeatureCollection', features: show.dets && !expert ? fires.filter((f) => f.id !== fire?.id).map((f) => ({ type: 'Feature',
      properties: { fire: f.id, frp: f.max_frp }, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } })) : [] }, 'Detections: NASA FIRMS',
      { cluster: true, clusterRadius: 30, clusterMaxZoom: 9 }); // fires a few km apart merge into one numbered circle at country zoom
    setGeoJSON(map, 'fw-fire', { type: 'FeatureCollection', features: fire ? [{ type: 'Feature', properties: { fire: fire.id, size: expert ? 1 : 1.3 }, geometry: { type: 'Point', coordinates: [fire.lon, fire.lat] } }] : [] });
    setGeoJSON(map, 'fw-pick', { type: 'FeatureCollection', features: pick ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [pick.lon, pick.lat] } }] : [] });
    addLayers(map, [...clusterLayers('fw-now'), sensorPointLayer('fw-now-pt', 'fw-now', [0.7, 0.95, 1.25]),
      ...clusterLayers('fw-fires'),
      { id: 'fw-fires-mark', type: 'symbol', source: 'fw-fires', filter: ['!', ['has', 'point_count']], layout: { 'icon-image': 'fw-flame', 'icon-anchor': 'bottom', 'icon-offset': [0, 2],
        'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'frp'],
        'icon-size': ['interpolate', ['linear'], ['sqrt', ['get', 'frp']], 0, 0.6, 2, 0.72, 5, 0.88, 12, 1.05] } },
      markLayer('fw-fire-mark', 'fw-fire', 'fw-flame'), markLayer('fw-pick-mark', 'fw-pick', 'fw-pin')]);
  }, [map, dets, fires, fire, pick, show.dets, expert]);
  useEffect(() => {
    if (!map) return;
    const want = show.imagery && fire ? fire.last_seen.slice(0, 10) : null;
    const src = map.getSource('fw-gibs') as { tiles?: string[] } | undefined;
    const url = want && `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${want}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
    if (src && (!url || src.tiles?.[0] !== url)) { if (map.getLayer('fw-gibs-layer')) map.removeLayer('fw-gibs-layer'); map.removeSource('fw-gibs'); }
    if (url && !map.getSource('fw-gibs')) {
      map.addSource('fw-gibs', { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 9, attribution: 'NASA EOSDIS GIBS: VIIRS NOAA-20 true colour (daily)' } as RasterSourceSpecification);
      map.addLayer({ id: 'fw-gibs-layer', type: 'raster', source: 'fw-gibs', paint: { 'raster-opacity': 0.9 } }, map.getLayer('fw-wedge-fill') ? 'fw-wedge-fill' : undefined);
    }
  }, [map, show.imagery, fire]);
  useEffect(() => {
    if (!map) return;
    setRaster(map, 'fw-mkffis-fwi', show.mkFwi && mk.fwi ? tileUrl(mk.fwi.name) : null, { attribution: MKFFIS_CREDIT, bounds: MKFFIS_BOUNDS });
    setRaster(map, 'fw-mkffis-vdm', show.mkVdm && mk.vdm ? tileUrl(mk.vdm.name) : null, { attribution: MKFFIS_CREDIT, bounds: MKFFIS_BOUNDS });
  }, [map, show.mkFwi, show.mkVdm, mk.fwi, mk.vdm]);
  const latest = useRef({ r, selectFire });
  latest.current = { r, selectFire };
  useEffect(() => {
    if (!map) return;
    const CLICKABLE = ['fw-fire-mark', 'fw-fires-mark', 'fw-fires-cluster', 'fw-now-pt', 'fw-now-cluster'];
    const onClick = (e: { point: { x: number; y: number }; lngLat: { lat: number; lng: number } }) => {
      // A small box around the tap, so a fingertip next to a flame or shape still hits it.
      const { x, y } = e.point;
      const hit = map.queryRenderedFeatures([[x - 8, y - 8], [x + 8, y + 8]], { layers: CLICKABLE.filter((l) => map.getLayer(l)) })[0];
      if (hit?.properties?.cluster_id !== undefined) return expandCluster(map, hit.source, hit as never);
      const f = hit?.properties?.fire && latest.current.r?.fires.find((x) => x.id === hit.properties.fire);
      if (f) return latest.current.selectFire(f);
      update({ fire: null }); setPick({ lat: e.lngLat.lat, lon: e.lngLat.lng }); openSheet('half');
    };
    const on = () => { map.getCanvas().style.cursor = 'pointer'; };
    const off = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', onClick);
    for (const l of CLICKABLE) { map.on('mouseenter', l, on); map.on('mouseleave', l, off); }
    return () => { map.off('click', onClick); for (const l of CLICKABLE) { map.off('mouseenter', l, on); map.off('mouseleave', l, off); } };
  }, [map, update, openSheet]);

  const winLabel = state.win === 24 ? 'last 24 h' : state.win === 48 ? 'last 48 h' : 'last 7 days';
  const legend: LegendItem[] = [
    ...(expert
      ? [...(['viirs-jpss1', 'viirs-noaa21', 'modis', 'viirs-snpp'] as SensorKey[]).map((s) => ({ glyph: <SensorMark sensor={s} size={15} />, label: `${SENSOR_LABEL[s]} detection`, note: 'Bigger = more radiant power' })),
        { glyph: <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="#181915" stroke="#FF6A00" strokeWidth="2" /><text x="11" y="15" fontSize="9" textAnchor="middle" fill="#f4f1ea" fontWeight="700">12</text></svg>,
          label: 'Group of detections', note: 'Number = detections; click to zoom in' }]
      : [{ glyph: <FlameGlyph height={18} />, label: 'Place where satellites saw heat', note: 'One mark per fire; bigger = more heat. Not always a wildfire.' },
        { glyph: <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="#181915" stroke="#FF6A00" strokeWidth="2" /><text x="11" y="15" fontSize="9" textAnchor="middle" fill="#f4f1ea" fontWeight="700">3</text></svg>,
          label: 'Fires close together', note: 'Number = fires; tap to zoom in' }]),
    { glyph: WEDGE_GLYPH, label: expert ? 'Downwind sector of a fire' : 'Where smoke would drift',
      note: expert ? 'Where the wind carries smoke and embers over the next 6 h; longer = stronger wind. Not a spread forecast.' : 'Over the next 6 hours, from the wind forecast. Not where the fire will go.' },
    particles
      ? { glyph: STREAK_GLYPH, label: expert ? 'Wind at 10 m, model' : 'Wind', note: expert
        ? `Streaks move along the ECMWF IFS field (about 9 km model, sampled every ${grid?.spacing_deg ?? 0.25}° and interpolated), sped up to be visible; brighter = stronger. Inside North Macedonia only. Not station observations.`
        : 'Moving lines follow the forecast wind; brighter lines = stronger wind.' }
      : { glyph: <WindGlyph />, label: expert ? 'Wind at 10 m, model' : 'Wind', note: expert ? 'ECMWF IFS model points inside North Macedonia; arrow points where air moves to; number = km/h. Not station observations.' : 'Arrow points where the air goes; number = km/h' },
    { glyph: <FlameGlyph height={24} />, label: 'Selected fire', note: expert ? 'Base of the flame = centre of the detection group' : 'Shown larger' },
    { glyph: <PinGlyph />, label: 'Place you picked', note: 'For its weather and fire danger' },
    { glyph: <LineGlyph />, label: 'Country outline', note: expert ? 'geoBoundaries, 2016 reference' : undefined },
  ];

  const passTime = r ? (expert ? fmtUTC(r.latest_acquisition ?? r.window_end) : fmtSkopje(r.latest_acquisition ?? r.window_end)) : '';
  const left = (
    <>
      <div className={`banner ${recent.isLive && !recent.stale ? 'sample' : 'warn'}`} role="note" style={{ marginTop: 14 }}>
        {!r ? 'Loading detections…' : expert ? (recent.isLive
          ? <><strong>{recent.stale ? 'Live feed is stale' : 'Live'}</strong>: refreshed every 15 minutes, last update {ageText(r.retrieved_utc)}; latest detection {passTime}.</>
          : <><strong>Satellite detections to {passTime}</strong>, retrieved {ageText(r.retrieved_utc)}. {recent.configured ? `Live feed unreachable (${recent.liveError ?? 'connecting'}); showing saved data.` : 'Automatic refresh is switched off in this build; showing saved data.'}</>)
          : (recent.isLive
            ? (recent.stale ? <><strong>Updates have paused.</strong> Last update {ageText(r.retrieved_utc)}; latest satellite sighting {passTime}.</>
              : <><strong>Up to date.</strong> Checked {ageText(r.retrieved_utc)}; latest satellite sighting {passTime}. New data every 15 minutes.</>)
            : <><strong>Saved data, not live:</strong> satellite sightings up to {passTime}. {recent.configured ? (recent.liveError ? 'The live feed cannot be reached right now.' : 'Connecting to the live feed…') : ''}</>)}
        {fresh > 0 && <> <strong>{fresh} new {expert ? `detection${fresh === 1 ? '' : 's'}` : `sighting${fresh === 1 ? '' : 's'}`}</strong> since your last visit.</>}
        {' '}{live.grid ? (expert ? <>Wind is <strong>live</strong> from Open-Meteo.</> : null) : live.error ? (expert
          ? <>Live wind unavailable ({live.error}); showing the saved 14 Nov forecast.</>
          : <>The wind shown is a saved forecast from 14 Nov.</>) : null}
      </div>
      <section aria-labelledby="win-h">
        <IconHeading icon="clock" id="win-h" className={expert ? 'eyebrow' : undefined}>Show fires seen in the</IconHeading>
        <div className="seg" role="group" aria-label="Time window" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {([24, 48, 168] as const).map((w) => <button key={w} type="button" aria-pressed={state.win === w} onClick={() => update({ win: w })}>{w === 168 ? '7 days' : `${w} h`}</button>)}
        </div>
        <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={insideOnly} onChange={(e) => setInsideOnly(e.target.checked)} />Only inside North Macedonia</label>
        <p className="hint">{expert
          ? <>Windows end at the latest data ({r ? fmtUTC(r.window_end) : '…'}), so older samples never look current.</>
          : <>Counted back from the latest satellite data ({r ? fmtSkopje(r.window_end) : '…'}), not from this moment.</>}</p>
      </section>
      <section aria-labelledby="follow-h">
        <IconHeading icon="eye" id="follow-h" className="h3">{expert ? 'Following' : 'Fires you follow'}</IconHeading>
        {follows.length === 0 ? <p className="small muted">{expert ? 'Follow a fire to keep a 5 km watch area on this device. New detections there are counted each time data loads.' : 'Follow a fire to watch a 5 km area around it on this device.'}</p> : (
          <ul className="plain">{follows.map((f) => {
            const n = r ? newSince(f, r.detections) : 0;
            return (
              <li key={f.id} className="now-item" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <button type="button" className="link-btn" onClick={() => { const x = r?.fires.find((z) => z.id === f.id); if (x) selectFire(x); else focus(f.lon, f.lat, 10.5); }}>{f.name}</button>
                <span className={`badge ${n ? 'stale' : 'off'}`}>{n ? `${n} new` : 'no new'}</span>
              </li>
            );
          })}</ul>
        )}
        <p className="hint">{expert ? 'Stored only in this browser. Push and email alerts are not built yet.' : 'Saved only on this device. New sightings are counted each time you open ApexFire; there are no phone alerts yet.'}</p>
      </section>
      {expert && effis.data && <EffisPanel e={effis.data} />}
      {expert && <AirPanel />}
      {expert && weather.data && <WeatherPanel w={weather.data} />}
      {expert && <section aria-labelledby="health-h">
        <IconHeading icon="database" id="health-h" className="h3">Sources</IconHeading>
        <ul className="health">
          {recent.error ? <Health name="NASA FIRMS detections" state={classifySource({ delivery: 'saved_sample', error: recent.error, online })} detail={recent.error} />
            : r && <Health name="NASA FIRMS detections" state={classifySource(recent.isLive ? { delivery: 'connected', count: r.detections.length, lastSuccessUtc: r.retrieved_utc, staleAfterMs: STALE_MS } : { delivery: 'saved_sample', count: r.detections.length })}
              detail={<>{r.products.join(', ').replace(/_/g, ' ')} · {fmtInt(r.detections.length)} detections in 7 days · retrieved {fmtUTC(r.retrieved_utc)}{recent.isLive ? ' (live feed)' : ' (saved file)'}</>} />}
          <li><span className="health-name">Wind forecast</span> <span className={`badge ${live.grid ? 'ok' : 'sample'}`}>{live.grid ? 'Live' : STATE_TEXT.sample}</span>
            <span className="small muted">{grid ? `${grid.points.length} points, ECMWF IFS via Open-Meteo, ${live.grid ? `fetched ${fmtUTC(live.grid.retrieved_utc)}` : `saved ${fmtUTC(grid.retrieved_utc)}`}` : 'loading'}</span></li>
          <li><span className="health-name">Fire danger</span> <span className="badge ok">Computed live</span><span className="small muted">Fire Weather Index from Open-Meteo weather when you open a fire.</span></li>
          <li><span className="health-name">Automatic refresh</span> <span className={`badge ${recent.isLive ? (recent.stale ? 'stale' : 'ok') : recent.configured ? 'error' : 'off'}`}>{recent.isLive ? (recent.stale ? 'Stale' : 'Running') : recent.configured ? 'Unreachable' : 'Not running'}</span>
            <span className="small muted">{recent.isLive ? 'Firebase scheduled function every 15 minutes; this page checks every 5 minutes; stale after 30 minutes without an update.'
              : recent.configured ? `Firebase scheduled function every 15 minutes; feed not reachable now (${recent.liveError ?? 'connecting'}).` : 'This build has no live feed URL.'}</span></li>
        </ul>
      </section>}
      <section aria-labelledby="official-h">
        <IconHeading icon="shield" id="official-h" className="h3">{expert ? 'Official national service' : 'Official fire danger'}</IconHeading>
        <p className="small">For official fire danger and warnings in North Macedonia use the Crisis Management Centre's <a href="https://mkffis.cuk.gov.mk/index.php/pocetna_strana/pocetna?lang=en" rel="noopener" target="_blank">MKFFIS portal</a>. ApexFire is not an emergency service.</p>
        {MKFFIS_ON && <button type="button" aria-pressed={show.mkFwi} onClick={() => setShow((s) => ({ ...s, mkFwi: !s.mkFwi }))}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="shield" size={16} />{show.mkFwi ? 'Hide the official danger map' : 'Show the official danger map'}</span></button>}
        {show.mkFwi && <MkStatus mk={mk} kind="fwi" />}
      </section>
    </>
  );

  const right = fire ? (
    <FireDetail f={fire} dets={r!.detections.filter((d) => d.fire === fire.id)} grid={grid} hour={h} following={follows.some((x) => x.id === fire.id)}
      imagery={show.imagery} onImagery={(on) => setShow((s) => ({ ...s, imagery: on }))} onClose={() => update({ fire: null })} />
  ) : pick ? (
    <section className="detail" aria-labelledby="pick-h">
      <div className="detail-head">
        <div><span className="eyebrow"><PinGlyph /> {expert ? 'Point you selected' : 'Place you picked'}</span><h2 id="pick-h" className="mono" style={{ fontSize: 'var(--step-1)' }}>{pick.lat.toFixed(3)}, {pick.lon.toFixed(3)}</h2></div>
        <button type="button" className="icon-btn btn-quiet" onClick={() => setPick(null)} aria-label="Back to the fire list">×</button>
      </div>
      <PlaceWeather lat={pick.lat} lon={pick.lon} grid={grid} hour={h} />
    </section>
  ) : (
    <>
      <div className="list-head" aria-live="polite">
        <span className="eyebrow">{winLabel} · {insideOnly ? 'North Macedonia' : 'North Macedonia and border'}</span>
        <h2 className="display ih"><span className="ih-icon"><Icon name="flame" size={18} /></span><span>{r ? `${fires.length} fire${fires.length === 1 ? '' : 's'}` : recent.error ? 'Detections unavailable' : 'Loading…'}</span></h2>
        {r && <p className="small muted" style={{ margin: '4px 0 0' }}>{expert
          ? <>{fmtInt(dets.length)} satellite detections, grouped when within 2 km and 24 h. A group is probably one burning area, not a confirmed incident.</>
          : <>{fmtInt(dets.length)} satellite sightings of heat. Each may be a wildfire, a field burn or another hot surface.</>}</p>}
      </div>
      {recent.error && <p className="error small" role="alert">{recent.error}</p>}
      {r && fires.length === 0 && <p className="note">{expert ? 'No detections in this window.' : 'Satellites saw no heat in this time.'} That is not proof that nothing is burning: clouds and timing can hide fires.</p>}
      <ol className="fire-list" aria-label="Fires">
        {fires.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => selectFire(f)}>
              <span className="fire-dot" aria-hidden="true"><FlameGlyph height={Math.round(14 + Math.min(10, Math.sqrt(f.max_frp) * 2))} /></span>
              <span className="fire-name">{f.nearest ? `Near ${f.nearest.name}` : `${f.lat.toFixed(2)}, ${f.lon.toFixed(2)}`}{!f.inside_mk && <span className="muted small"> · outside MK</span>}</span>
              <span className="fire-meta">Last seen {ageText(f.last_seen)} · {f.detections} {expert ? `detection${f.detections === 1 ? '' : 's'} · up to ${fmt1(f.max_frp)} MW` : `sighting${f.detections === 1 ? '' : 's'}`}</span>
              <span className="fire-marks">{expert && f.sensors.map((s) => <SensorMark key={s} sensor={s} size={11} />)}{follows.some((x) => x.id === f.id) && <span className="badge ok">Following</span>}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="note" style={{ marginTop: 16 }}>{expert ? 'Select any point on the map for its live weather and fire danger.' : 'Tap any place on the map for the weather and fire danger there.'}</p>
      {expert && r && <p className="hint">{r.grouping} {r.credit}</p>}
    </>
  );

  const times = grid?.times ?? [];
  const overlay = (
    <>
      <LayersDrawer open={drawer} onOpenChange={setDrawer} legend={legend} layers={[
        { id: 'dets', label: expert ? 'Satellite detections' : 'Satellite sightings', detail: `${fmtInt(dets.length)} in the ${winLabel}`, checked: show.dets, onChange: (on) => setShow((s) => ({ ...s, dets: on })) },
        { id: 'wedges', label: expert ? 'Downwind sectors' : 'Where smoke would drift', detail: expert ? 'One per fire, from the wind forecast' : 'One per fire, next 6 hours', checked: show.wedges, onChange: (on) => setShow((s) => ({ ...s, wedges: on })) },
        { id: 'wind', label: 'Wind', detail: `${live.grid ? 'Live forecast' : 'Saved forecast from 14 Nov'}${expert ? ': ECMWF IFS model via Open-Meteo, not station observations' : ''}${reduced ? '; static arrows (reduced motion)' : ''}`, checked: show.wind, onChange: (on) => setShow((s) => ({ ...s, wind: on })) },
        { id: 'imagery', label: expert ? 'Satellite image of the fire day' : 'Satellite photo of the fire day', detail: fire ? `${expert ? 'VIIRS NOAA-20, ' : ''}${fire.last_seen.slice(0, 10)}` : 'Select a fire first', checked: show.imagery, disabled: !fire, onChange: (on) => setShow((s) => ({ ...s, imagery: on })) },
        { id: 'boundary', label: 'Country outline', checked: show.boundary, onChange: (on) => setShow((s) => ({ ...s, boundary: on })) },
        ...(MKFFIS_ON ? [
          { id: 'mkfwi', label: expert ? 'National Fire Weather Index (MKFFIS)' : 'Official fire danger (MKFFIS)', checked: show.mkFwi, onChange: (on: boolean) => setShow((s) => ({ ...s, mkFwi: on })),
            detail: show.mkFwi ? mkDetail(mk, 'fwi') : 'Daily map from the national service' },
          { id: 'mkvdm', label: expert ? 'Vegetation dryness (MKFFIS, 8-day)' : 'How dry the plants are (MKFFIS)', checked: show.mkVdm, onChange: (on: boolean) => setShow((s) => ({ ...s, mkVdm: on })),
            detail: show.mkVdm ? mkDetail(mk, 'vdm') : 'Weekly map from the national service' },
        ] : []),
      ]} footer={<MkLegends mk={mk} fwi={show.mkFwi} vdm={show.mkVdm} />} />
      {particles && map && country && <WindParticles map={map} field={field} boundary={country} />}
      {(show.wind || show.wedges) && times.length > 0 && (
        <div className="timebar">
          <div className="when" aria-live="polite">{fmtSkopje(times[h])}<small>{expert ? `${fmtUTC(times[h])} · ` : ''}{live.grid ? 'live forecast' : 'saved forecast'}</small></div>
          <input type="range" min={0} max={times.length - 1} step={1} value={h} onChange={(e) => setHour(Number(e.target.value))}
            aria-label="Forecast hour" aria-valuetext={`${fmtSkopje(times[h])}, hour ${h + 1} of ${times.length}`} />
          <div className="ticks" aria-hidden="true"><span>{fmtSkopje(times[0]).slice(0, 6)}</span><span>+24 h</span><span>{fmtSkopje(times[times.length - 1]).slice(0, 6)}</span></div>
        </div>
      )}
    </>
  );

  return <>{shell({ eyebrow: 'Fire tracker', title: 'Fires now', body: left }, right, overlay)}</>;
}

function FireDetail({ f, dets, grid, hour, following, imagery, onImagery, onClose }: {
  f: Fire; dets: RecentDet[]; grid: WindGrid | null; hour: number; following: boolean; imagery: boolean; onImagery: (on: boolean) => void; onClose: () => void;
}) {
  const expert = useExpert();
  const [shared, setShared] = useState('');
  useEffect(() => { document.getElementById('fire-h')?.focus(); }, [f.id]);
  const name = f.nearest ? `Near ${f.nearest.name}` : `${f.lat.toFixed(3)}, ${f.lon.toFixed(3)}`;
  const wedgeInfo = grid ? downwindWedge(f, grid, hour) : null;
  const share = async () => {
    const url = `${location.origin}/explore?mode=current&fire=${f.id}`;
    try {
      if (navigator.share) { await navigator.share({ title: `ApexFire: ${name}`, text: `Satellite fire detections ${name}, last seen ${fmtUTC(f.last_seen)}`, url }); setShared('Shared'); }
      else { await navigator.clipboard.writeText(url); setShared('Link copied'); }
    } catch { setShared(''); }
  };
  return (
    <section className="detail" aria-labelledby="fire-h">
      <div className="detail-head">
        <div>
          <span className="eyebrow"><FlameGlyph /> Fire · {f.inside_mk ? 'North Macedonia' : 'outside North Macedonia'}</span>
          <h2 id="fire-h" tabIndex={-1}>{name}{f.nearest?.cyr && f.nearest.cyr !== f.nearest.name && <span lang="mk" className="alt-name">{f.nearest.cyr}</span>}</h2>
          <p className="small muted" style={{ margin: '2px 0 0' }}>Last seen by satellite {ageText(f.last_seen)}, {fmtSkopje(f.last_seen)}</p>
        </div>
        <button type="button" className="icon-btn btn-quiet" onClick={onClose} aria-label="Back to the fire list">×</button>
      </div>
      {!expert && <p className="kind-tag">Satellites saw heat here. It may be a wildfire, a field burn or another hot surface.</p>}
      <div className="btn-row">
        <button type="button" aria-pressed={following} onClick={() => toggleFollow({ id: f.id, name, lat: f.lat, lon: f.lon })}><Icon name="eye" size={16} />{following ? 'Following' : 'Follow'}</button>
        <button type="button" className="btn-quiet" onClick={share}><Icon name="share" size={16} />Share</button>
        <button type="button" className="btn-quiet" aria-pressed={imagery} onClick={() => onImagery(!imagery)}><Icon name="satellite" size={16} />{expert ? 'Satellite image' : 'Satellite photo'}</button>
        <span className="small muted" role="status" style={{ alignSelf: 'center' }}>{shared}</span>
      </div>
      {!expert && <>
        <dl className="figures">
          <div><dt>Last sighting</dt><dd className="num">{skopjeParts(f.last_seen)[1]}<br /><small>{skopjeParts(f.last_seen)[0]}</small></dd></div>
          <div><dt>First sighting</dt><dd className="num">{skopjeParts(f.first_seen)[1]}<br /><small>{skopjeParts(f.first_seen)[0]}</small></dd></div>
          <div><dt>Satellite sightings</dt><dd className="num">{f.detections}</dd></div>
          <div><dt>Area of sightings</dt><dd className="num">~{fmt1(Math.max(f.spread_km * 2, 0.4))} <small>km across</small><br /><small>not the burned area</small></dd></div>
        </dl>
        {wedgeInfo && <p className="small lead-note"><span className="lead-glyph" aria-hidden="true">{WEDGE_GLYPH}</span><span>Wind from the {compassWords(wedgeInfo.from)}, {Math.round(wedgeInfo.speed)} km/h. The shaded area on the map shows where smoke would drift over the next 6 hours. It is not a forecast of where the fire will go.</span></p>}
      </>}
      {expert && <dl className="figures">
        <div><dt>Last seen</dt><dd className="num">{fmtUTC(f.last_seen).split(' ')[1]} <small>UTC</small><br /><small>{f.last_seen.slice(0, 10)}</small></dd></div>
        <div><dt>First seen</dt><dd className="num">{fmtUTC(f.first_seen).split(' ')[1]} <small>UTC</small><br /><small>{f.first_seen.slice(0, 10)}</small></dd></div>
        <div><dt>Detections</dt><dd className="num">{f.detections}<br /><small>{f.sensors.map((s) => SENSOR_LABEL[s]).join(', ')}</small></dd></div>
        <div><dt>Radiant power</dt><dd className="num">{fmt1(f.max_frp)} <small>MW peak</small><br /><small>spread over ~{fmt1(Math.max(f.spread_km * 2, 0.4))} km</small></dd></div>
      </dl>}
      {expert && wedgeInfo && <p className="small lead-note"><span className="lead-glyph" aria-hidden="true">{WEDGE_GLYPH}</span><span>Wind from {compass(wedgeInfo.from)} at {Math.round(wedgeInfo.speed)} km/h at {fmtUTC(grid!.times[hour])}: the sector on the map shows where smoke and embers would drift over the next 6 h. It is not a forecast of fire spread.</span></p>}
      <PlaceWeather lat={f.lat} lon={f.lon} grid={grid} hour={hour} />
      {f.within_5km && f.within_5km.length > 0 && (
        <section aria-labelledby="near-h" style={{ marginTop: 16 }}>
          <IconHeading as="h3" icon="pin" id="near-h" className={expert ? 'eyebrow' : undefined}>{expert ? 'Settlements within 5 km' : 'Villages and towns within 5 km'}</IconHeading>
          <ul className="plain small">{f.within_5km.map((p) => <li key={p.name + p.km} className="now-item">{p.name} · {fmt1(p.km)} km{p.population > 0 && <span className="muted"> · pop. {fmtInt(p.population)}{expert ? ' (GeoNames)' : ''}</span>}</li>)}</ul>
          <p className="hint">{expert ? "Distance from the group's centre to GeoNames populated places. Not an assessment of who or what is at risk." : 'Measured from the centre of the sightings. Not a judgement of who is at risk.'}</p>
        </section>
      )}
      {expert && <><details>
        <summary>All {dets.length} detections in this group</summary>
        <ol className="det-list static">{dets.map((d) => (
          <li key={d.id}>
            <SensorMark sensor={d.sensor} /><span className="det-time">{fmtUTC(d.t)}</span>
            <span className="muted small">{SENSOR_LABEL[d.sensor]} · {typeof d.conf === 'number' ? `conf ${d.conf}` : { l: 'low', n: 'nominal', h: 'high' }[d.conf]} · {d.frp} MW · {d.ver}</span>
          </li>
        ))}</ol>
      </details>
      <p className="hint">A fire here is a group of satellite detections within 2 km and 24 h of each other: probably one burning area, not a confirmed or officially mapped incident. First detection is not the ignition time.</p></>}
    </section>
  );
}

/** Live weather and Fire Weather Index at a point; falls back to the wind grid when Open-Meteo is unreachable. */
function PlaceWeather({ lat, lon, grid, hour }: { lat: number; lon: number; grid: WindGrid | null; hour: number }) {
  const w = usePointWeather(lat, lon);
  if (w.loading) return <p role="status" className="small muted" style={{ marginTop: 14 }}>Loading live weather and fire danger…</p>;
  if (w.error || !w.data) {
    return (
      <div style={{ marginTop: 14 }}>
        <p className="warn small">Live weather unavailable ({w.error ?? 'no data'}). Fire danger needs it, so it is not shown.</p>
        {grid && <GridWind grid={grid} lat={lat} lon={lon} hour={hour} />}
      </div>
    );
  }
  return <LiveWeather d={w.data} />;
}

function LiveWeather({ d }: { d: PointWeather }) {
  const expert = useExpert();
  const now = Date.now();
  const i = Math.max(0, d.hourly.time.findIndex((t) => Date.parse(t) >= now - 30 * 60e3));
  const today = new Date().toISOString().slice(0, 10);
  const k = d.fwi.findIndex((x) => x.date === today);
  const days = d.fwi.slice(Math.max(0, k), Math.max(0, k) + 3);
  const cur = days[0];
  const cls = cur ? fwiClass(cur.value.fwi) : null;
  const W = 320; const H = 80; const n = 48;
  const sp = d.hourly.wind.slice(i, i + n); const gu = d.hourly.gust.slice(i, i + n);
  const max = Math.max(10, ...gu);
  const path = (v: number[]) => v.map((x, j) => `${j ? 'L' : 'M'}${((j / (n - 1)) * W).toFixed(1)},${(H - (x / max) * (H - 6)).toFixed(1)}`).join('');
  return (
    <div style={{ marginTop: 14 }}>
      <IconHeading as="h3" icon="gauge" className={expert ? 'eyebrow' : undefined}>{expert ? 'Fire danger · Fire Weather Index' : 'Fire danger'}</IconHeading>
      {cur && cls ? (
        <>
          <div className="danger">
            <span className="danger-chip" style={{ background: cls.color }}>{cls.label}</span>
            {expert && <span className="danger-num num">{fmt1(cur.value.fwi)}</span>}
            <span className="small muted">today at noon</span>
          </div>
          {!expert && <p className="small" style={{ margin: '0 0 8px' }}>{fwiMeaning(cls.label)}</p>}
          <ol className="danger-scale" aria-label="EFFIS fire danger classes">
            {FWI_CLASSES.map((c) => <li key={c.label} style={{ background: c.color }} aria-current={c.label === cls.label} title={c.label} />)}
          </ol>
          <div className="danger-days">{days.map((x) => { const c = fwiClass(x.value.fwi); return (
            <div key={x.date}><small>{x.date === today ? 'Today' : new Date(`${x.date}T12:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</small>
              {expert ? <><strong style={{ color: c.color }}>{fmt1(x.value.fwi)}</strong><small>{c.label}</small></> : <strong className="day-word">{c.label}</strong>}</div>); })}</div>
          {expert && <><details><summary>Index components</summary>
            <dl className="facts tight"><dt>FFMC (fine fuels)</dt><dd>{fmt1(cur.value.ffmc)}</dd><dt>DMC (duff)</dt><dd>{fmt1(cur.value.dmc)}</dd><dt>DC (deep drought)</dt><dd>{fmt1(cur.value.dc)}</dd>
              <dt>ISI (spread potential)</dt><dd>{fmt1(cur.value.isi)}</dd><dt>BUI (fuel available)</dt><dd>{fmt1(cur.value.bui)}</dd>
              <dt>Noon weather used</dt><dd>{fmt1(cur.noon.t)} °C, {Math.round(cur.noon.rh)} %, {Math.round(cur.noon.wind)} km/h, {cur.noon.rain} mm in 24 h</dd></dl>
          </details>
          <p className="hint">Canadian Fire Weather Index (the system EFFIS uses), computed in your browser from 60 days of ECMWF model weather at noon local time and started from standard values. It rates weather-driven danger, not whether a fire is burning or will spread. EFFIS classes. Official danger: MKFFIS.</p></>}
          {!expert && <p className="hint">Worked out from weather forecast data. It rates the weather, not whether a fire is burning. It is not an official warning: official fire danger is published by <a href="https://mkffis.cuk.gov.mk/index.php/pocetna_strana/pocetna?lang=en" rel="noopener" target="_blank">MKFFIS</a>.</p>}
        </>
      ) : <p className="small muted">{expert ? 'Not enough recent weather to compute the index.' : 'Not enough recent weather to work out fire danger.'}</p>}
      <IconHeading as="h3" icon="thermo" className={expert ? 'eyebrow' : 'wx-now-h'}>{expert ? 'Weather now · live' : 'Weather now'}</IconHeading>
      <dl className="figures">
        <div><dt>Air</dt><dd className="num">{fmt1(d.hourly.t[i])}<small> °C</small></dd></div>
        <div><dt>Humidity</dt><dd className="num">{Math.round(d.hourly.rh[i])}<small> %</small></dd></div>
        <div><dt>Wind</dt><dd className="num">{Math.round(d.hourly.wind[i])}<small> km/h from {expert ? compass(d.hourly.dir[i]) : `the ${compassWords(d.hourly.dir[i])}`}</small></dd></div>
        <div><dt>Gusts</dt><dd className="num">{Math.round(d.hourly.gust[i])}<small> km/h</small></dd></div>
      </dl>
      {!expert && <p className="hint">From a weather forecast model, not a weather station.</p>}
      {expert && <><svg className="wx-chart" viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={`Next 48 hours: wind ${Math.round(Math.min(...sp))} to ${Math.round(Math.max(...sp))} km/h, gusts up to ${Math.round(Math.max(...gu))} km/h.`}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
        <path d={path(gu)} fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="3 3" />
        <path d={path(sp)} fill="none" stroke="var(--text)" strokeWidth="2" />
        <text x="0" y={H + 12} fontSize="9" fill="var(--faint)">now</text><text x={W} y={H + 12} fontSize="9" fill="var(--faint)" textAnchor="end">+48 h</text>
        <text x="2" y="10" fontSize="9" fill="var(--faint)">{Math.round(max)} km/h</text>
      </svg>
      <p className="hint">Wind (solid) and gusts (dashed) for the next 48 h. ECMWF IFS via Open-Meteo, model point {d.grid.map((v) => v.toFixed(3)).join(', ')} at {Math.round(d.elevation_m)} m, fetched {fmtUTC(d.retrieved_utc)}. Model values, not a station.</p></>}
    </div>
  );
}

/** Saved or live grid wind at the nearest model point (fallback when the point request fails). */
function GridWind({ grid, lat, lon, hour }: { grid: WindGrid; lat: number; lon: number; hour: number }) {
  const { p, km } = nearestWindPoint(grid, lat, lon);
  return (
    <dl className="figures">
      <div><dt>Wind</dt><dd className="num">{Math.round(kmh(p.speed[hour]))}<small> km/h from {compass(p.dir[hour])}</small></dd></div>
      <div><dt>Gusts</dt><dd className="num">{Math.round(kmh(p.gust[hour]))}<small> km/h</small></dd></div>
      <div><dt>Valid</dt><dd style={{ fontSize: 'var(--step-0)' }}>{fmtUTC(grid.times[hour])}</dd></div>
      <div><dt>Model point</dt><dd className="num">{fmt1(km)}<small> km away</small></dd></div>
    </dl>
  );
}

function WeatherPanel({ w }: { w: WeatherSample }) {
  const [area, setArea] = useState(0);
  const a = w.areas[area];
  const c = a.current as Record<string, number>;
  const dir = Number(c.wind_direction_10m);
  return (
    <section aria-labelledby="wx-h">
      <IconHeading icon="thermo" id="wx-h" className="h3">Named-point weather</IconHeading>
      <div className="tabs small-tabs" role="group" aria-label="Weather area">
        {w.areas.map((x, i) => <button key={x.area} type="button" aria-pressed={i === area} onClick={() => setArea(i)}>{x.area}</button>)}
      </div>
      <dl className="figures">
        <div><dt>Air</dt><dd className="num">{c.temperature_2m}<small> °C</small></dd></div>
        <div><dt>Humidity</dt><dd className="num">{c.relative_humidity_2m}<small> %</small></dd></div>
        <div><dt>Wind</dt><dd className="num">{Math.round(kmh(c.wind_speed_10m))}<small> km/h from {compass(dir)}</small></dd></div>
        <div><dt>Rain</dt><dd className="num">{c.precipitation}<small> mm/h</small></dd></div>
      </dl>
      <p className="hint">Model value for {fmtUTC(String(a.current.time))}, grid point {a.returned_lat_lon.join(', ')} at {a.returned_elevation_m} m. Requested model <code>{a.model_requested}</code>; {w.model_note}</p>
      <details>
        <summary>72 hourly values (UTC calendar hours 14–16 Nov)</summary>
        <div className="table-scroll"><table className="compact">
          <thead><tr><th scope="col">UTC</th><th scope="col">°C</th><th scope="col">RH %</th><th scope="col">m/s</th><th scope="col">From</th><th scope="col">Gust</th><th scope="col">mm</th></tr></thead>
          <tbody>{a.hourly.time.map((t, i) => (
            <tr key={String(t)}><th scope="row">{String(t).replace('T', ' ')}</th><td>{a.hourly.temperature_2m[i]}</td><td>{a.hourly.relative_humidity_2m[i]}</td>
              <td>{a.hourly.wind_speed_10m[i]}</td><td>{a.hourly.wind_direction_10m[i]}</td><td>{a.hourly.wind_gusts_10m[i]}</td><td>{a.hourly.precipitation[i]}</td></tr>
          ))}</tbody>
        </table></div>
      </details>
      <p className="hint">{w.credit}. Free noncommercial Open-Meteo service; best local accuracy is not established.</p>
    </section>
  );
}

function EffisPanel({ e }: { e: EffisSeason }) {
  const latest = lastNonNull(e.cumulative)!;
  const W = 300; const H = 96;
  const max = Math.max(...e.cumulative.map((r) => Math.max(r.area_ha ?? 0, r.area_ha_avg ?? 0)));
  const x = (w: number) => ((w - 1) / 51) * W;
  const y = (v: number) => H - (v / max) * H;
  const line = (key: 'area_ha' | 'area_ha_avg') => e.cumulative.filter((r) => r[key] !== null).map((r, i) => `${i ? 'L' : 'M'}${x(r.week).toFixed(1)},${y(r[key]!).toFixed(1)}`).join('');
  return (
    <section aria-labelledby="effis-h">
      <IconHeading icon="chart" id="effis-h" className="h3">The 2026 season, as mapped by EFFIS</IconHeading>
      <p className="kind-tag">Mapped burned area, a different product from detections</p>
      <p className="big-fig num">{fmtInt(latest.area_ha!)} <span className="small">ha mapped</span></p>
      <p className="small muted" style={{ marginTop: 0 }}>{fmtInt(latest.events!)} mapped events to the week ending {mdDate(latest.mddate)}. EFFIS reference average for that week: {fmtInt(latest.area_ha_avg ?? 0)} ha, {fmt1(latest.events_avg ?? 0)} events.</p>
      <svg viewBox={`-2 -4 ${W + 4} ${H + 20}`} width="100%" role="img" aria-label={`Cumulative 2026 mapped area reaching ${fmtInt(latest.area_ha!)} ha by week ${latest.week}, against the EFFIS reference average.`}>
        <path d={line('area_ha_avg')} fill="none" stroke="var(--faint)" strokeWidth="1.4" strokeDasharray="4 3" />
        <path d={line('area_ha')} fill="none" stroke="#FF6A00" strokeWidth="2.2" />
        <text x="0" y={H + 13} fontSize="9" fill="var(--faint)">week 1</text><text x={W} y={H + 13} fontSize="9" fill="var(--faint)" textAnchor="end">week 52</text>
      </svg>
      <p className="small muted"><span className="swatch" style={{ background: '#FF6A00' }} aria-hidden />2026 cumulative <span className="swatch dash" aria-hidden />reference average</p>
      <details>
        <summary>Annual mapped area 2006–2026</summary>
        <div className="table-scroll"><table className="compact">
          <thead><tr><th scope="col">Year</th><th scope="col">Mapped ha</th><th scope="col">Events</th></tr></thead>
          <tbody>{e.annual.map((r) => <tr key={r.year}><th scope="row">{r.year}{r.year === 2026 ? ' (partial)' : ''}</th><td>{fmtInt(r.ba)}</td><td>{fmtInt(r.nf)}</td></tr>)}</tbody>
        </table></div>
      </details>
      <p className="hint">{e.product}. Later weeks are not yet published (null, not zero). Mapped events are not confirmed active incidents or detection counts. Third-party dashboards show different totals; this is the original EFFIS response ({e.reference_note}). {e.credit}.</p>
    </section>
  );
}

/** Live CAMS air quality for Skopje, requested by the browser while the Expert view is open. */
function AirPanel() {
  const aq = useAirQuality();
  const d = aq.data;
  const i = d ? nearestHour(d.time) : 0;
  const now = (k: AqKey) => d?.values[k][i] ?? null;
  const peak = (k: AqKey) => {
    let best: number | null = null; let at = '';
    d?.values[k].slice(i, i + 25).forEach((v, j) => { if (v !== null && (best === null || v > best)) { best = v; at = d.time[i + j]; } });
    return { v: best as number | null, at };
  };
  const fig = (k: AqKey, label: string) => {
    const v = now(k);
    return <div><dt>{label}</dt><dd className="num">{v === null ? '–' : Math.round(v)}<small> {d?.units[k]}</small>{k === 'european_aqi' && v !== null && <><br /><small>{eaqiBand(v)}</small></>}</dd></div>;
  };
  const pm = peak('pm2_5'); const aqi = peak('european_aqi');
  return (
    <section aria-labelledby="cams-h">
      <IconHeading icon="cloud" id="cams-h" className="h3">Air quality now, modeled</IconHeading>
      <p className="kind-tag">Live model forecast for {AQ_POINT.area}, not station readings or fire smoke</p>
      {aq.error ? <p className="hint" role="status">Air quality could not load ({aq.error}). Nothing is shown in its place.</p>
        : !d ? <p className="hint" role="status">Loading air quality…</p>
        : <>
          <dl className="figures">{fig('pm2_5', 'PM2.5')}{fig('pm10', 'PM10')}{fig('carbon_monoxide', 'CO')}{fig('european_aqi', 'European AQI')}</dl>
          <p className="hint">Values for {fmtSkopje(d.time[i])} at model grid {d.grid.map((x) => x.toFixed(2)).join(', ')}.
            {pm.v !== null && aqi.v !== null && <> Highest in the next 24 h: PM2.5 {Math.round(pm.v)} {d.units.pm2_5} ({fmtSkopje(pm.at)}), European AQI {Math.round(aqi.v)} ({eaqiBand(aqi.v)}).</>}
            {' '}Fetched by your browser {ageText(d.retrieved_utc)}, refreshed every 30 minutes. CAMS European ensemble at about 11 km (Copernicus Atmosphere Monitoring Service) via Open-Meteo; not attributed to any fire.</p>
        </>}
    </section>
  );
}

const fmtDay = (d: string) => new Date(`${d}T12:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export function mkDetail(mk: MkState, kind: 'fwi' | 'vdm'): string {
  const l = mk[kind];
  if (mk.loading) return 'Looking for the map…';
  if (mk.error) return mk.error;
  if (!l) return kind === 'fwi' ? 'MKFFIS has no map for this day' : 'MKFFIS has no dryness map for this period';
  return kind === 'fwi' ? `Map for ${fmtDay(l.from)}` : `${fmtDay(l.from)} to ${fmtDay(l.to)}`;
}
function MkStatus({ mk, kind }: { mk: MkState; kind: 'fwi' | 'vdm' }) {
  return <p className={`small ${mk.error ? 'warn' : 'muted'}`} role="status" style={{ margin: '8px 0 0' }}>{mkDetail(mk, kind)}</p>;
}
/** The colour keys exactly as MKFFIS publishes them (their images), under the layer switches. */
export function MkLegends({ mk, fwi, vdm }: { mk: MkState; fwi: boolean; vdm: boolean }) {
  const keys = [fwi && mk.fwi && { l: mk.fwi, t: 'Fire danger' }, vdm && mk.vdm && { l: mk.vdm, t: 'Plant dryness' }].filter(Boolean) as { l: { name: string }; t: string }[];
  if (!keys.length) return null;
  return (
    <div className="mk-keys">
      {keys.map((k) => <figure key={k.l.name}><img src={legendUrl(k.l.name)} alt={`${k.t} colour key from MKFFIS`} loading="lazy" /><figcaption>{k.t}</figcaption></figure>)}
      <p className="hint">Maps and keys by MKFFIS, the Crisis Management Centre's fire information system, shown as published. Their reuse terms are not yet confirmed.</p>
    </div>
  );
}
