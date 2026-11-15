// Daily reanalysis weather 2000-2025 (NASA POWER, MERRA-2) exported per year by tools/export_web_data.py.
import { fail, validateDoc } from './data';
import { pointInGeometry } from './geo';
import { fieldFromComponents, type Field } from './wind-field';

export type WxKey = 'u' | 'v' | 'ws' | 'wsmax' | 'tmax' | 'rh' | 'rain';
export interface WeatherYear {
  schema: 'firewatch.history.weather.v1'; year: number; provider: string; source: string; credit: string; notes: string; retrieved_utc: string;
  lats: number[]; lons: number[]; start: string; days: number; elevation_m: number[]; scale: number; units: Record<WxKey, string>;
  u: (number | null)[][]; v: (number | null)[][]; ws: (number | null)[][]; wsmax: (number | null)[][]; tmax: (number | null)[][]; rh: (number | null)[][]; rain: (number | null)[][];
}
const KEYS: WxKey[] = ['u', 'v', 'ws', 'wsmax', 'tmax', 'rh', 'rain'];

export function validateWeatherYear(raw: unknown, path: string): WeatherYear {
  const w = validateDoc<WeatherYear>('firewatch.history.weather.v1', [...KEYS, 'lats', 'lons', 'days', 'start'])(raw, path);
  const n = w.lats.length * w.lons.length;
  for (const k of KEYS) {
    if (w[k].length !== n || w[k].some((row) => row.length !== w.days)) fail(path, `${k} does not match the grid and day count`);
  }
  return w;
}

export const dayIndex = (w: WeatherYear, day: string) => Math.round((Date.parse(`${day}T00:00Z`) - Date.parse(`${w.start}T00:00Z`)) / 864e5);
export const dayOf = (w: WeatherYear, i: number) => new Date(Date.parse(`${w.start}T00:00Z`) + i * 864e5).toISOString().slice(0, 10);

/** Grid nodes inside the country (lat-major order, like the arrays); all nodes if the outline is not loaded. */
export function insideNodes(w: WeatherYear, country: GeoJSON.Geometry | null): number[] {
  const all = w.lats.flatMap((lat, i) => w.lons.map((lon, j) => ({ k: i * w.lons.length + j, lat, lon })));
  const ins = country ? all.filter((p) => pointInGeometry(p.lon, p.lat, country)).map((p) => p.k) : [];
  return ins.length ? ins : all.map((p) => p.k);
}

/** Mean over the given nodes for one day, in real units; null when every node is a gap. */
export function meanAt(w: WeatherYear, key: WxKey, day: number, nodes: number[]): number | null {
  let sum = 0; let n = 0;
  for (const k of nodes) { const x = w[key][k][day]; if (x !== null) { sum += x; n++; } }
  return n ? sum / n / w.scale : null;
}

/** That day's mean wind as a field for the particles (null if any node is missing). */
export function dayField(w: WeatherYear, day: number): Field | null {
  if (day < 0 || day >= w.days) return null;
  return fieldFromComponents(w.lats, w.lons, w.u.map((r) => (r[day] === null ? null : r[day]! / w.scale)), w.v.map((r) => (r[day] === null ? null : r[day]! / w.scale)));
}

/** Direction the wind blows FROM (degrees) for a u/v pair. */
export const fromDir = (u: number, v: number) => ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
