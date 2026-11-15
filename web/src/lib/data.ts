// Fetch and validate generated public data. HTTP 200 alone is not success: HTML fallbacks,
// malformed JSON and schema mismatches are reported as errors, never rendered as data.

export type SensorKey = 'modis' | 'viirs-jpss1' | 'viirs-snpp' | 'viirs-noaa21';
export const SENSOR_KEYS: SensorKey[] = ['modis', 'viirs-snpp', 'viirs-jpss1', 'viirs-noaa21'];

export const HISTORY_COLUMNS = ['id', 't', 'lat', 'lon', 'conf', 'frp', 'scan', 'track', 'bt', 'bt2', 'dn', 'type', 'sat', 'ver'] as const;
type Row = [string, string, number, number, number | string, number, number, number, number, number, 'D' | 'N', number, string, string];

export interface Detection {
  id: string; sensor: SensorKey; t: string; lat: number; lon: number; conf: number | string; frp: number;
  scan: number; track: number; bt: number; bt2: number; dn: 'D' | 'N'; type: number; sat: string; ver: string; file: string;
}

export interface CatalogFile {
  sensor: SensorKey; year: number; data: string; source_file: string; source_sha256: string; records: number;
  date_min: string | null; date_max: string | null; monthly: Record<string, number>; types: Record<string, number>;
  versions: Record<string, number>; satellites: Record<string, number>;
}
export interface SensorInfo { label: string; instrument: string; confidence_scale: 'modis_0_100' | 'viirs_lnh'; record_start: string | null }
export interface Catalog {
  schema: 'firewatch.catalog.v1'; generated_utc: string; transformation_version: string; credit: string;
  history: { sensors: Record<SensorKey, SensorInfo>; records: number; files: CatalogFile[]; source_selection: string; quality_policy: string;
    coverage: Record<SensorKey, { years: number[]; missing_internal_years: number[] }> };
  weather?: { years: number[]; provider: string; source: string; credit: string; note: string; grid: { lats: number[]; lons: number[] } } | null;
  places: number; files: { path: string; bytes: number; sha256: string }[];
}

export class DataError extends Error {}

const cache = new Map<string, Promise<unknown>>();

export function fail(path: string, why: string): never {
  throw new DataError(`${path}: ${why}`);
}

export async function fetchJSON(path: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetcher(`/data/${path}`);
  } catch {
    throw new DataError(`${path}: network request failed${typeof navigator !== 'undefined' && !navigator.onLine ? ' (browser reports offline)' : ''}`);
  }
  if (!res.ok) fail(path, `HTTP ${res.status}`);
  if ((res.headers.get('content-type') ?? '').includes('text/html')) fail(path, 'received an HTML page instead of data');
  const text = await res.text();
  if (!text.trim()) fail(path, 'empty response');
  try {
    return JSON.parse(text);
  } catch {
    return fail(path, 'response is not valid JSON');
  }
}

/** Load once per path; failed loads are evicted so a later attempt can retry. */
export function load<T>(path: string, validate: (raw: unknown, path: string) => T): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetchJSON(path).then((raw) => validate(raw, path));
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const UTC_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;

export function expectSchema(raw: unknown, path: string, schema: string): Record<string, unknown> {
  if (!isObj(raw) || raw.schema !== schema) fail(path, `expected schema ${schema}`);
  return raw;
}

export function validateCatalog(raw: unknown, path: string): Catalog {
  const c = expectSchema(raw, path, 'firewatch.catalog.v1') as unknown as Catalog;
  if (!isObj(c.history) || !Array.isArray(c.history.files) || !finite(c.history.records)) fail(path, 'history section malformed');
  const sum = c.history.files.reduce((n, f) => n + f.records, 0);
  if (sum !== c.history.records) fail(path, `file records (${sum}) do not add up to catalog total (${c.history.records})`);
  return c;
}

export function validatePartition(raw: unknown, path: string): Detection[] {
  const p = expectSchema(raw, path, 'firewatch.history.v1');
  const sensor = p.sensor as SensorKey;
  if (!SENSOR_KEYS.includes(sensor)) fail(path, 'unknown sensor');
  if (JSON.stringify(p.columns) !== JSON.stringify(HISTORY_COLUMNS)) fail(path, 'unexpected columns');
  const rows = p.rows as Row[];
  if (!Array.isArray(rows) || rows.length !== p.records) fail(path, 'row count does not match records');
  const modis = p.confidence_scale === 'modis_0_100';
  const file = String(p.source_file);
  return rows.map((r) => {
    const [id, t, lat, lon, conf, frp, scan, track, bt, bt2, dn, type, sat, ver] = r;
    if (r.length !== 14 || typeof id !== 'string' || !UTC_MINUTE.test(t) || !finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180
      || !finite(frp) || (modis ? !finite(conf) : !['l', 'n', 'h'].includes(conf as string)) || (dn !== 'D' && dn !== 'N') || ![0, 1, 2, 3, 9].includes(type)) {
      fail(path, `invalid row ${String(id)}`);
    }
    return { id, sensor, t, lat, lon, conf, frp, scan, track, bt, bt2, dn, type, sat, ver, file };
  });
}

/** Light structural check for single-document payloads; field meaning is checked where it is used. */
export function validateDoc<T>(schema: string, required: string[]) {
  return (raw: unknown, path: string): T => {
    const d = expectSchema(raw, path, schema);
    for (const k of required) if (!(k in d)) fail(path, `missing ${k}`);
    return d as T;
  };
}

export function validateGeoJSON(raw: unknown, path: string): GeoJSON.FeatureCollection {
  if (!isObj(raw) || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features) || raw.features.length === 0) fail(path, 'expected a non-empty FeatureCollection');
  return raw as unknown as GeoJSON.FeatureCollection;
}
