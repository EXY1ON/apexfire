import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEffisSeason, lastPublished } from './effis';

const row = (week: number, area: number | null) => ({ iso3: 'MKD', week, min_year: 2006, mddate: `2026${String(week).padStart(4, '0')}`,
  events: area === null ? null : 3, events_avg: 1.5, area_ha: area, area_ha_avg: 40 });
const season = (bad = false) => ({ banfweekly: Array.from({ length: 52 }, (_, i) => row(i + 1, i < 45 ? 1 : null)),
  banfcumulative: Array.from({ length: 52 }, (_, i) => row(bad && i === 3 ? 99 : i + 1, i < 45 ? 10 * (i + 1) : null)) });
const annual = [{ year: 2025, ba: 31338, nf: 82 }, { year: 2026, ba: 450, nf: 69 }];
const respond = (w: unknown, a: unknown = annual) => vi.stubGlobal('fetch', vi.fn(async (u: string) => new Response(JSON.stringify(String(u).includes('weekly') ? w : a), { status: 200 })));
afterEach(() => vi.unstubAllGlobals());

describe('live EFFIS season', () => {
  it('keeps unpublished weeks as null and finds the last published week', async () => {
    respond(season());
    const e = await fetchEffisSeason(2026);
    expect(e.cumulative.at(-1)!.area_ha).toBeNull();
    expect(lastPublished(e.cumulative)).toMatchObject({ week: 45, area_ha: 450 });
    expect(e.source_url).toContain('country=MKD&year=2026');
  });
  it('rejects rows out of order instead of drawing them', async () => {
    respond(season(true));
    await expect(fetchEffisSeason(2026)).rejects.toThrow(/row 4/);
  });
  it('rejects a malformed annual series and HTTP errors', async () => {
    respond(season(), [{ year: 2026 }]);
    await expect(fetchEffisSeason(2026)).rejects.toThrow(/annual/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(fetchEffisSeason(2026)).rejects.toThrow(/503/);
  });
});
