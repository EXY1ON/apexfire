import type { CSSProperties } from 'react';
import type { Catalog, SensorKey } from '../lib/data';
import { SENSOR_KEYS } from '../lib/data';
import { SENSOR_LABEL } from '../lib/history';
import { FIRST_YEAR, LAST_YEAR } from '../lib/explore-state';
import { fmtInt } from '../lib/format';
import { Link } from '../lib/router';

// One orange hue, dark to light = few to many records (validated: monotone lightness, low end 2.1:1 on the page,
// labels ≥ 4.9:1: light text on the first two steps, dark text on the rest).
const RAMP = ['#6e3c15', '#9a4a10', '#d2650f', '#f5873a', '#ffb985'];
const BREAKS = [500, 1000, 2000, 4000]; // records per sensor-year
const step = (n: number) => BREAKS.filter((b) => n >= b).length;
const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const day = (iso: string) => new Date(`${iso}T00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export type CellState = { kind: 'before'; start: string } | { kind: 'gap' } | { kind: 'data'; records: number; partial: string | null };

/** State of one sensor-year in the catalog: before the record starts, a gap (no source file), or records (possibly a partial year). */
export function cellState(cat: Catalog, s: SensorKey, y: number): CellState {
  const start = cat.history.sensors[s].record_start ?? `${FIRST_YEAR}-01-01`;
  if (y < Number(start.slice(0, 4))) return { kind: 'before', start };
  const f = cat.history.files.find((x) => x.sensor === s && x.year === y);
  if (!f) return { kind: 'gap' };
  const end = cat.history.files.filter((x) => x.year === LAST_YEAR).map((x) => x.date_max ?? '').sort().pop();
  const partial = start.startsWith(String(y)) && !start.endsWith('-01-01') ? `from ${day(start)}` : y === LAST_YEAR && end ? `to ${day(end)}` : null;
  return { kind: 'data', records: f.records, partial };
}

function describe(s: SensorKey, y: number, c: CellState) {
  const who = `${SENSOR_LABEL[s]} ${y}`;
  if (c.kind === 'before') return `${who}: before this satellite's record starts (${day(c.start)})`;
  if (c.kind === 'gap') return `${who}: gap, no source file`;
  return `${who}: ${fmtInt(c.records)} detections${c.partial ? `, partial year (${c.partial})` : ''}. Open in the Archive.`;
}

/** Year × sensor grid of record counts; each cell opens the Archive for that year and sensor. Years run across on wide screens, down on phones. */
export function CoverageMatrix({ catalog }: { catalog: Catalog }) {
  const years = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
  // Grid positions for both orientations, chosen by CSS: wide = sensors are rows; narrow = years are rows.
  const anyGap = SENSOR_KEYS.some((s) => years.some((y) => cellState(catalog, s, y).kind === 'gap'));
  const at = (si: number, yi: number) => ({ '--wr': si + 2, '--wc': yi + 2, '--nr': yi + 2, '--nc': si + 2 }) as CSSProperties;
  return (
    <div className="coverage-matrix">
      <div className="cov-grid" style={{ '--years': years.length } as CSSProperties}>
        {SENSOR_KEYS.map((s, si) => <span key={s} className="cov-sensor" style={at(si, -1)}>{SENSOR_LABEL[s].replace('VIIRS ', '')}<small>{s === 'modis' ? 'Terra, Aqua' : 'VIIRS'}</small></span>)}
        {years.map((y, yi) => <span key={y} className="cov-year" style={at(-1, yi)}>{y}</span>)}
        {SENSOR_KEYS.flatMap((s, si) => years.map((y, yi) => {
          const c = cellState(catalog, s, y);
          const label = describe(s, y, c);
          if (c.kind !== 'data') return <span key={`${s}${y}`} className={`cov-cell ${c.kind}`} style={at(si, yi)} title={label} aria-label={label} role="img">{c.kind === 'gap' ? 'gap' : ''}</span>;
          const k = step(c.records);
          return (
            <Link key={`${s}${y}`} href={`/explore?mode=history&year=${y}&s=${s}`} className={`cov-cell data${c.partial ? ' partial' : ''}`} title={label} aria-label={label}
              style={{ ...at(si, yi), background: RAMP[k], color: k < 2 ? '#f1ede4' : '#14150f' }}>{short(c.records)}</Link>
          );
        }))}
      </div>
      <ul className="cov-legend" aria-label="How to read the matrix">
        <li><span className="cov-ramp" aria-hidden="true">{RAMP.map((c) => <i key={c} style={{ background: c }} />)}</span>Detections per sensor and year: under 500, 500–999, 1,000–1,999, 2,000–3,999, 4,000 or more</li>
        <li><span className="cov-cell data partial cov-key" aria-hidden="true" style={{ background: RAMP[1] }} />Partial year: the record starts that year, or 2026 so far</li>
        <li><span className="cov-cell before cov-key" aria-hidden="true" />Before the satellite's record starts (not missing data)</li>
        <li><span className="cov-cell gap cov-key" aria-hidden="true">gap</span>Gap: no source file for a year inside the record{anyGap ? '' : ' (none at present)'}</li>
      </ul>
    </div>
  );
}
