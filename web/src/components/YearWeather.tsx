import { useMemo } from 'react';
import type { DayCounts } from '../lib/history';
import { compass, compassWords, fmt1, fmtInt, kmh } from '../lib/format';
import { useExpert } from '../lib/mode';
import { dayIndex, dayOf, fromDir, meanAt, type WeatherYear, type WxKey } from '../lib/weather-history';
import { Icon, IconHeading } from './Icon';

const W = 320; const ROW = 34; const GAP = 9; const LEFT = 0;
const MONTHS = 'JFMAMJJASOND';

/** One year of country-mean daily weather aligned with the satellite sightings per day, so fire weeks and hot, dry, windy spells line up. */
export function YearWeather({ w, nodes, counts, from, to, onDay }: {
  w: WeatherYear; nodes: number[]; counts: DayCounts; from: string; to: string; onDay: (day: string) => void;
}) {
  const expert = useExpert();
  const n = w.days;
  const series = useMemo(() => {
    const get = (k: WxKey) => Array.from({ length: n }, (_, i) => meanAt(w, k, i, nodes));
    return { tmax: get('tmax'), rain: get('rain'), wsmax: get('wsmax').map((x) => (x === null ? null : kmh(x))), rh: get('rh') };
  }, [w, nodes, n]);
  const dets = useMemo(() => Array.from({ length: n }, (_, i) => counts.get(dayOf(w, i))?.total ?? 0), [counts, w, n]);
  const x = (i: number) => LEFT + (i / (n - 1)) * (W - LEFT);
  const bw = Math.max(0.6, W / n - 0.15);
  const rows: { key: string; label: string; unit: string; top: number }[] = [
    { key: 'dets', label: expert ? 'Detections' : 'Satellite sightings', unit: '', top: 0 },
    { key: 'tmax', label: expert ? 'Max temperature' : 'Hottest part of the day', unit: '°C', top: ROW + GAP },
    { key: 'rain', label: 'Rain', unit: 'mm', top: 2 * (ROW + GAP) },
    { key: 'wsmax', label: expert ? 'Max wind (daily)' : 'Strongest wind', unit: 'km/h', top: 3 * (ROW + GAP) },
  ];
  const H = 4 * ROW + 3 * GAP + 14;
  const maxDet = Math.max(1, ...dets);
  const finite = (a: (number | null)[]) => a.filter((v): v is number => v !== null);
  const tLo = Math.min(...finite(series.tmax)); const tHi = Math.max(...finite(series.tmax));
  const rainMax = Math.max(5, ...finite(series.rain)); const windMax = Math.max(20, ...finite(series.wsmax));
  const line = (vals: (number | null)[], lo: number, hi: number, top: number) => vals.map((v, i) => (v === null ? '' : `${i && vals[i - 1] !== null ? 'L' : 'M'}${x(i).toFixed(1)},${(top + ROW - ((v - lo) / (hi - lo || 1)) * ROW).toFixed(1)}`)).join('');
  const a = Math.max(0, dayIndex(w, from)); const b = Math.min(n - 1, dayIndex(w, to));
  const whole = a === 0 && b === n - 1;
  const hot = finite(series.tmax).filter((t) => t >= 30).length;
  const dry = series.rain.filter((r) => r !== null && r < 0.2).length;
  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    if (i >= 0 && i < n) onDay(dayOf(w, i));
  };
  return (
    <div className="year-wx">
      {/* Pointer shortcut only: the calendar above selects days by keyboard. */}
      <svg viewBox={`0 -2 ${W} ${H}`} width="100%" role="img" onClick={pick} style={{ cursor: 'pointer' }}
        aria-label={`${w.year}: maximum temperature ${Math.round(tLo)} to ${Math.round(tHi)} °C across the country, ${hot} days at 30 °C or more, ${dry} days without rain, strongest daily wind ${Math.round(windMax)} km/h.`}>
        {!whole && <rect x={x(a) - bw / 2} y={-2} width={Math.max(2, x(b) - x(a) + bw)} height={H - 12} fill="var(--ember-wash)" stroke="oklch(0.69 0.2 45 / 0.6)" strokeWidth="0.8" />}
        {rows.map((r) => <line key={r.key} x1={0} x2={W} y1={r.top + ROW} y2={r.top + ROW} stroke="var(--line-soft)" />)}
        {dets.map((d, i) => d > 0 && <rect key={i} x={x(i) - bw / 2} width={bw} y={ROW - Math.max(1.5, (Math.sqrt(d) / Math.sqrt(maxDet)) * ROW)} height={Math.max(1.5, (Math.sqrt(d) / Math.sqrt(maxDet)) * ROW)} fill="#FF6A00" />)}
        <path d={line(series.tmax, tLo, tHi, rows[1].top)} fill="none" stroke="oklch(0.8 0.13 58)" strokeWidth="1.1" />
        {series.rain.map((v, i) => v !== null && v >= 0.2 && <rect key={i} x={x(i) - bw / 2} width={bw} y={rows[2].top + ROW - (v / rainMax) * ROW} height={(v / rainMax) * ROW} fill="oklch(0.72 0.1 240)" />)}
        <path d={line(series.wsmax, 0, windMax, rows[3].top)} fill="none" stroke="var(--text)" strokeWidth="1" opacity="0.85" />
        {MONTHS.split('').map((m, k) => { const i = dayIndex(w, `${w.year}-${String(k + 1).padStart(2, '0')}-01`); return <text key={k} x={x(i) + 2} y={H - 4} fontSize="8" fill="var(--faint)">{m}</text>; })}
      </svg>
      <ul className="year-wx-key">
        {rows.map((r, k) => (
          <li key={r.key}><span className={`yk yk-${r.key}`} aria-hidden="true" />{r.label}
            <span className="muted num">{k === 0 ? fmtInt(dets.reduce((s, v) => s + v, 0)) : k === 1 ? `${Math.round(tLo)}–${Math.round(tHi)} °C` : k === 2 ? `up to ${fmt1(rainMax)} mm/day` : `up to ${Math.round(windMax)} km/h`}</span></li>
        ))}
      </ul>
      <p className="hint">{expert
        ? <>Country mean of {nodes.length} {w.source} nodes, UTC days. {w.provider}; {w.credit}. Regional reanalysis about 50 km apart, not station or valley-scale weather. Click the chart to pick a day.</>
        : <>Weather averaged over the country from NASA reanalysis (a weather model run over past observations), about 50 km detail. Tap the chart to pick a day.</>}</p>
    </div>
  );
}

/** That day's country-mean weather, in plain figures. */
export function DayWeather({ w, nodes, day }: { w: WeatherYear; nodes: number[]; day: string }) {
  const expert = useExpert();
  const i = dayIndex(w, day);
  if (i < 0 || i >= w.days) return null;
  const m = (k: WxKey) => meanAt(w, k, i, nodes);
  const [t, rh, rain, ws, wsmax, u, v] = [m('tmax'), m('rh'), m('rain'), m('ws'), m('wsmax'), m('u'), m('v')];
  if (t === null || rh === null || rain === null || ws === null || wsmax === null || u === null || v === null) return <p className="hint">Weather for {day} has gaps in the reanalysis.</p>;
  const dir = fromDir(u, v);
  return (
    <section className="day-wx" aria-label={`Weather on ${day}`}>
      <IconHeading as="h3" icon="thermo" className={expert ? 'eyebrow' : undefined}>{expert ? `Weather on ${day} · country mean` : 'Weather that day'}</IconHeading>
      <dl className="figures">
        <div><dt><Icon name="thermo" size={13} /> {expert ? 'Max temp' : 'Hottest'}</dt><dd className="num">{fmt1(t)}<small> °C</small></dd></div>
        <div><dt><Icon name="drop" size={13} /> Humidity</dt><dd className="num">{Math.round(rh)}<small> %</small></dd></div>
        <div><dt><Icon name="wind" size={13} /> Wind</dt><dd className="num">{Math.round(kmh(ws))}<small> km/h{expert ? `, max ${Math.round(kmh(wsmax))}` : ''}</small><br /><small>from the {expert ? compass(dir) : compassWords(dir)}</small></dd></div>
        <div><dt><Icon name="drop" size={13} /> Rain</dt><dd className="num">{rain < 0.1 ? (expert ? '0' : 'None') : fmt1(rain)}{(rain >= 0.1 || expert) && <small> mm</small>}</dd></div>
      </dl>
      <p className="hint">{expert ? `Daily mean humidity and wind, daily maximum temperature, bias-corrected rain; ${w.source}.` : 'Averaged over the country for the whole day. The map shows that day’s average wind.'}</p>
    </section>
  );
}
