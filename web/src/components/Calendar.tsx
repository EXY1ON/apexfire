import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Catalog, SensorKey } from '../lib/data';
import { dayCoverage, SENSOR_LABEL, type Coverage, type DayCounts } from '../lib/history';
import { fmtInt } from '../lib/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const monthRange = (y: number, m: number): [string, string] => [`${y}-${pad(m + 1)}-01`, `${y}-${pad(m + 1)}-${pad(daysIn(y, m))}`];

interface Props {
  year: number; counts: DayCounts; sensors: SensorKey[]; failed: SensorKey[]; catalog: Catalog; from: string; to: string;
  onSelectRange: (from: string, to: string) => void;
}

interface DayInfo { n: number; level: number; status: Coverage; label: string }

/** UTC calendar: a compact year overview (one row per month) plus a touch-sized grid for the selected month.
 *  Year overview keys: left/right = day, up/down = month. Month grid keys: left/right = day, up/down = week. Enter selects. */
export function Calendar({ year, counts, sensors, failed, catalog, from, to, onSelectRange }: Props) {
  const max = useMemo(() => Math.max(1, ...[...counts.values()].map((c) => c.total)), [counts]);
  const [focus, setFocus] = useState(from);
  const grid = useRef<HTMLDivElement>(null);

  const info = (day: string): DayInfo => {
    const c = counts.get(day);
    const cov = dayCoverage(day, sensors, catalog, failed);
    const n = c?.total ?? 0;
    const level = n === 0 ? 0 : Math.min(4, 1 + Math.floor((Math.log(n) / Math.log(max + 1)) * 4));
    const parts = sensors.filter((s) => c?.[s]).map((s) => `${SENSOR_LABEL[s]} ${c?.[s]}`);
    const label = cov.status === 'none'
      ? `${day}: no source coverage for selected sensors (${cov.missing.join('; ')})`
      : `${day}: ${n ? `${fmtInt(n)} detection${n === 1 ? '' : 's'} (${parts.join(', ')})` : 'no detections recorded in the files'}${cov.status === 'partial' ? `; partial coverage: ${cov.missing.join('; ')}` : ''}`;
    return { n, level, status: cov.status, label };
  };

  const move = (day: string) => {
    setFocus(day);
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent, m: number, d: number) => {
    let nm = m; let nd = d;
    if (e.key === 'ArrowRight') nd += 1; else if (e.key === 'ArrowLeft') nd -= 1;
    else if (e.key === 'ArrowDown') nm += 1; else if (e.key === 'ArrowUp') nm -= 1;
    else if (e.key === 'Home') nd = 1; else if (e.key === 'End') nd = daysIn(year, m);
    else return;
    e.preventDefault();
    if (nd < 1) { nm -= 1; if (nm >= 0) nd = daysIn(year, nm); }
    if (nm >= 0 && nm <= 11 && nd > daysIn(year, nm)) { if (e.key === 'ArrowRight') { nm += 1; nd = 1; } else nd = daysIn(year, nm); }
    if (nm < 0 || nm > 11) return;
    move(`${year}-${pad(nm + 1)}-${pad(nd)}`);
  };

  const focusDay = focus.startsWith(String(year)) ? focus : `${year}-01-01`;
  const detailMonth = from.slice(0, 7) === to.slice(0, 7) ? Number(from.slice(5, 7)) - 1 : null;

  return (
    <div className="calendar">
      <div ref={grid} role="group" aria-label={`UTC calendar for ${year}. Arrow keys move between days; Enter selects a day.`}>
        {MONTHS.map((name, m) => {
          const [monthFrom, monthTo] = monthRange(year, m);
          let monthTotal = 0;
          for (let d = 1; d <= daysIn(year, m); d++) monthTotal += counts.get(`${year}-${pad(m + 1)}-${pad(d)}`)?.total ?? 0;
          return (
            <div className="cal-row" key={name}>
              <button type="button" className={`cal-month${from === monthFrom && to === monthTo ? ' selected' : ''}`}
                onClick={() => onSelectRange(monthFrom, monthTo)} aria-label={`Select ${name} ${year}: ${fmtInt(monthTotal)} detections`}>
                {name}
              </button>
              {/* On touch screens the tiny day cells ignore taps (see CSS), so a tap on the strip selects the month and opens the larger grid. */}
              <div className="cal-days" onClick={(e) => { if (e.target === e.currentTarget) onSelectRange(monthFrom, monthTo); }}>
                {Array.from({ length: daysIn(year, m) }, (_, i) => {
                  const day = `${year}-${pad(m + 1)}-${pad(i + 1)}`;
                  const d = info(day);
                  const inSel = day >= from && day <= to;
                  return (
                    <button key={day} type="button" data-day={day}
                      className={`cal-day lv${d.level} ${d.status}${inSel ? ' in-sel' : ''}`}
                      tabIndex={day === focusDay ? 0 : -1}
                      title={d.label} aria-label={d.label} aria-pressed={from === day && to === day}
                      onFocus={() => setFocus(day)}
                      onKeyDown={(e) => onKey(e, m, i + 1)}
                      onClick={() => onSelectRange(day, day)} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {detailMonth === null
        ? <p className="hint">Select a month (tap its row) to see its days in a larger grid.</p>
        : <MonthGrid key={`${year}-${detailMonth}`} year={year} m={detailMonth} info={info} from={from} to={to} onSelectRange={onSelectRange} />}
      <ul className="cal-legend" aria-label="Calendar legend">
        <li><span className="cal-day lv0 covered" aria-hidden /> 0: no detections recorded (not confirmed fire-free)</li>
        <li><span className="cal-day lv2 covered" aria-hidden /> detections (darker = more, log scale)</li>
        <li><span className="cal-day lv0 none" aria-hidden /> – no source file / outside record / failed to load</li>
        <li><span className="cal-day lv0 partial" aria-hidden /> partial: some selected sensors lack coverage (* in month grid)</li>
      </ul>
    </div>
  );
}

function MonthGrid({ year, m, info, from, to, onSelectRange }: {
  year: number; m: number; info: (day: string) => DayInfo; from: string; to: string; onSelectRange: (from: string, to: string) => void;
}) {
  const n = daysIn(year, m);
  const lead = (new Date(Date.UTC(year, m, 1)).getUTCDay() + 6) % 7; // Monday-first columns
  const [monthFrom, monthTo] = monthRange(year, m);
  const [focus, setFocus] = useState(from.slice(0, 7) === monthFrom.slice(0, 7) ? Number(from.slice(8, 10)) : 1);
  const box = useRef<HTMLDivElement>(null);

  const onKey = (e: KeyboardEvent, d: number) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
    let next = d + (step[e.key] ?? 0);
    if (e.key === 'Home') next = 1; else if (e.key === 'End') next = n; else if (!(e.key in step)) return;
    e.preventDefault();
    next = Math.min(n, Math.max(1, next));
    setFocus(next);
    box.current?.querySelector<HTMLButtonElement>(`[data-md="${next}"]`)?.focus();
  };

  return (
    <div className="month-grid">
      <div className="month-head">
        <button type="button" className="icon-btn" disabled={m === 0} aria-label="Previous month" onClick={() => onSelectRange(...monthRange(year, m - 1))}>‹</button>
        <h3 className="h4">{MONTH_FULL[m]} {year} <span className="muted small">(UTC days)</span></h3>
        <button type="button" className="icon-btn" disabled={m === 11} aria-label="Next month" onClick={() => onSelectRange(...monthRange(year, m + 1))}>›</button>
      </div>
      <div ref={box} className="month-days" role="group" aria-label={`Days of ${MONTH_FULL[m]} ${year}. Arrow keys move by day and week; Enter selects.`}>
        {WEEKDAYS.map((w) => <span key={w} className="wd" aria-hidden>{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} aria-hidden />)}
        {Array.from({ length: n }, (_, i) => {
          const dn = i + 1;
          const day = `${year}-${pad(m + 1)}-${pad(dn)}`;
          const d = info(day);
          return (
            <button key={day} type="button" data-md={dn} className={`md lv${d.level} ${d.status}${from === day && to === day ? ' picked' : ''}`}
              tabIndex={dn === focus ? 0 : -1} aria-label={d.label} aria-pressed={from === day && to === day}
              onFocus={() => setFocus(dn)} onKeyDown={(e) => onKey(e, dn)} onClick={() => onSelectRange(day, day)}>
              <span className="md-n">{dn}</span>
              <span className="md-c">{d.status === 'none' ? '–' : `${fmtInt(d.n)}${d.status === 'partial' ? '*' : ''}`}</span>
            </button>
          );
        })}
      </div>
      {!(from === monthFrom && to === monthTo) && <button type="button" className="link-btn" onClick={() => onSelectRange(monthFrom, monthTo)}>Show whole {MONTH_FULL[m]}</button>}
    </div>
  );
}
