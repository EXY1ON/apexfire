import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DataError, fetchJSON, validateCatalog, validatePartition, type Catalog, type Detection } from './data';
import { applyFilters, dailyCounts, dayCoverage, toCSV, toGeoJSON, toProvenance, yearNotes, type Filters } from './history';
import { parseExplore, serializeExplore } from './explore-state';
import { classifySource } from './source-status';
import { pointInGeometry } from './geo';
import { searchPlaces, validatePlaces } from '../components/PlaceSearch';
import { nearestHour, nearestWindPoint, validateWind } from '../pages/Now';

const DATA = new URL('../../public/data/', import.meta.url).pathname;
const read = (p: string) => JSON.parse(readFileSync(DATA + p, 'utf8'));
const hasData = existsSync(DATA + 'catalog.json');
const all: Filters = { from: '2024-01-01', to: '2024-12-31', sensors: ['modis', 'viirs-jpss1', 'viirs-snpp', 'viirs-noaa21'], modisMin: 0, viirs: ['l', 'n', 'h'], types: [0, 1, 2, 3, 9] };

const det = (o: Partial<Detection>): Detection => ({ id: 'x', sensor: 'modis', t: '2024-09-04T01:03Z', lat: 41.3, lon: 21.6, conf: 50, frp: 1, scan: 1, track: 1,
  bt: 300, bt2: 290, dn: 'D', type: 0, sat: 'Aqua', ver: '61.03', file: 'f.csv', ...o });

describe('fetch validation', () => {
  const res = (body: string, type = 'application/json', status = 200) => async () => new Response(body, { status, headers: { 'content-type': type } });
  it('rejects HTML fallbacks, empty bodies, bad JSON and HTTP errors', async () => {
    await expect(fetchJSON('x.json', res('<!doctype html>', 'text/html'))).rejects.toThrow(/HTML/);
    await expect(fetchJSON('x.json', res(''))).rejects.toThrow(/empty/);
    await expect(fetchJSON('x.json', res('{oops'))).rejects.toThrow(/not valid JSON/);
    await expect(fetchJSON('x.json', res('{}', 'application/json', 404))).rejects.toThrow(/HTTP 404/);
    await expect(fetchJSON('x.json', async () => { throw new TypeError('net'); })).rejects.toBeInstanceOf(DataError);
  });
  it('rejects a partition with a wrong row count or invalid confidence', () => {
    const base = { schema: 'firewatch.history.v1', sensor: 'viirs-jpss1', confidence_scale: 'viirs_lnh', source_file: 'f', records: 1,
      columns: ['id', 't', 'lat', 'lon', 'conf', 'frp', 'scan', 'track', 'bt', 'bt2', 'dn', 'type', 'sat', 'ver'] };
    const row = ['N20-2024-00001', '2024-01-05T11:47Z', 40.9, 21.5, 'n', 3.4, 0.5, 0.4, 332, 267, 'D', 0, 'N20', '2'];
    expect(validatePartition({ ...base, rows: [row] }, 'p')).toHaveLength(1);
    expect(() => validatePartition({ ...base, rows: [row, row] }, 'p')).toThrow(/row count/);
    expect(() => validatePartition({ ...base, rows: [[...row.slice(0, 4), 55, ...row.slice(5)]] }, 'p')).toThrow(/invalid row/);
    expect(() => validatePartition({ ...base, rows: [[row[0], '2024-01-05 11:47', ...row.slice(2)]] }, 'p')).toThrow(/invalid row/);
  });
});

describe('filters and buckets', () => {
  const dets = [det({ id: 'a', conf: 20 }), det({ id: 'b', conf: 90, t: '2024-09-05T23:59Z' }), det({ id: 'c', sensor: 'viirs-jpss1', conf: 'l', type: 2 }),
    det({ id: 'd', sensor: 'viirs-snpp', conf: 'h', t: '2024-09-06T00:00Z' })];
  it('filters MODIS and VIIRS confidence on native scales separately', () => {
    expect(applyFilters(dets, { ...all, modisMin: 80 }).map((d) => d.id)).toEqual(['b', 'c', 'd']);
    expect(applyFilters(dets, { ...all, viirs: ['h'] }).map((d) => d.id)).toEqual(['a', 'b', 'd']);
    expect(applyFilters(dets, { ...all, types: [0] }).map((d) => d.id)).toEqual(['a', 'b', 'd']);
    expect(applyFilters(dets, { ...all, from: '2024-09-05', to: '2024-09-05' }).map((d) => d.id)).toEqual(['b']);
  });
  it('buckets by UTC day at the midnight boundary', () => {
    const c = dailyCounts(dets);
    expect(c.get('2024-09-05')?.total).toBe(1);
    expect(c.get('2024-09-06')?.['viirs-snpp']).toBe(1);
    expect(c.get('2024-09-04')).toEqual({ total: 2, modis: 1, 'viirs-jpss1': 1 });
  });
  it('exports the same records with provenance', () => {
    const meta = { filters: all, generated: '2026-11-14T00:00:00Z', credit: 'NASA FIRMS', transformation: 't1' };
    const csv = toCSV(dets).trimEnd().split('\n');
    expect(csv[0].startsWith('id,sensor,satellite,acq_utc')).toBe(true);
    expect(csv).toHaveLength(dets.length + 1);
    expect(csv.every((l) => l.split(',').length === 17)).toBe(true);
    const prov = toProvenance(dets, meta, [{ sensor: 'modis', year: 2024, source_file: 'f.csv', source_sha256: 'abc' }, { sensor: 'modis', year: 2023, source_file: 'g.csv', source_sha256: 'def' }], 'stem');
    expect([prov.record_count, prov.source_files.length, prov.describes[0]]).toEqual([4, 1, 'stem.csv']);
    expect(Object.keys(prov.columns)).toEqual(csv[0].split(','));
    expect(toGeoJSON(dets, meta).features.map((f) => f.properties.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('URL state', () => {
  it('round-trips a shared view and rejects out-of-year dates', () => {
    const s = parseExplore(new URLSearchParams('year=2017&from=2017-07-30&to=2017-08-15&s=modis,viirs-jpss1&mc=30&vc=n,h&ty=0,2&sel=MOD-2017-00001'));
    expect(parseExplore(new URLSearchParams(serializeExplore(s)))).toEqual(s);
    const bad = parseExplore(new URLSearchParams('year=2017&from=2018-01-01&to=nope'));
    expect([bad.from, bad.to]).toEqual(['2017-01-01', '2017-12-31']);
    expect(parseExplore(new URLSearchParams('year=1990')).year).toBe(2025);
  });
});

describe('source status', () => {
  it('keeps samples, empty results, stale caches and failures distinct', () => {
    expect(classifySource({ delivery: 'saved_sample', count: 3 })).toBe('sample');
    expect(classifySource({ delivery: 'saved_sample', count: 0 })).toBe('sample-empty');
    expect(classifySource({ delivery: 'connected', count: 0, lastSuccessUtc: '2026-11-14T10:00:00Z', staleAfterMs: 1800e3, now: Date.parse('2026-11-14T10:10:00Z') })).toBe('empty');
    expect(classifySource({ delivery: 'connected', count: 5, lastSuccessUtc: '2026-11-14T10:00:00Z', staleAfterMs: 1800e3, now: Date.parse('2026-11-14T11:00:00Z') })).toBe('stale');
    expect(classifySource({ delivery: 'connected', error: 'HTTP 500', online: true })).toBe('error');
    expect(classifySource({ delivery: 'saved_sample', error: 'network', online: false })).toBe('offline');
  });
});

describe('geometry', () => {
  it('respects polygon holes', () => {
    const g: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
    expect(pointInGeometry(1, 1, g)).toBe(true);
    expect(pointInGeometry(5, 5, g)).toBe(false);
    expect(pointInGeometry(11, 5, g)).toBe(false);
  });
});

describe.runIf(hasData)('generated public data', () => {
  const catalog = validateCatalog(read('catalog.json'), 'catalog.json') as Catalog;
  it('keeps the 47,046-row archive intact and adds API gap years separately', () => {
    const archive = catalog.history.files.filter((f) => (f as { origin?: string }).origin === 'archive');
    expect(archive).toHaveLength(35);
    const sum = (s: string) => archive.filter((f) => f.sensor === s).reduce((n, f) => n + f.records, 0);
    expect([sum('modis'), sum('viirs-jpss1'), sum('viirs-snpp')]).toEqual([17700, 22602, 6744]);
    const api = catalog.history.files.filter((f) => (f as { origin?: string }).origin === 'firms_api');
    expect(api.every((f) => !archive.some((a) => a.sensor === f.sensor && a.year === f.year))).toBe(true);
    expect(catalog.history.records).toBe(47046 + api.reduce((n, f) => n + f.records, 0));
  });
  it('every partition validates, ids are unique and match catalog counts', () => {
    const ids = new Set<string>();
    for (const f of catalog.history.files) {
      const dets = validatePartition(read(f.data), f.data);
      expect(dets).toHaveLength(f.records);
      dets.forEach((d) => ids.add(d.id));
    }
    expect(ids.size).toBe(catalog.history.records);
  });
  it('calendar coverage distinguishes no-file, pre-record and covered days', () => {
    expect(dayCoverage('2013-06-01', ['modis'], catalog).status).toBe(catalog.history.files.some((f) => f.sensor === 'modis' && f.year === 2013) ? 'covered' : 'none');
    expect(dayCoverage('2018-03-31', ['viirs-jpss1'], catalog).status).toBe('none');
    expect(dayCoverage('2018-04-01', ['viirs-jpss1'], catalog).status).toBe('covered');
    expect(dayCoverage('2018-03-31', ['modis', 'viirs-jpss1'], catalog).status).toBe('partial');
    expect(dayCoverage('2000-10-31', ['modis'], catalog).status).toBe('none');
    expect(dayCoverage('2024-06-01', ['modis', 'viirs-snpp'], catalog, ['viirs-snpp'])).toEqual({ status: 'partial', missing: ['VIIRS S-NPP: data failed to load'] });
  });
  it('a known period agrees between filter, calendar and export: NOAA-20 4 Sep 2024', () => {
    const dets = validatePartition(read('history/viirs-jpss1-2024.json'), 'p');
    const f = { ...all, from: '2024-09-04', to: '2024-09-04', sensors: ['viirs-jpss1'] as Filters['sensors'] };
    const shown = applyFilters(dets, f);
    expect(dailyCounts(dets).get('2024-09-04')?.total).toBe(shown.length);
    expect(toGeoJSON(shown, { filters: f, generated: '', credit: '', transformation: '' }).features).toHaveLength(shown.length);
    expect(shown.length).toBeGreaterThan(0);
  });
  it('story, scenario and source contracts hold', () => {
    const b = read('stories/brvenica-2017.json');
    expect([b.frames.length, b.missing.length]).toEqual([8, 15]);
    expect(b.frames[7].properties['BA (ha)']).toBe(5363.15);
    expect(b.official.identity.AREA_HA).toBe('5197');
    const s = read('spread/mariovo-scenario.json');
    expect(s.perimeters.features.map((x: { properties: { burned_area_ha: number } }) => x.properties.burned_area_ha)).toEqual([2, 4, 11, 17]);
    expect(s.calibrated).toBe(false);
    expect(s.arrival_cells.features).toHaveLength(17);
    const m = read('stories/mariovo-2024.json');
    expect(m.reference.status).toBe('unconfirmed_secondary_geometry');
    expect(m.inside_reference_detection_check).toMatchObject({ modis: 16, 'viirs-jpss1': 259, 'viirs-snpp': 263 }); // NOAA-21 added later, reported separately
    const e = read('current/effis-season.json');
    const last = [...e.cumulative].reverse().find((r: { area_ha: number | null }) => r.area_ha !== null);
    expect([last.area_ha, last.events, last.mddate]).toEqual([25323, 69, '20261111']);
    expect(e.cumulative.at(-1).area_ha).toBeNull();
    const c = read('current/cams-sample.json');
    expect([c.hourly.time.length, c.units.european_aqi, c.units.pm2_5]).toEqual([48, 'EAQI', 'μg/m³']);
    const firms = read('current/firms-sample.json');
    expect(firms.delivery).toBe('saved_sample');
    expect(firms.sources.map((x: { detections: unknown[] }) => x.detections.length)).toEqual([3, 1]);
    expect(JSON.stringify(firms)).not.toMatch(/api\/area\/csv\/[A-Fa-f0-9]{32}/);
  });
  it('wind grid validates, and hour/point lookups pick the nearest', () => {
    const w = validateWind(read('current/wind-grid.json'), 'wind');
    expect([w.points.length, w.times.length]).toEqual([77, 48]);
    expect(nearestHour(w.times, Date.parse(w.times[5]) + 20 * 60e3)).toBe(5);
    expect(nearestHour(w.times, Date.parse('2030-01-01T00:00Z'))).toBe(47);
    expect(nearestHour(w.times, Date.parse('2020-01-01T00:00Z'))).toBe(0);
    const skopje = nearestWindPoint(w, 41.9981, 21.4254);
    expect(skopje.km).toBeLessThan(20);
    const bad = read('current/wind-grid.json');
    bad.points[3].speed = bad.points[3].speed.slice(1);
    expect(() => validateWind(bad, 'wind')).toThrow(/time axis/);
  });
  it('place search finds Latin and Cyrillic names', () => {
    const places = validatePlaces(read('places.json'), 'places.json');
    expect(places).toHaveLength(2773);
    expect(searchPlaces(places, 'Prilep')[0].name).toBe('Prilep');
    expect(searchPlaces(places, 'Прилеп')[0].name).toBe('Prilep');
  });
});

describe('wind field', () => {
  // 2 x 2 grid: north wind (from 0°) at 4 m/s on the south row, west wind (from 270°) at 2 m/s on the north row.
  const pts = [[41, 21, 4, 0], [41, 21.25, 4, 0], [41.25, 21, 2, 270], [41.25, 21.25, 2, 270]]
    .map(([lat, lon, s, d]) => ({ requested: [lat, lon] as [number, number], speed: [s], dir: [d] }));
  it('converts "from" directions to u/v and interpolates bilinearly without extrapolating', async () => {
    const { buildField, sampleField } = await import('./wind-field');
    const f = buildField(pts, 0)!;
    const [u0, v0] = sampleField(f, 21, 41)!;
    expect(u0).toBeCloseTo(0); expect(v0).toBeCloseTo(-4); // blowing towards the south
    const [u1, v1] = sampleField(f, 21.25, 41.25)!;
    expect(u1).toBeCloseTo(2); expect(v1).toBeCloseTo(0); // blowing towards the east
    const [um, vm] = sampleField(f, 21.125, 41.125)!;
    expect(um).toBeCloseTo(1); expect(vm).toBeCloseTo(-2);
    expect(sampleField(f, 20.99, 41.1)).toBeNull();
    expect(buildField(pts.slice(1), 0)).toBeNull();
  });
  it.skipIf(!hasData)('the saved grid forms a full regular grid', async () => {
    const { buildField } = await import('./wind-field');
    const g = validateWind(read('current/wind-grid.json'), 'wind');
    expect(buildField(g.points, 0)?.nLat).toBe(7);
  });
  it('handles different lat and lon spacing (MERRA-2 0.5 x 0.625 deg) and rejects gaps', async () => {
    const { fieldFromComponents, sampleField } = await import('./wind-field');
    const f = fieldFromComponents([41, 41.5], [21.25, 21.875], [0, 2, 0, 2], [-4, -4, 0, 0])!;
    const [u, v] = sampleField(f, 21.5625, 41.25)!; // centre of the cell
    expect(u).toBeCloseTo(1); expect(v).toBeCloseTo(-2);
    expect(sampleField(f, 21.9, 41.25)).toBeNull();
    expect(fieldFromComponents([41, 41.5], [21.25, 21.875], [0, null, 0, 2], [0, 0, 0, 0])).toBeNull();
  });
});

describe('archive weather', () => {
  it('indexes days, averages over nodes skipping gaps, and turns u/v into a "from" direction', async () => {
    const { dayIndex, dayOf, meanAt, fromDir } = await import('./weather-history');
    const w = { start: '2024-01-01', days: 366, scale: 10, tmax: [[100, 200], [300, null]] } as never;
    expect(dayIndex(w, '2024-03-01')).toBe(60); // leap year
    expect(dayOf(w, 365)).toBe('2024-12-31');
    expect(meanAt(w, 'tmax', 0, [0, 1])).toBeCloseTo(20); // (10 + 30) / 2 °C
    expect(meanAt(w, 'tmax', 1, [1])).toBeNull();
    expect(fromDir(0, -4)).toBeCloseTo(0); // blowing south = from the north
    expect(fromDir(3, 0)).toBeCloseTo(270); // blowing east = from the west
  });
  it.skipIf(!hasData)('every exported year validates and its day-15 Aug field is complete', async () => {
    const { validateWeatherYear, dayField, dayIndex } = await import('./weather-history');
    for (const y of [2000, 2017, 2025]) {
      const w = validateWeatherYear(read(`weather/weather-${y}.json`), `weather ${y}`);
      expect(w.lats.length * w.lons.length).toBe(30);
      expect(dayField(w, dayIndex(w, `${y}-08-15`))?.nLon).toBe(6);
    }
  });
});
