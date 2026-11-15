// Spread Lab data: precomputed Pyretechnics runs (tools/run_spread_lab.py). Each run is a window of the site grid with
// arrival time (uint8 steps, 255 = not reached) and flame length (0.1 m, 255 = none) per 100 m cell, base64-encoded.
import { fail, validateDoc } from './data';

export interface RunSummary {
  area_ha: (number | null)[]; final_ha: number; edge_minute: number | null; run_km: number; run_bearing: number | null;
  max_flame_m: number; max_ros_m_min: number; flame_class_pct: number[]; spread: boolean;
}
export interface Weather { time: string[]; wind_kmh: number[]; wind_from: number[]; t: number[]; rh: number[]; gust_kmh?: number[]; dead_1h_pct: number[]; dead_10h_pct?: number[]; dead_100h_pct?: number }
export interface Site { id: string; name: string; rows: number; cols: number; cell_m: number; crs: string; corners: [number, number][]; fuel_b64: string; fuel_share_pct: Record<string, number>; excluded_pct: number }
export interface Situation {
  id: string; label: string; blurb: string; story?: string | null; date: string; source: string; horizon_minutes: number; moisture: 'fixed' | 'weather';
  weather: Weather; stats?: Record<string, number>; file: string; runs: Record<string, RunSummary>;
}
export interface Backtest {
  id: string; name: string; story: string; effis_id: number; mapped_ha: number; mapped_grid_ha: number; perimeter: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  file: string; step_minutes: number; horizon_minutes: number; summary: RunSummary; weather: Weather; site: Site;
  ignition: { time_utc: string; row: number; col: number; fuel_model: number; lon: number; lat: number; detections: number };
  metrics: { model_ha: number; overlap_ha: number; model_matches_mapped_min: number | null; mapped_reached_pct: number; model_outside_pct: number; detections: number; detections_reached_pct: number };
  detections: { t: string; lon: number; lat: number; sensor: string; reached: boolean; after_min: number }[];
  mapped_fuel_pct: Record<string, number>;
}
export interface Lab {
  schema: 'firewatch.spread.lab.v1'; calibrated: false; created_utc: string; engine: { name: string; version: string; propagation: string };
  site: Site; horizon_minutes: number; checkpoints: number[]; flame_breaks_m: number[];
  fuel_models: Record<string, { name: string; short: string; color: string }>;
  ignitions: { id: string; label: string; row: number; col: number; lon: number; lat: number; fuel_model: number; elevation_m: number; slope_pct: number }[];
  speeds: number[]; directions: string[];
  dryness: { id: string; label: string; scenario: string; moisture: Record<string, number> }[];
  climate: { source: string; cell: [number, number]; cell_elevation_m: number; hours: number; window: string; calm_pct: number; rose_pct: number[];
    speed_at_least_pct: number[]; gust_at_least_pct: number[]; wind_kmh: Record<string, number>; gust_kmh: Record<string, number>;
    dead_1h_pct: Record<string, number>; dryness_at_or_below_pct: number[] };
  matrix: Record<string, Record<string, { file: string; runs: Record<string, RunSummary> }>>;
  situations: Situation[]; backtests: Backtest[]; assumptions: Record<string, string>;
  inputs: { path: string; sha256: string }[];
  checks: Record<string, { stop_time_minutes: number; burned_cells: number; extents_cells?: Record<string, number> }>; credits: string[];
}
export interface RunCell { w: [number, number, number, number]; a: string; f: string }
export interface RunsFile { schema: 'firewatch.spread.lab.runs.v1'; step_minutes: number; runs: Record<string, RunCell> }
export interface Run { r0: number; c0: number; h: number; w: number; step: number; arrival: Uint8Array; flame: Uint8Array }

export function validateLab(raw: unknown, path: string): Lab {
  const l = validateDoc<Lab>('firewatch.spread.lab.v1', ['site', 'matrix', 'situations', 'backtests', 'ignitions', 'dryness'])(raw, path);
  if (!Array.isArray(l.backtests) || !l.backtests.length) fail(path, 'expected at least one backtest');
  if (l.calibrated !== false) fail(path, 'Spread Lab runs must be marked uncalibrated');
  if (l.site.fuel_b64.length !== Math.ceil((l.site.rows * l.site.cols) / 3) * 4) fail(path, 'fuel grid does not match the site size');
  const orig = l.situations.find((s) => s.id === 'original');
  if (orig?.runs.centre?.final_ha !== 17) fail(path, 'original situation no longer reproduces the verified 17 ha run');
  return l;
}
export const validateRuns = validateDoc<RunsFile>('firewatch.spread.lab.runs.v1', ['runs', 'step_minutes']);

export const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function decodeRun(c: RunCell, step: number): Run {
  const [r0, c0, h, w] = c.w;
  const arrival = bytes(c.a); const flame = bytes(c.f);
  if (arrival.length !== h * w || flame.length !== h * w) throw new Error('run window does not match its cells');
  return { r0, c0, h, w, step, arrival, flame };
}

/** Modeled hectares reached by minute t (one 100 m cell = 1 ha). */
export function areaAt(run: Run, t: number): number {
  let n = 0;
  for (const a of run.arrival) if (a !== 255 && a * run.step <= t) n++;
  return n;
}

/** Hauling-chart class (0-3) of a flame length in metres. */
export const flameClass = (m: number, breaks: number[]) => breaks.filter((b) => m >= b).length;

export const ARRIVAL_RAMP = ['#ffe08a', '#ff9a3c', '#e8572a', '#a32626'];
export const FLAME_COLORS = ['#ffe08a', '#ff9a3c', '#e8572a', '#a32626'];
const FRONT = [255, 248, 225];
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function ramp(x: number): number[] {
  const stops = ARRIVAL_RAMP.map(hex); const p = Math.min(1, Math.max(0, x)) * (stops.length - 1); const i = Math.min(stops.length - 2, Math.floor(p)); const f = p - i;
  return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
}

/** The run drawn on a canvas of the whole site grid (north-up, one pixel per cell) as of minute t: arrival-time colours,
 *  or flame-length classes; cells reached in the last `front` minutes are drawn as the active front. */
export function paintRun(run: Run, rows: number, cols: number, t: number, horizon: number, mode: 'arrival' | 'flame', breaks: number[], front: number): string {
  const canvas = Object.assign(document.createElement('canvas'), { width: cols, height: rows });
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(cols, rows);
  const flames = FLAME_COLORS.map(hex);
  for (let y = 0; y < run.h; y++) for (let x = 0; x < run.w; x++) {
    const k = y * run.w + x; const a = run.arrival[k];
    if (a === 255) continue;
    const m = a * run.step;
    if (m > t) continue;
    const rgb = t - m < front && t < horizon ? FRONT : mode === 'flame' ? flames[flameClass(run.flame[k] / 10, breaks)] : ramp(m / horizon);
    const p = ((run.r0 + y) * cols + run.c0 + x) * 4;
    img.data[p] = rgb[0]; img.data[p + 1] = rgb[1]; img.data[p + 2] = rgb[2]; img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/** The site's fuel models drawn in the EFFIS legend colours; excluded cells stay transparent. */
export function paintFuel(site: Site, models: Lab['fuel_models']): string {
  const canvas = Object.assign(document.createElement('canvas'), { width: site.cols, height: site.rows });
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(site.cols, site.rows);
  const codes = bytes(site.fuel_b64);
  codes.forEach((c, i) => {
    const color = models[String(c)]?.color;
    if (!c || !color) return;
    const rgb = hex(color);
    img.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  });
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}
