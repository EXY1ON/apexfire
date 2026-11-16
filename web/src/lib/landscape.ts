// What burns in North Macedonia (/landscape): types, validation and helpers for landscape/what-burns.json,
// built by tools/landscape.py. Arrays follow the order of `groups` (8) or `fields` (7).
import { fail, validateDoc } from './data';
import { csvCell } from './history';

export const START_SENSORS = ['viirs-snpp', 'modis', 'viirs-jpss1'] as const;
export type StartSensor = (typeof START_SENSORS)[number];
export const EFFIS_FIRST_YEAR = 2016;

export interface LcClass { id: string; label: string; color: string; codes: string[] }
export interface Starts {
  years: [number, number]; gap_hours: number; total: number; total_48h: number; unclassified: number;
  by_year_month_group: number[][][]; duration: Record<string, { n: number; median_days: number; p90_days: number }>;
}
export interface Activity { years: [number, number]; detections: number; by_month_group: number[][] }
export interface EffisSeries { by_year_field: number[][]; fires: number[]; unshared_ha?: number[] }
export interface LandscapeDoc {
  schema: 'firewatch.landscape.v1'; generated_utc: string; export_date: string;
  groups: LcClass[]; fields: LcClass[]; raw_fields: { id: string; label: string }[]; editions: number[];
  land: Record<string, { area_km2: number; groups: number[]; fields: number[]; codes: Record<string, number> }>;
  starts: Record<StartSensor, Starts>; activity: Record<StartSensor, Activity>;
  nasa: { product: string; years: [number, number]; by_year_group: number[][]; pixel_ha: number; months: number };
  effis: {
    years: [number, number]; to_date: string; all: EffisSeries; ge30: EffisSeries;
    cross_check: { year: number; fires: number; ha: number; estimate_fires: number | null; estimate_ha: number | null }[];
    spread: Record<string, { n: number; median_ha: number; p90_ha: number; max_ha: number }>; field_check: Record<string, [number, number]>;
  };
  shares: {
    catches: Record<StartSensor, number[]>; catches_land: Record<StartSensor, number[]>; rates: Record<StartSensor, number[]>;
    consumes_nasa: number[]; consumes_nasa_land: number[]; consumes_effis: number[]; consumes_effis_land: number[];
  };
  takeaways: { id: 'starts' | 'farm_peak' | 'burned'; text: string; values: Record<string, number | string> }[];
  image: { path: string; corners: [number, number][]; edition: number };
  credits: string[];
}

const span = ([a, b]: [number, number]) => b - a + 1;
export const yearsOf = ([a, b]: [number, number]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Shape checks for every array the page draws; a mismatch is an error, never a partly drawn chart. */
export function validateLandscape(raw: unknown, path: string): LandscapeDoc {
  const d = validateDoc<LandscapeDoc>('firewatch.landscape.v1', ['groups', 'fields', 'raw_fields', 'starts', 'activity', 'nasa', 'effis', 'shares', 'takeaways', 'image', 'credits'])(raw, path);
  const G = d.groups.length; const F = d.fields.length;
  if (G !== 8 || F !== 7 || d.raw_fields.length !== 9) fail(path, 'expected 8 land-cover groups, 7 charted and 9 raw EFFIS fields');
  const matrix = (m: unknown, rows: number, cols: number, what: string) => {
    if (!Array.isArray(m) || m.length !== rows || m.some((r) => !Array.isArray(r) || r.length !== cols || r.some((v) => !Number.isFinite(v)))) fail(path, `${what} has the wrong shape`);
  };
  const vector = (v: unknown, n: number, what: string) => matrix([v], 1, n, what);
  for (const s of START_SENSORS) {
    const st = d.starts[s]; const act = d.activity[s];
    if (!st || !act) fail(path, `missing ${s}`);
    if (!Array.isArray(st.by_year_month_group) || st.by_year_month_group.length !== span(st.years)) fail(path, `${s} fire starts do not cover ${st.years.join('–')}`);
    st.by_year_month_group.forEach((y) => matrix(y, 12, G, `${s} fire starts`));
    matrix(act.by_month_group, 12, G, `${s} activity`);
    for (const k of ['catches', 'catches_land', 'rates'] as const) vector(d.shares[k]?.[s], G, `${s} ${k}`);
  }
  matrix(d.nasa.by_year_group, span(d.nasa.years), G, 'NASA burned area');
  matrix(d.effis.ge30.by_year_field, span(d.effis.years), F, 'EFFIS burned area (30 ha and up)');
  matrix(d.effis.all.by_year_field, span(d.effis.years), F, 'EFFIS burned area');
  vector(d.shares.consumes_nasa, G, 'NASA consumes'); vector(d.shares.consumes_nasa_land, G, 'NASA land shares');
  vector(d.shares.consumes_effis, F, 'EFFIS consumes'); vector(d.shares.consumes_effis_land, F, 'EFFIS land shares');
  if (!Array.isArray(d.takeaways) || d.takeaways.length !== 3) fail(path, 'expected three takeaways');
  if (!Array.isArray(d.image.corners) || d.image.corners.length !== 4) fail(path, 'image corners malformed');
  return d;
}

/** Average fire starts per calendar month over the sensor's years: 12 rows of one value per group. */
export function monthlyAverage(st: Starts): number[][] {
  const n = st.by_year_month_group.length;
  return Array.from({ length: 12 }, (_, m) => st.by_year_month_group[0][m].map((_, g) => st.by_year_month_group.reduce((s, y) => s + y[m][g], 0) / n));
}
/** Each row scaled to sum to 1; empty rows stay 0. */
export const toShares = (rows: number[][]) => rows.map((r) => { const t = r.reduce((a, b) => a + b, 0); return r.map((v) => (t ? v / t : 0)); });
/** "3.2×", "0.4×"; 1× means in proportion to the land (D10). */
export const ratioText = (r: number) => `${r >= 10 ? Math.round(r) : r.toFixed(1)}×`;
/** Burned areas of one year, or all of them (D21). */
export const burnedFor = (fc: GeoJSON.FeatureCollection, year: number | 'all'): GeoJSON.FeatureCollection =>
  (year === 'all' ? fc : { ...fc, features: fc.features.filter((f) => f.properties?.year === year) });
/** Archive rule (D22): EFFIS mapping starts in 2016, so earlier years have no burned-area layer. */
export const archiveBurnedYear = (year: number) => (year < EFFIS_FIRST_YEAR ? null : year);
/** One chart table as CSV, with the credit after a blank line (D23). */
export const tableCSV = (header: string[], rows: (string | number)[][], credit: string) =>
  `${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')}\n\n${csvCell(credit)}\n`;
