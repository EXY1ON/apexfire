import { describe, expect, it } from 'vitest';
import { fwiClass, fwiSeries } from './fwi';

describe('Fire Weather Index', () => {
  it('matches the standard reference day (Van Wagner and Pickett 1985 test data)', () => {
    const [d] = fwiSeries([{ t: 17, rh: 42, wind: 25, rain: 0, month: 4 }]);
    expect(d.ffmc).toBeCloseTo(87.69, 1);
    expect(d.dmc).toBeCloseTo(8.54, 1);
    expect(d.dc).toBeCloseTo(19.01, 1);
    expect(d.isi).toBeCloseTo(10.85, 1);
    expect(d.bui).toBeCloseTo(8.49, 1);
    expect(d.fwi).toBeCloseTo(10.10, 1);
  });
  it('rain lowers the moisture codes and classes follow EFFIS bands', () => {
    const [dry, wet] = fwiSeries([{ t: 30, rh: 20, wind: 20, rain: 0, month: 8 }, { t: 20, rh: 80, wind: 5, rain: 15, month: 8 }]);
    expect(wet.ffmc).toBeLessThan(dry.ffmc);
    expect(wet.dmc).toBeLessThan(dry.dmc);
    expect([fwiClass(3).label, fwiClass(5.2).label, fwiClass(25).label, fwiClass(60).label]).toEqual(['Very low', 'Low', 'High', 'Extreme']);
  });
});

import { bearingSpread, offset, wedge } from './geo';
describe('wind wedge geometry', () => {
  it('points the sector the right way and measures direction spread', () => {
    const [lon, lat] = offset(41, 21, 90, 10);
    expect(lat).toBeCloseTo(41, 5);
    expect(lon).toBeGreaterThan(21.1);
    const ring = wedge(41, 21, 180, 20, 5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring[5][1]).toBeLessThan(41); // middle of the arc lies south
    const s = bearingSpread([350, 10, 0]);
    expect(Math.min(s.mean, 360 - s.mean)).toBeLessThan(1);
    expect(s.spread).toBeCloseTo(10, 0);
  });
});
