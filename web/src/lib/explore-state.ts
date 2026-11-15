import { SENSOR_KEYS, type SensorKey } from './data';
import type { Filters } from './history';

export interface ExploreState extends Filters {
  mode: 'history' | 'current';
  year: number;
  sel: string | null; // selected detection id
  place: number | null; // GeoNames id
  view: 'map' | 'list';
  fire: string | null; // selected fire group in Now mode
  win: 24 | 48 | 168; // Now window in hours
}

export const FIRST_YEAR = 2000;
export const LAST_YEAR = 2026;
export const DEFAULT_YEAR = 2025;
export const ALL_TYPES = [0, 1, 2, 3, 9]; // 9 = not reported in near-real-time files
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(s: string | null, year: number): s is string {
  return !!s && DAY.test(s) && s.startsWith(String(year)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function parseExplore(p: URLSearchParams): ExploreState {
  const y = Number(p.get('year'));
  const year = Number.isInteger(y) && y >= FIRST_YEAR && y <= LAST_YEAR ? y : DEFAULT_YEAR;
  let from = p.get('from'); let to = p.get('to');
  if (!validDay(from, year)) from = `${year}-01-01`;
  if (!validDay(to, year)) to = `${year}-12-31`;
  if (from > to) [from, to] = [to, from];
  const sensors = (p.get('s')?.split(',').filter((s): s is SensorKey => SENSOR_KEYS.includes(s as SensorKey))) ?? SENSOR_KEYS;
  const mc = Number(p.get('mc'));
  const viirs = p.get('vc')?.split(',').filter((c) => ['l', 'n', 'h'].includes(c)) ?? ['l', 'n', 'h'];
  const types = p.get('ty')?.split(',').map(Number).filter((t) => ALL_TYPES.includes(t)) ?? ALL_TYPES;
  const place = Number(p.get('place'));
  return {
    mode: p.get('mode') === 'history' ? 'history' : 'current', // the map opens on fires now
    year, from, to,
    sensors: p.has('s') ? sensors : SENSOR_KEYS,
    modisMin: Number.isInteger(mc) && mc >= 0 && mc <= 100 ? mc : 0,
    viirs: p.has('vc') ? viirs : ['l', 'n', 'h'],
    types: p.has('ty') ? types : ALL_TYPES,
    sel: p.get('sel'),
    place: Number.isInteger(place) && place > 0 ? place : null,
    view: p.get('view') === 'list' ? 'list' : 'map',
    fire: p.get('fire'),
    win: p.get('win') === '24' ? 24 : p.get('win') === '168' ? 168 : 48,
  };
}

/** Only non-default values are written, so shared links stay short and stable. */
export function serializeExplore(s: ExploreState): string {
  const p = new URLSearchParams();
  if (s.mode === 'history') p.set('mode', 'history');
  if (s.year !== DEFAULT_YEAR) p.set('year', String(s.year));
  if (s.from !== `${s.year}-01-01`) p.set('from', s.from);
  if (s.to !== `${s.year}-12-31`) p.set('to', s.to);
  if (s.sensors.length !== SENSOR_KEYS.length) p.set('s', s.sensors.join(','));
  if (s.modisMin) p.set('mc', String(s.modisMin));
  if (s.viirs.length !== 3) p.set('vc', s.viirs.join(','));
  if (s.types.length !== ALL_TYPES.length) p.set('ty', s.types.join(','));
  if (s.sel) p.set('sel', s.sel);
  if (s.place) p.set('place', String(s.place));
  if (s.view === 'list') p.set('view', 'list');
  if (s.fire) p.set('fire', s.fire);
  if (s.win !== 48) p.set('win', String(s.win));
  const q = p.toString();
  return q ? `?${q}` : '';
}
