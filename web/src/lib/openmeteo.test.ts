import { afterEach, describe, expect, it, vi } from 'vitest';
import { eaqiBand, fetchAirQuality } from './openmeteo';

const body = (units = 'EAQI') => ({
  latitude: 42.0, longitude: 21.4,
  hourly_units: { pm2_5: 'μg/m³', pm10: 'μg/m³', carbon_monoxide: 'μg/m³', european_aqi: units },
  hourly: { time: Array.from({ length: 24 }, (_, h) => `2026-11-15T${String(h).padStart(2, '0')}:00`),
    pm2_5: Array(24).fill(12.5), pm10: Array(24).fill(20), carbon_monoxide: [null, ...Array(23).fill(300)], european_aqi: Array(24).fill(41) },
});
const respond = (b: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(b), { status: 200 })));
afterEach(() => vi.unstubAllGlobals());

describe('live air quality', () => {
  it('parses the CAMS response, keeps missing hours as null and marks times UTC', async () => {
    respond(body());
    const aq = await fetchAirQuality();
    expect(aq.time[0]).toBe('2026-11-15T00:00Z');
    expect(aq.values.carbon_monoxide[0]).toBeNull();
    expect([aq.values.pm2_5[5], aq.units.european_aqi, aq.grid]).toEqual([12.5, 'EAQI', [42.0, 21.4]]);
    expect(String((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toContain('domains=cams_europe');
  });
  it('rejects a response with unexpected units instead of showing it', async () => {
    respond(body('index'));
    await expect(fetchAirQuality()).rejects.toThrow(/units/);
  });
  it('names the European AQI bands', () => {
    expect([5, 20, 45, 79, 95, 140].map(eaqiBand)).toEqual(['Good', 'Fair', 'Moderate', 'Poor', 'Very poor', 'Extremely poor']);
  });
});
