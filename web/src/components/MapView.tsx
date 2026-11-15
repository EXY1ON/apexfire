import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { ExpressionSpecification, GeoJSONSource, ImageSource, LayerSpecification, Map as MLMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

export const MK_BOUNDS: [number, number, number, number] = [20.4, 40.8, 23.1, 42.4];

/* ---------- Basemap preference (per viewer, shared by every map on the site) ---------- */

export type Basemap = 'night' | 'light' | 'terrain' | 'satellite';
export const BASEMAPS: Record<Basemap, { label: string; url: string; hint: string }> = {
  night: { label: 'Night', url: 'https://tiles.openfreemap.org/styles/dark', hint: 'Graphite map with roads, places and relief' },
  light: { label: 'Light', url: 'https://tiles.openfreemap.org/styles/positron', hint: 'Pale map with relief' },
  terrain: { label: 'Terrain', url: 'https://tiles.openfreemap.org/styles/liberty', hint: 'Land cover, forests and relief' },
  satellite: { label: 'Satellite', url: 'https://tiles.openfreemap.org/styles/positron', hint: 'Cloud-free Sentinel-2 mosaic (2024) with place labels' },
};
// Cloud-free 10 m Sentinel-2 mosaic by EOX; CC BY-NC-SA 4.0, fine for this non-commercial prototype.
const S2_CLOUDLESS = {
  type: 'raster' as const, tileSize: 256, maxzoom: 14,
  tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'],
  attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless 2024</a> by EOX (CC BY-NC-SA 4.0; modified Copernicus Sentinel data)',
};
const STORE_KEY = 'firewatch.basemap';
const listeners = new Set<() => void>();
let current: Basemap = (() => {
  try { const v = localStorage.getItem(STORE_KEY); return v && v in BASEMAPS ? (v as Basemap) : 'night'; } catch { return 'night'; }
})();

export function setBasemapPreference(b: Basemap) {
  current = b;
  try { localStorage.setItem(STORE_KEY, b); } catch { /* storage unavailable: preference lasts for this page only */ }
  listeners.forEach((l) => l());
}
export function useBasemap(): Basemap {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current);
}

/* ---------- Style composition: relief, Night recolouring, carried ApexFire layers ---------- */

const DEM = {
  type: 'raster-dem' as const, encoding: 'terrarium' as const, tileSize: 256, maxzoom: 15,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  attribution: '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain Tiles</a> (Mapzen/AWS; SRTM, GMTED, ETOPO1)',
};
const HILLSHADE: Record<Basemap, Record<string, string | number>> = {
  night: { 'hillshade-shadow-color': '#080907', 'hillshade-highlight-color': '#55544b', 'hillshade-accent-color': '#16170f', 'hillshade-exaggeration': 0.5 },
  light: { 'hillshade-shadow-color': '#76736a', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#8f8b80', 'hillshade-exaggeration': 0.35 },
  terrain: { 'hillshade-shadow-color': '#46503a', 'hillshade-highlight-color': '#fffdf4', 'hillshade-accent-color': '#5f6a4c', 'hillshade-exaggeration': 0.45 },
  satellite: {},
};
// The stock dark style draws minor roads at #181818 on #0c0c0c, so streets vanish; lift it to warm graphite.
const NIGHT_PAINT: Record<string, Record<string, string>> = {
  background: { 'background-color': '#1e1f1b' },
  water: { 'fill-color': '#141d22' },
  waterway: { 'line-color': '#29404c' },
  landcover_wood: { 'fill-color': '#222720' },
  landuse_park: { 'fill-color': '#222720' },
  landuse_residential: { 'fill-color': '#262723' },
  building: { 'fill-color': '#2d2e29', 'fill-outline-color': '#3a3b35' },
  highway_path: { 'line-color': '#3b3c36' },
  highway_minor: { 'line-color': '#43443d' },
  highway_major_casing: { 'line-color': 'rgba(120,118,108,0.55)' },
  highway_major_inner: { 'line-color': '#55554c' },
  highway_major_subtle: { 'line-color': '#4a4a42' },
  highway_motorway_casing: { 'line-color': 'rgba(150,140,120,0.6)' },
  highway_motorway_inner: { 'line-color': '#7a705f' },
  highway_motorway_subtle: { 'line-color': '#5e574b' },
  railway: { 'line-color': '#4a4a43' }, railway_minor: { 'line-color': '#45453e' }, railway_transit: { 'line-color': '#45453e' },
  boundary_state: { 'line-color': '#5c5b53' },
  'boundary_country_z0-4': { 'line-color': '#7a786e' },
  'boundary_country_z5-': { 'line-color': '#7a786e' },
  highway_name_other: { 'text-color': '#9d998d', 'text-halo-color': '#1e1f1b' },
  highway_name_motorway: { 'text-color': '#b0aa9a' },
  water_name: { 'text-color': '#7f9db0', 'text-halo-color': '#141d22' },
};
const PLACE_TEXT = { 'text-color': '#cfcabd', 'text-halo-color': 'rgba(20,21,18,0.9)' };

export type Ink = 'light' | 'dark';
export const inkOf = (b: Basemap): Ink => (b === 'night' || b === 'satellite' ? 'light' : 'dark');
export const INK = { light: { fg: '#f1ede4', halo: 'rgba(18,19,16,0.9)' }, dark: { fg: '#1d1e1a', halo: 'rgba(255,255,252,0.92)' } };

/** Layers tagged with metadata['fw:ink'] take a foreground colour that contrasts with the basemap. */
function inked(layer: LayerSpecification, ink: Ink): LayerSpecification {
  const kind = (layer.metadata as Record<string, string> | undefined)?.['fw:ink'];
  if (!kind) return layer;
  const c = INK[ink];
  const l = { ...layer, paint: { ...(layer as { paint?: object }).paint }, layout: { ...(layer as { layout?: object }).layout } } as unknown as Record<string, Record<string, unknown>>;
  if (kind === 'line') l.paint['line-color'] = c.fg;
  if (kind === 'wind') {
    l.layout['icon-image'] = `fw-wind-${ink}`;
    l.paint['text-color'] = c.fg;
    l.paint['text-halo-color'] = c.halo;
  }
  return l as unknown as LayerSpecification;
}

const LABEL_ON_IMAGE = { 'text-color': '#f4f1ea', 'text-halo-color': 'rgba(10,11,9,0.85)', 'text-halo-width': 1.4 };

function composeStyle(prev: StyleSpecification | undefined, next: StyleSpecification, b: Basemap): StyleSpecification {
  let layers: LayerSpecification[];
  const extra: StyleSpecification['sources'] = {};
  if (b === 'satellite') {
    // Imagery underneath, then only the label and boundary layers of the vector style.
    extra['basemap-s2'] = S2_CLOUDLESS;
    layers = [
      { id: 'background', type: 'background', paint: { 'background-color': '#1b1c18' } },
      { id: 'basemap-s2', type: 'raster', source: 'basemap-s2' },
      ...next.layers.filter((l) => l.type === 'symbol' || l.id.startsWith('boundary')).map((l) => (l.type === 'symbol'
        ? ({ ...l, paint: { ...(l as { paint?: object }).paint, ...LABEL_ON_IMAGE } } as LayerSpecification)
        : ({ ...l, paint: { ...(l as { paint?: object }).paint, 'line-color': 'rgba(255,250,240,0.55)' } } as LayerSpecification))),
    ];
  } else {
    layers = next.layers.map((l) => {
      const over = b === 'night' ? (NIGHT_PAINT[l.id] ?? (l.id.startsWith('place_') ? PLACE_TEXT : null)) : null;
      return over ? ({ ...l, paint: { ...(l as { paint?: object }).paint, ...over } } as LayerSpecification) : l;
    });
    const at = layers.findIndex((l) => (l as { 'source-layer'?: string })['source-layer'] === 'transportation');
    layers.splice(at < 0 ? layers.length : at, 0, { id: 'basemap-hillshade', type: 'hillshade', source: 'basemap-dem', paint: HILLSHADE[b] } as LayerSpecification);
    extra['basemap-dem'] = DEM;
  }
  const carriedSources = Object.fromEntries(Object.entries(prev?.sources ?? {}).filter(([id]) => id.startsWith('fw-')));
  const carriedLayers = (prev?.layers ?? []).filter((l) => l.id.startsWith('fw-')).map((l) => inked(l, inkOf(b)));
  return {
    ...next, metadata: { ...(next.metadata as object), 'fw:basemap': b },
    sources: { ...next.sources, ...extra, ...carriedSources },
    layers: [...layers, ...carriedLayers],
  };
}

// Shown only if a basemap style cannot load; data layers still render on it.
const FALLBACK_STYLE: StyleSpecification = {
  version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#24251f' } }],
};

/* ---------- Icons ---------- */

export const SENSOR_COLOR: Record<string, string> = {
  // OKLCH L 0.63-0.67 steps of the original hues; validated for CVD separation and contrast (dataviz validator, dark surface).
  modis: '#AD921A', 'viirs-jpss1': '#3C96CF', 'viirs-snpp': '#C65F9E', 'viirs-noaa21': '#23AC74', VIIRS_NOAA20_NRT: '#3C96CF', VIIRS_NOAA21_NRT: '#23AC74',
};
// Each sensor also has its own shape so colour is never the only cue; map icons, legends and lists share these paths.
const CIRCLE = 'M2.5 8a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0Z';
const SQUARE = 'M3 3H13V13H3Z';
const TRIANGLE = 'M8 1.8L14.4 13.4H1.6Z';
const DIAMOND = 'M8 1.2L14.8 8L8 14.8L1.2 8Z';
export const SENSOR_SHAPE: Record<string, string> = {
  modis: SQUARE, 'viirs-jpss1': CIRCLE, 'viirs-snpp': TRIANGLE, 'viirs-noaa21': DIAMOND, VIIRS_NOAA20_NRT: CIRCLE, VIIRS_NOAA21_NRT: DIAMOND,
};
export const SHAPE_NAME: Record<string, string> = {
  modis: 'square', 'viirs-jpss1': 'circle', 'viirs-snpp': 'triangle', 'viirs-noaa21': 'diamond', VIIRS_NOAA20_NRT: 'circle', VIIRS_NOAA21_NRT: 'diamond',
};
export const WIND_ARROW = 'M8 1L13 7.5H9.6V15H6.4V7.5H3Z'; // points north; rotated to the direction the wind blows towards
// Selection marks in a 16 x 20 box, base point at the bottom centre. Flame = a grouped fire (Now); pin = a place picked for weather.
// The flame echoes the logo: an ember flame with a dark elongated core.
export const FLAME = 'M8 0.8C8.9 3.6 13.6 7.4 13.6 12.6C13.6 16.4 11.1 19.2 8 19.2C4.9 19.2 2.4 16.4 2.4 12.6C2.4 9.6 4.2 7.9 5.3 6.2C5.5 8 6.3 9 7.1 9.4C6.6 6.4 7.1 3.4 8 0.8Z';
export const FLAME_CORE = 'M8 9.6C8.8 11.5 10.1 12.9 10.1 14.9C10.1 16.5 9.2 17.5 8 17.5C6.8 17.5 5.9 16.5 5.9 14.9C5.9 12.9 7.2 11.5 8 9.6Z';
export const PIN = 'M8 19.4C8 19.4 2 12.8 2 8A6 6 0 0 1 14 8C14 12.8 8 19.4 8 19.4Z';
export const PIN_HOLE = 'M5.6 8A2.4 2.4 0 1 0 10.4 8A2.4 2.4 0 1 0 5.6 8Z';

export function SensorMark({ sensor, size = 14 }: { sensor: string; size?: number }) {
  return (
    <svg className="sensor-mark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={SENSOR_SHAPE[sensor]} fill={SENSOR_COLOR[sensor]} stroke="#0C0D0A" strokeWidth="1.2" />
    </svg>
  );
}

const ICON_PX = 32; // drawn at 2x, shown at 16 CSS px when icon-size is 1

function drawIcon(map: MLMap, id: string, d: string, fill: string, stroke: string, strokeWidth: number) {
  if (map.hasImage(id)) return;
  const canvas = Object.assign(document.createElement('canvas'), { width: ICON_PX, height: ICON_PX });
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(ICON_PX / 16, ICON_PX / 16);
  const path = new Path2D(d);
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = stroke;
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
  map.addImage(id, ctx.getImageData(0, 0, ICON_PX, ICON_PX), { pixelRatio: 2 });
}

/** A 16 x 20 selection mark at `scale` CSS px per unit, with a pale halo and dark outline so it reads on every basemap. */
function drawMark(map: MLMap, id: string, outer: string, inner: string, fill: string, innerFill: string, scale: number) {
  if (map.hasImage(id)) return;
  const k = 2 * scale; const pad = 2;
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil((16 + pad * 2) * k), height: Math.ceil((20 + pad) * k) });
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(k, k);
  ctx.translate(pad, pad / 2);
  const o = new Path2D(outer);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,250,240,0.92)'; ctx.lineWidth = 3.4; ctx.stroke(o);
  ctx.strokeStyle = '#0C0D0A'; ctx.lineWidth = 1.5; ctx.stroke(o);
  ctx.fillStyle = fill; ctx.fill(o);
  ctx.fillStyle = innerFill; ctx.fill(new Path2D(inner));
  map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 });
}

function addMapIcons(map: MLMap) {
  for (const [sensor, d] of Object.entries(SENSOR_SHAPE)) drawIcon(map, `fw-icon-${sensor}`, d, SENSOR_COLOR[sensor], '#0C0D0A', 1.2);
  drawIcon(map, 'fw-wind-light', WIND_ARROW, INK.light.fg, INK.light.halo, 2.2);
  drawIcon(map, 'fw-wind-dark', WIND_ARROW, INK.dark.fg, INK.dark.halo, 2.2);
  drawMark(map, 'fw-flame', FLAME, FLAME_CORE, '#FF6A00', '#0C0D0A', 1.5);
  drawMark(map, 'fw-pin', PIN, PIN_HOLE, '#FF6A00', '#f6f2ea', 1.4);
}

/** Symbol layer for a flame or pin selection mark whose base point sits on the feature. */
export function markLayer(id: string, source: string, icon: 'fw-flame' | 'fw-pin'): LayerSpecification {
  return { id, type: 'symbol', source, layout: { 'icon-image': icon, 'icon-anchor': 'bottom', 'icon-offset': [0, 2], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
    'icon-size': ['coalesce', ['get', 'size'], 1] } };
}

/** Detections drawn as their sensor shape; larger for higher fire radiative power (`frp` property, MW). Sizes at zoom 6 / 10 / 13. */
export function sensorPointLayer(id: string, source: string, size: [number, number, number]): LayerSpecification {
  const frp: ExpressionSpecification = ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 5], 0, 0.75, 5, 0.95, 30, 1.2, 150, 1.55, 600, 1.9];
  return {
    id, type: 'symbol', source, filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['concat', 'fw-icon-', ['get', 'sensor']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 6, ['*', size[0], frp], 10, ['*', size[1], frp], 13, ['*', size[2], frp]],
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'frp'],
    },
    paint: { 'icon-opacity': 0.95 },
  };
}

/* ---------- Map component ---------- */

export type MapStatus = 'loading' | 'ready' | 'failed';

interface Props {
  label: string;
  bounds?: [number, number, number, number];
  onReady: (map: MLMap) => void;
  children?: ReactNode; // overlay content (legend etc.)
  className?: string;
  style?: CSSProperties;
}

/** MapLibre is loaded lazily so lists and details remain usable if WebGL or the library fails.
 *  Switching basemap replaces the style but carries every `fw-` source and layer across. */
export function MapView({ label, bounds = MK_BOUNDS, onReady, children, className, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const shown = useRef<Basemap | null>(null);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [problem, setProblem] = useState<'none' | 'basemap' | 'tiles'>('none');
  const basemap = useBasemap();
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    let map: MLMap | undefined;
    let cancelled = false;
    const first = current;
    // Compose the basemap before creating the map so data layers never race a second style load.
    const style = fetch(BASEMAPS[first].url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: StyleSpecification) => composeStyle(undefined, json, first), () => { setProblem('basemap'); return FALLBACK_STYLE; });
    Promise.all([import('maplibre-gl'), style]).then(([ml, initial]) => {
      if (cancelled || !ref.current) return;
      ml.setWorkerUrl(workerUrl);
      shown.current = first;
      try {
        map = new ml.Map({
          container: ref.current, style: initial, bounds, fitBoundsOptions: { padding: 24 },
          attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, maxPitch: 0,
        });
      } catch {
        setStatus('failed');
        return;
      }
      map.touchZoomRotate.disableRotation();
      // Phones: the attribution starts collapsed to its (i) button so it does not cover the map; it stays one tap away.
      // MapLibre opens it whenever it first turns compact (after the style's sources arrive), so collapse right after that.
      const attrib = ref.current.querySelector('.maplibregl-ctrl-attrib');
      if (attrib && ref.current.offsetWidth <= 640) {
        const m = map;
        const collapse = () => {
          if (!attrib.classList.contains('maplibregl-compact')) return;
          attrib.classList.remove('maplibregl-compact-show');
          m.off('styledata', collapse); m.off('sourcedata', collapse);
        };
        m.on('styledata', collapse); m.on('sourcedata', collapse); collapse();
      }
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      // Locate me: one tap asks the browser for the position, shows it with its accuracy and zooms to the fires around it.
      // The position stays in the browser (no ApexFire request carries it).
      map.addControl(new ml.GeolocateControl({ positionOptions: { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
        trackUserLocation: false, showAccuracyCircle: true, fitBoundsOptions: { maxZoom: 10 } }), 'top-right');
      map.addControl(new ml.ScaleControl({ unit: 'metric' }), 'bottom-right');
      map.on('error', (ev) => {
        const sourceId = (ev as { sourceId?: string }).sourceId;
        if (!sourceId) setProblem('basemap');
        else if (!sourceId.startsWith('fw-')) setProblem((p) => (p === 'none' ? 'tiles' : p));
      });
      let started = false;
      map.on('style.load', () => {
        if (cancelled || !map) return;
        styleReady.set(map, true);
        addMapIcons(map);
        if ((map.getStyle().metadata as Record<string, string> | undefined)?.['fw:basemap']) setProblem('none');
        if (started) return;
        started = true;
        mapRef.current = map;
        setStatus('ready');
        ready.current(map);
      });
    }, () => setStatus('failed'));
    return () => { cancelled = true; mapRef.current = null; map?.remove(); };
    // bounds are the initial view only
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || shown.current === basemap) return;
    shown.current = basemap;
    styleReady.set(map, false);
    map.setStyle(BASEMAPS[basemap].url, { diff: false, transformStyle: (prev, next) => composeStyle(prev, next, basemap) });
  }, [basemap, status]);

  return (
    <div className={`map-wrap${className ? ` ${className}` : ''}`} style={style} data-basemap={basemap}>
      <div ref={ref} className="map" role="region" aria-label={`${label}. The same content is listed beside the map.`} />
      {status === 'loading' && <p className="map-note" role="status">Loading map…</p>}
      {status === 'failed' && <p className="map-note error" role="status">The interactive map could not start (WebGL or map library unavailable). Lists, tables and downloads still work.</p>}
      {problem === 'basemap' && <p className="map-note warn" role="status">Basemap unavailable. ApexFire data is shown on a plain background.</p>}
      {problem === 'tiles' && <p className="map-note warn" role="status">Some basemap, relief or imagery tiles failed to load.</p>}
      <BasemapToggle value={basemap} />
      {children}
    </div>
  );
}

/** One round button showing the current basemap. It expands into the four choices and folds back once one is picked
 *  (or on Escape, or a tap elsewhere). Sideways from the bottom left on wide screens; downwards from the top right on phones. */
function BasemapToggle({ value }: { value: Basemap }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLButtonElement>('.bm-options [aria-pressed="true"]')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', away);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', away); };
  }, [open]);
  const pick = (b: Basemap) => { setBasemapPreference(b); setOpen(false); trigger.current?.focus(); };
  return (
    <div ref={box} className="bm-toggle" data-open={open || undefined}>
      <button ref={trigger} type="button" className="bm-trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        aria-label={`Basemap: ${BASEMAPS[value].label}`} title="Change the basemap">
        <span className={`bm-swatch bm-${value}`} aria-hidden="true" /><span className="bm-name" aria-hidden="true">{BASEMAPS[value].label}</span>
      </button>
      <div id={id} className="bm-options" role="group" aria-label="Basemap">
        {(Object.keys(BASEMAPS) as Basemap[]).map((b) => (
          <button key={b} type="button" aria-pressed={value === b} title={BASEMAPS[b].hint} onClick={() => pick(b)}>
            <span className={`bm-swatch bm-${b}`} aria-hidden="true" />{BASEMAPS[b].label}
          </button>
        ))}
      </div>
    </div>
  );
}

// False while a basemap switch is loading; sources and layers added then are retried once the new style is in.
const styleReady = new WeakMap<MLMap, boolean>();
const whenReady = (map: MLMap, fn: () => void) => {
  if (styleReady.get(map) === false) { map.once('style.load', fn); return false; }
  return true;
};

/** Cluster options for detection sources: groups merge until zoom 8, so single detections show from zoom 9. */
export const CLUSTER = { cluster: true, clusterRadius: 42, clusterMaxZoom: 8, clusterProperties: { frp: ['max', ['get', 'frp']] } } as const;

export function setGeoJSON(map: MLMap, id: string, data: GeoJSON.GeoJSON, attribution?: string, options?: object) {
  if (!whenReady(map, () => setGeoJSON(map, id, data, attribution, options))) return;
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) src.setData(data);
  else map.addSource(id, { type: 'geojson', data, attribution, ...options });
}

/** Numbered group circles for a clustered detection source; size steps at 25 and 100 detections. */
export function clusterLayers(source: string): LayerSpecification[] {
  return [
    { id: `${source}-cluster`, type: 'circle', source, filter: ['has', 'point_count'], paint: {
      'circle-color': 'rgba(24,25,21,0.92)', 'circle-stroke-color': '#FF6A00', 'circle-stroke-width': 2,
      'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 24] } },
    { id: `${source}-count`, type: 'symbol', source, filter: ['has', 'point_count'], layout: {
      'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': '#f4f1ea' } },
  ];
}

/** Zoom into a clicked group until it splits. */
export function expandCluster(map: MLMap, source: string, feature: { properties?: Record<string, unknown>; geometry?: GeoJSON.Geometry }) {
  const id = feature.properties?.cluster_id as number | undefined;
  const src = map.getSource(source) as GeoJSONSource | undefined;
  if (id === undefined || !src || feature.geometry?.type !== 'Point') return;
  const center = feature.geometry.coordinates as [number, number];
  src.getClusterExpansionZoom(id).then((zoom) => map.easeTo({ center, zoom: Math.min(zoom, 12) }), () => undefined);
}

/** Adds missing layers; ink-tagged layers get the contrast colour for the current basemap. */
export function addLayers(map: MLMap, layers: LayerSpecification[], before?: string) {
  if (!whenReady(map, () => addLayers(map, layers, before))) return;
  for (const l of layers) if (!map.getLayer(l.id)) map.addLayer(inked(l, inkOf(current)), before && map.getLayer(before) ? before : undefined);
}

/** A raster tile overlay drawn under ApexFire's data layers and the basemap's labels; a null url removes it. */
export function setRaster(map: MLMap, id: string, url: string | null, o: { attribution: string; bounds?: [number, number, number, number]; maxzoom?: number; opacity?: number }) {
  if (!whenReady(map, () => setRaster(map, id, url, o))) return;
  const layer = `${id}-layer`;
  const src = map.getSource(id) as { tiles?: string[] } | undefined;
  if (src && (!url || src.tiles?.[0] !== url)) { if (map.getLayer(layer)) map.removeLayer(layer); map.removeSource(id); }
  if (!url || map.getSource(id)) return;
  // bounds: no tile requests outside them; maxzoom: coarser imagery is enlarged above it instead of requested.
  map.addSource(id, { type: 'raster', tiles: [url], tileSize: 256, attribution: o.attribution, ...(o.bounds && { bounds: o.bounds }), ...(o.maxzoom && { maxzoom: o.maxzoom }) });
  const before = map.getStyle().layers.find((l) => l.type === 'symbol' || (l.id.startsWith('fw-') && l.type !== 'raster'))?.id;
  map.addLayer({ id: layer, type: 'raster', source: id, paint: { 'raster-opacity': o.opacity ?? 0.6 } }, before);
}

/** A georeferenced picture (a model grid drawn on a canvas) under the labels and point layers, cells kept sharp; corners
 *  clockwise from top-left. `before` places it under another fw- layer; a null url removes it. Image sources take no
 *  attribution in the style spec (MapLibre rejects the source), so credit belongs in the page or legend. */
export function setImage(map: MLMap, id: string, url: string | null, coordinates: [number, number][], o: { opacity?: number; before?: string } = {}) {
  if (!whenReady(map, () => setImage(map, id, url, coordinates, o))) return;
  const layer = `${id}-layer`;
  const src = map.getSource(id) as ImageSource | undefined;
  if (!url) { if (map.getLayer(layer)) map.removeLayer(layer); if (src) map.removeSource(id); return; }
  const corners = coordinates as [[number, number], [number, number], [number, number], [number, number]];
  if (src) { src.updateImage({ url, coordinates: corners }); return; }
  map.addSource(id, { type: 'image', url, coordinates: corners });
  const before = o.before && map.getLayer(o.before) ? o.before : map.getStyle().layers.find((l) => l.type === 'symbol' || (l.id.startsWith('fw-') && l.type !== 'raster'))?.id;
  map.addLayer({ id: layer, type: 'raster', source: id, paint: { 'raster-opacity': o.opacity ?? 0.85, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, before);
}
