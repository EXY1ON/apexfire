import type { Catalog, Detection, SensorKey } from './data';

export const SENSOR_LABEL: Record<SensorKey, string> = { modis: 'MODIS', 'viirs-jpss1': 'VIIRS NOAA-20', 'viirs-snpp': 'VIIRS S-NPP', 'viirs-noaa21': 'VIIRS NOAA-21' };
export const TYPE_LABEL: Record<number, string> = {
  0: 'presumed vegetation fire', 1: 'active volcano', 2: 'other static land source', 3: 'offshore / water', 9: 'not reported (near-real-time)',
};
export const VIIRS_CONF: Record<string, string> = { l: 'low', n: 'nominal', h: 'high' };

export interface Filters {
  from: string; to: string; // inclusive UTC dates YYYY-MM-DD
  sensors: SensorKey[];
  modisMin: number; // native MODIS 0-100 value
  viirs: string[]; // native VIIRS classes l/n/h
  types: number[];
}

/** Native-scale confidence and type filters; never maps MODIS numbers onto VIIRS classes. */
export function passesQuality(d: Detection, f: Filters): boolean {
  if (!f.sensors.includes(d.sensor) || !f.types.includes(d.type)) return false;
  return d.sensor === 'modis' ? (d.conf as number) >= f.modisMin : f.viirs.includes(d.conf as string);
}

export function inRange(d: Detection, from: string, to: string): boolean {
  const day = d.t.slice(0, 10);
  return day >= from && day <= to;
}

export function applyFilters(dets: Detection[], f: Filters): Detection[] {
  return dets.filter((d) => inRange(d, f.from, f.to) && passesQuality(d, f));
}

export type DayCounts = Map<string, { total: number } & Partial<Record<SensorKey, number>>>;

/** UTC calendar-day buckets. */
export function dailyCounts(dets: Detection[]): DayCounts {
  const out: DayCounts = new Map();
  for (const d of dets) {
    const day = d.t.slice(0, 10);
    const c = out.get(day) ?? { total: 0 };
    c.total += 1;
    c[d.sensor] = (c[d.sensor] ?? 0) + 1;
    out.set(day, c);
  }
  return out;
}

export type Coverage = 'covered' | 'partial' | 'none';

/** Whether the selected sensors had an archive file covering this UTC date. A covered day with zero rows
 *  means "no detections recorded in this file", not a confirmed fire-free day. */
export function dayCoverage(day: string, sensors: SensorKey[], catalog: Catalog, failed: SensorKey[] = []): { status: Coverage; missing: string[] } {
  const year = Number(day.slice(0, 4));
  const missing: string[] = [];
  for (const s of sensors) {
    if (failed.includes(s)) { missing.push(`${SENSOR_LABEL[s]}: data failed to load`); continue; }
    const hasFile = catalog.history.files.some((f) => f.sensor === s && f.year === year);
    const start = catalog.history.sensors[s].record_start;
    if (!hasFile) missing.push(`${SENSOR_LABEL[s]}: no local file for ${year}`);
    else if (start && day < start) missing.push(`${SENSOR_LABEL[s]}: before archive start ${start}`);
  }
  const status = sensors.length === 0 || missing.length === sensors.length ? 'none' : missing.length ? 'partial' : 'covered';
  return { status, missing };
}

export function yearNotes(year: number, catalog: Catalog): string[] {
  const notes: string[] = [];
  for (const s of Object.keys(catalog.history.sensors) as SensorKey[]) {
    const cov = catalog.history.coverage[s];
    const start = catalog.history.sensors[s].record_start;
    if (!cov.years.includes(year)) {
      if (!cov.years.length) notes.push(`${SENSOR_LABEL[s]}: no data downloaded yet.`);
      else if (cov.missing_internal_years.includes(year)) notes.push(`${SENSOR_LABEL[s]}: the ${year} file is missing from the archive (gap, not zero activity).`);
      else if (s === 'viirs-snpp') notes.push(`${SENSOR_LABEL[s]}: only 2024–2025 are held locally; ${year} was not downloaded.`);
      else notes.push(`${SENSOR_LABEL[s]}: no data for ${year} (record ${cov.years[0]}–${cov.years[cov.years.length - 1]}).`);
    } else if (start && start.startsWith(String(year))) {
      notes.push(`${SENSOR_LABEL[s]}: partial year, archive starts ${start}.`);
    }
  }
  return notes;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export interface ExportMeta { filters: Filters; generated: string; credit: string; transformation: string }

export function describeFilters(f: Filters): string {
  return `UTC ${f.from} to ${f.to}; sensors ${f.sensors.map((s) => SENSOR_LABEL[s]).join(', ')}; MODIS confidence >= ${f.modisMin}; `
    + `VIIRS confidence ${f.viirs.map((c) => VIIRS_CONF[c]).join('/') || 'none'}; types ${f.types.join(',')}`;
}

const CSV_COLUMNS: Record<string, string> = {
  id: 'ApexFire source-record ID: sensor-year-row in the source file',
  sensor: 'Archive family: modis, viirs-jpss1 (NOAA-20) or viirs-snpp (S-NPP)',
  satellite: 'Satellite as given in the source (Terra, Aqua, N20, N)',
  acq_utc: 'Acquisition time, UTC, from acq_date + zero-padded acq_time',
  latitude: 'Pixel centre latitude, WGS84', longitude: 'Pixel centre longitude, WGS84',
  confidence: 'Native confidence: MODIS 0-100, VIIRS l/n/h; not a probability, not comparable across sensors',
  confidence_scale: 'modis_0_100 or viirs_lnh', frp_mw: 'Fire radiative power, MW (radiant power, not area burned)',
  scan: 'Pixel size along scan, km (footprint, not burned extent)', track: 'Pixel size along track, km',
  brightness_1_k: 'MODIS channel 21/22 or VIIRS I4 brightness temperature, K (not air temperature)',
  brightness_2_k: 'MODIS channel 31 or VIIRS I5 brightness temperature, K', daynight: 'D or N pass',
  type: 'Algorithm label: 0 presumed vegetation fire, 1 volcano, 2 other static land source, 3 offshore', version: 'Raw processing version string',
  source_file: 'Original FIRMS country CSV; its SHA-256 is listed in source_files',
};

/** Data-only CSV (header row + one row per detection); provenance travels in the companion JSON from toProvenance. */
export function toCSV(dets: Detection[]): string {
  const lines = dets.map((d) => [d.id, d.sensor, d.sat, d.t, d.lat, d.lon, d.conf, d.sensor === 'modis' ? 'modis_0_100' : 'viirs_lnh', d.frp,
    d.scan, d.track, d.bt, d.bt2, d.dn, d.type, d.ver, d.file].map(csvCell).join(','));
  return [Object.keys(CSV_COLUMNS).join(','), ...lines].join('\n') + '\n';
}

export function toProvenance(dets: Detection[], meta: ExportMeta, files: { sensor: string; year: number; source_file: string; source_sha256: string }[], stem: string) {
  const used = new Set(dets.map((d) => d.file));
  const bySensor: Record<string, number> = {};
  for (const d of dets) bySensor[d.sensor] = (bySensor[d.sensor] ?? 0) + 1;
  return {
    schema: 'firewatch.export-provenance.v1', describes: [`${stem}.csv`, `${stem}.geojson`], data_class: 'satellite_detection',
    generated: meta.generated, record_count: dets.length, records_by_sensor: bySensor,
    filters: meta.filters, filters_text: describeFilters(meta.filters),
    notes: ['Satellite active-fire detections, not unique or confirmed fires.', 'Days without rows mean no detections recorded in the source files, not confirmed absence of fire.'],
    credit: meta.credit, transformation: meta.transformation, columns: CSV_COLUMNS,
    source_files: files.filter((f) => used.has(f.source_file)),
  };
}

export function toGeoJSON(dets: Detection[], meta: ExportMeta) {
  return {
    type: 'FeatureCollection',
    data_class: 'satellite_detection',
    note: 'Satellite active-fire detections; not unique or confirmed fires. Confidence is native per sensor.',
    filters: meta.filters, filters_text: describeFilters(meta.filters), generated: meta.generated, credit: meta.credit, transformation: meta.transformation,
    features: dets.map((d) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
      properties: { id: d.id, sensor: d.sensor, satellite: d.sat, acq_utc: d.t, confidence: d.conf, frp_mw: d.frp, scan: d.scan, track: d.track,
        brightness_1_k: d.bt, brightness_2_k: d.bt2, daynight: d.dn, type: d.type, version: d.ver, source_file: d.file },
    })),
  };
}
