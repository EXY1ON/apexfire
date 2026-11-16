import { describe, expect, it } from 'vitest';
import { archiveBurnedYear, burnedFor, monthlyAverage, ratioText, tableCSV, toShares, validateLandscape, type Starts } from './landscape';

const ones = (r: number, c: number) => Array.from({ length: r }, () => Array<number>(c).fill(1));
function per<T>(f: (years: [number, number]) => T) {
  return { 'viirs-snpp': f([2012, 2025]), modis: f([2001, 2025]), 'viirs-jpss1': f([2018, 2025]) };
}
function fixture(): Record<string, unknown> {
  const cls = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `Class ${i}`, color: '#000000', codes: [] }));
  const v8 = Array<number>(8).fill(1); const v7 = Array<number>(7).fill(1);
  return {
    schema: 'firewatch.landscape.v1', generated_utc: '2026-11-17T00:00:00+00:00', export_date: '2026-11-17',
    groups: cls(8), fields: cls(7), raw_fields: cls(9), editions: [2000, 2006, 2012, 2018], land: {},
    starts: per((years) => ({ years, gap_hours: 24, total: 1, total_48h: 1, unclassified: 0, duration: {},
      by_year_month_group: Array.from({ length: years[1] - years[0] + 1 }, () => ones(12, 8)) })),
    activity: per((years) => ({ years, detections: 1, by_month_group: ones(12, 8) })),
    nasa: { product: 'x', years: [2001, 2025], by_year_group: ones(25, 8), pixel_ha: 21.466, months: 300 },
    effis: { years: [2016, 2026], to_date: '2026-11-17', all: { by_year_field: ones(11, 7), fires: [] }, ge30: { by_year_field: ones(11, 7), fires: [] },
      cross_check: [], spread: {}, field_check: {} },
    shares: { catches: per(() => v8), catches_land: per(() => v8), rates: per(() => v8),
      consumes_nasa: v8, consumes_nasa_land: v8, consumes_effis: v7, consumes_effis_land: v7 },
    takeaways: [{ id: 'starts', text: 'a', values: {} }, { id: 'farm_peak', text: 'b', values: {} }, { id: 'burned', text: 'c', values: {} }],
    image: { path: 'landscape/landcover-mk.png', corners: [[0, 1], [1, 1], [1, 0], [0, 0]], edition: 2018 }, credits: ['credit'],
  };
}

describe('landscape document', () => {
  it('accepts a well-formed document', () => {
    expect(validateLandscape(fixture(), 'x').groups).toHaveLength(8);
  });
  it('rejects a NASA series that does not cover its years', () => {
    const d = fixture(); (d.nasa as { by_year_group: number[][] }).by_year_group.pop();
    expect(() => validateLandscape(d, 'x')).toThrow(/NASA burned area has the wrong shape/);
  });
  it('rejects a missing sensor', () => {
    const d = fixture(); delete (d.starts as Record<string, unknown>).modis;
    expect(() => validateLandscape(d, 'x')).toThrow(/missing modis/);
  });
});

describe('landscape helpers', () => {
  it('averages fire starts per month over the years', () => {
    const y1 = ones(12, 8).map((r) => r.map(() => 0)); const y2 = ones(12, 8).map((r) => r.map(() => 0));
    y1[0][0] = 2; y2[0][0] = 4;
    expect(monthlyAverage({ years: [2024, 2025], by_year_month_group: [y1, y2] } as unknown as Starts)[0][0]).toBe(3);
  });
  it('turns rows into shares and labels ratios', () => {
    expect(toShares([[1, 3], [0, 0]])).toEqual([[0.25, 0.75], [0, 0]]);
    expect([0.42, 1, 3.24, 12.6].map(ratioText)).toEqual(['0.4×', '1.0×', '3.2×', '13×']);
  });
  it('filters burned areas by year and follows the Archive rule', () => {
    const fc = { type: 'FeatureCollection', features: [2016, 2019, 2019].map((year) => ({ type: 'Feature', properties: { year }, geometry: { type: 'Point', coordinates: [0, 0] } })) } as GeoJSON.FeatureCollection;
    expect(burnedFor(fc, 2019).features).toHaveLength(2);
    expect(burnedFor(fc, 'all').features).toHaveLength(3);
    expect([2015, 2016].map((y) => archiveBurnedYear(y))).toEqual([null, 2016]);
  });
  it('writes a chart table as CSV with its credit', () => {
    expect(tableCSV(['Year', 'Land, type'], [[2024, 'a"b']], 'EFFIS, CC BY 4.0')).toBe('Year,"Land, type"\n2024,"a""b"\n\n"EFFIS, CC BY 4.0"\n');
  });
});
