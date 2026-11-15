import { useState } from 'react';
import { validateDoc } from '../lib/data';
import { useData } from '../lib/useData';
import { fmt1, fmtInt, fmtUTC } from '../lib/format';
import { SENSOR_LABEL } from '../lib/history';
import { Link } from '../lib/router';
import { SENSOR_COLOR, SensorMark } from '../components/MapView';
import type { SensorKey } from '../lib/data';
import { useExpert } from '../lib/mode';
import { Icon, IconHeading, Tech } from '../components/Icon';

interface Model {
  viirs: SensorKey; train_years: number[]; test_years: number[]; a: number; b: number; train_months: number; raw_viirs_to_modis_ratio_test: number; log_residual_sd: number;
  test: { n_months: number; mae: number; bias_pct: number; r2: number | null; annual_abs_error_pct: number | null };
  points: { month: string; viirs: number; modis: number; set: 'train' | 'test' }[];
  annual_test: { year: number; modis: number; predicted: number }[];
  matching: { aqua_detections: number; aqua_matched_by_viirs: number; aqua_match_share: number | null; viirs_detections: number;
    by_viirs_frp: { frp_from: number; frp_to: number | null; viirs: number; matched_by_aqua: number; share: number | null }[] };
}
interface Harm {
  generated_utc: string; unit: string; type_note: string; match_rule: string; limits: string[];
  annual_cell_days: Record<string, Record<string, number>>; annual_detections: Record<string, Record<string, number>>; models: Model[];
  harmonized_modis_equivalent: { year: number; value: number; source: string; viirs_equivalent?: number; viirs_low?: number; viirs_high?: number }[];
  reference_scale: SensorKey;
}
const vHarm = validateDoc<Harm>('firewatch.harmonization.v1', ['models', 'annual_cell_days', 'harmonized_modis_equivalent']);
const SENSORS: SensorKey[] = ['modis', 'viirs-snpp', 'viirs-jpss1', 'viirs-noaa21'];
const EMBER = '#EF611B';

/** Expert sees the content as is; Simple gets it folded behind one summary line. */
export function Harmonization() {
  const h = useData('harmonization.json', vHarm);
  const expert = useExpert();
  const [which, setWhich] = useState(0);
  if (h.error) return <div className="page prose"><h1 id="page-title" tabIndex={-1}>Harmonization</h1><p className="error" role="alert">{h.error}</p></div>;
  if (!h.data) return <div className="page prose"><p role="status">Loading harmonization results…</p></div>;
  const d = h.data;
  const m = d.models[Math.min(which, d.models.length - 1)];
  const ref = d.models.find((x) => x.viirs === d.reference_scale);
  return (
    <div className="page prose wide">
      <span className="eyebrow">NASA Space Apps challenge · Harmonization of MODIS and VIIRS hot spots</span>
      <h1 id="page-title" tabIndex={-1}>One fire record across two generations of satellites</h1>
      <p className="lede">MODIS has watched North Macedonia since 2000; VIIRS, its successor, sees two to three times as many hot pixels because its pixels are smaller. Counting detections across the switch would invent a fire boom. ApexFire converts between the sensors with a model tested on years it never saw, so the 2000s and 2020s can be read on one scale.</p>
      {!expert && <ul className="summary-card">
        <li><span className="ih-icon"><Icon name="satellite" size={18} /></span><span><strong>Two generations of satellites</strong>MODIS has watched since 2000. VIIRS, its successor, sees two to three times as many hot spots because its pixels are smaller.</span></li>
        <li><span className="ih-icon"><Icon name="chart" size={18} /></span><span><strong>Raw counts would mislead</strong>Adding up sightings across the switch would make it look as if fires boomed when they did not.</span></li>
        <li><span className="ih-icon"><Icon name="compare" size={18} /></span><span><strong>A tested conversion</strong>ApexFire converts between the satellites with a model checked on years it never saw, so the 2000s and 2020s read on one scale.</span></li>
      </ul>}

      <IconHeading icon="gauge">{expert ? 'Results on held-out years' : 'How well the conversion did on test years'}</IconHeading>
      {!expert && ref?.test.annual_abs_error_pct != null && <p>On years the model never saw, the best conversion ({SENSOR_LABEL[ref.viirs]} to MODIS) got yearly totals wrong by about {fmt1(ref.test.annual_abs_error_pct)} % on average.</p>}
      <Tech expert={expert}>
      <div className="table-scroll"><table>
        <thead><tr><th scope="col">Conversion</th><th scope="col">Trained</th><th scope="col">Tested</th><th scope="col">R² (monthly)</th><th scope="col">Bias</th><th scope="col">Annual error</th><th scope="col">Raw VIIRS : MODIS</th></tr></thead>
        <tbody>{d.models.map((x) => (
          <tr key={x.viirs}><th scope="row"><SensorMark sensor={x.viirs} />{SENSOR_LABEL[x.viirs]} to MODIS</th><td>{x.train_years[0]}–{x.train_years.at(-1)} ({x.train_months} months)</td>
            <td>{x.test_years[0]}–{x.test_years.at(-1)} ({x.test.n_months} months)</td><td className="num">{x.test.r2 ?? 'n/a'}</td>
            <td className="num">{x.test.bias_pct > 0 ? '+' : ''}{x.test.bias_pct} %</td><td className="num">{x.test.annual_abs_error_pct} %</td><td className="num">{x.raw_viirs_to_modis_ratio_test} : 1</td></tr>
        ))}</tbody>
      </table></div>
      <p className="small muted">Unit: {d.unit}. Model: MODIS = a × VIIRS<sup>b</sup>, fitted on monthly totals in log space. Error figures come only from the held-out years.</p>
      </Tech>

      <IconHeading icon="chart">The long record on one scale</IconHeading>
      <AnnualChart d={d} />
      {!expert && <p className="small">Each thin line is one satellite's own yearly count. The dashed ember line puts every year on one scale; the shaded band shows how far off the conversion was on test years. 2026 is a partial year (to 14 November).</p>}
      {expert && <p className="small">Thin lines are each sensor's own count of fire-active cell-days. The ember line is the harmonized record on the {SENSOR_LABEL[d.reference_scale]} scale, the conversion that tested best: {SENSOR_LABEL[d.reference_scale]} where it observed, MODIS converted for earlier years, with a band equal to the mean error on held-out years{ref ? ` (±${fmt1(ref.test.annual_abs_error_pct ?? 0)} %)` : ''}. 2026 is a partial year (to 14 November).</p>}
      <details><summary>Show as table</summary><AnnualTable d={d} /></details>

      <IconHeading icon="compare">How well the conversion fits</IconHeading>
      <Tech expert={expert}>
      {d.models.length > 1 && (
        <div className="seg" role="group" aria-label="Sensor pair">
          {d.models.map((x, i) => <button key={x.viirs} type="button" aria-pressed={i === which} onClick={() => setWhich(i)}>{SENSOR_LABEL[x.viirs]}</button>)}
        </div>
      )}
      <Scatter m={m} />
      <p className="small">Each point is one month. Hollow points trained the model, filled points tested it. The line is the fitted conversion (a = {m.a}, b = {m.b}).</p>
      <details><summary>Annual totals in the test years</summary>
        <table className="compact"><thead><tr><th scope="col">Year</th><th scope="col">MODIS observed</th><th scope="col">Predicted from {SENSOR_LABEL[m.viirs]}</th><th scope="col">Error</th></tr></thead>
          <tbody>{m.annual_test.map((r) => <tr key={r.year}><th scope="row">{r.year}</th><td>{fmtInt(r.modis)}</td><td>{fmt1(r.predicted)}</td><td>{fmt1(((r.predicted - r.modis) / r.modis) * 100)} %</td></tr>)}</tbody></table>
      </details>
      </Tech>

      <IconHeading icon="eye">{expert ? 'Why the sensors disagree' : 'Why the satellites disagree'}</IconHeading>
      <Bars m={m} />
      {!expert && <p className="small">Each bar shows how often MODIS also saw what {SENSOR_LABEL[m.viirs]} saw, from weak to strong heat. Small fires are mostly invisible to MODIS; large ones are usually seen by both. That gap, not more fire, is why VIIRS counts run higher.</p>}
      {expert && <p className="small">{d.match_rule}. Of {fmtInt(m.matching.aqua_detections)} Aqua MODIS detections, {fmtInt(m.matching.aqua_matched_by_viirs)} ({fmt1((m.matching.aqua_match_share ?? 0) * 100)} %) were also seen by {SENSOR_LABEL[m.viirs]}. Small fires, measured by VIIRS radiant power, are mostly invisible to MODIS; large ones are usually seen by both. That sensitivity gap, not more fire, is why raw VIIRS counts run higher.</p>}

      <IconHeading icon="search">Findings along the way</IconHeading>
      <Tech expert={expert}>
      <p>{d.type_note} The same discontinuity would distort any trend built on the type label alone.</p>
      {d.models.length > 1 && (
        <p>The sensor relationship is not fixed in time. {d.models.map((x) => `${SENSOR_LABEL[x.viirs]} trained on ${x.train_years[0]}–${x.train_years.at(-1)} misses ${x.test_years[0]}–${x.test_years.at(-1)} by ${x.test.bias_pct > 0 ? '+' : ''}${x.test.bias_pct} %`).join('; ')}. A conversion therefore needs re-testing as satellites age; drift of the ageing MODIS orbits and collection changes are candidate causes, not yet tested.</p>
      )}
      </Tech>

      <IconHeading icon="book">Method</IconHeading>
      <Tech expert={expert}><ol>
        <li>Load every North Macedonia detection: the original archive (2000–2025) plus gap years from the FIRMS API (S-NPP 2012–2023, NOAA-21, MODIS 2013, 2026), all clipped to the country.</li>
        <li>Snap detections to 0.05° cells (about 5 km) per UTC day. A cell-day counts once however many pixels lit it, which removes most of the pixel-size difference.</li>
        <li>Sum cell-days per month for each sensor and fit MODIS = a × VIIRS<sup>b</sup> on the training years.</li>
        <li>Test on later years the fit never saw; report R², bias, monthly and annual error.</li>
        <li>Match Aqua and VIIRS detections pixel by pixel to measure where and why they differ.</li>
      </ol></Tech>
      <IconHeading icon="info">Limits</IconHeading>
      <ul>{d.limits.map((l) => <li key={l}>{l}</li>)}</ul>
      <p className="hint">Generated {fmtUTC(d.generated_utc)} by <code>tools/harmonize.py</code>. <a href="/data/harmonization.json">Download the results (JSON)</a>. Raw series by sensor are in the <Link href="/explore?mode=history">archive</Link>.</p>
    </div>
  );
}

const W = 760; const H = 300; const PAD = { l: 48, r: 92, t: 12, b: 28 };

function AnnualChart({ d }: { d: Harm }) {
  const years = Array.from({ length: 27 }, (_, i) => 2000 + i);
  const harm = d.harmonized_modis_equivalent;
  const refObs = d.annual_cell_days[d.reference_scale] ?? {};
  const scale = years.map((y) => (refObs[y] !== undefined ? { y, v: refObs[y], obs: true } : (() => { const r = harm.find((z) => z.year === y); return r?.viirs_equivalent !== undefined ? { y, v: r.viirs_equivalent, lo: r.viirs_low, hi: r.viirs_high, obs: false } : null; })())).filter(Boolean) as { y: number; v: number; lo?: number; hi?: number; obs: boolean }[];
  const max = Math.max(...SENSORS.flatMap((s) => Object.values(d.annual_cell_days[s] ?? {})), ...scale.map((p) => p.hi ?? p.v)) * 1.05;
  const x = (y: number) => PAD.l + ((y - 2000) / 26) * (W - PAD.l - PAD.r);
  const yv = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const line = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${yv(b).toFixed(1)}`).join('');
  const band = scale.filter((p) => !p.obs && p.lo !== undefined);
  const ticks = [0, max / 3, (2 * max) / 3].map((v) => Math.round(v / 50) * 50);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Annual fire-active cell-days per sensor, 2000 to 2026, with the harmonized record on the ${SENSOR_LABEL[d.reference_scale]} scale. Full values in the table below.`}>
      {ticks.map((t) => <g key={t}><line x1={PAD.l} x2={W - PAD.r} y1={yv(t)} y2={yv(t)} stroke="var(--line-soft)" /><text x={PAD.l - 6} y={yv(t) + 3} fontSize="10" textAnchor="end" fill="var(--faint)">{fmtInt(t)}</text></g>)}
      {[2000, 2005, 2010, 2015, 2020, 2025].map((y) => <text key={y} x={x(y)} y={H - 8} fontSize="10" textAnchor="middle" fill="var(--faint)">{y}</text>)}
      {band.length > 1 && <path d={`${line(band.map((p) => [p.y, p.hi!]))}L${band.slice().reverse().map((p) => `${x(p.y).toFixed(1)},${yv(p.lo!).toFixed(1)}`).join('L')}Z`} fill={EMBER} opacity="0.16" />}
      {SENSORS.map((s) => {
        const pts = Object.entries(d.annual_cell_days[s] ?? {}).map(([y, v]) => [Number(y), v] as [number, number]).sort((a, b) => a[0] - b[0]);
        if (!pts.length) return null;
        const last = pts[pts.length - 1];
        return (
          <g key={s}>
            <path d={line(pts)} fill="none" stroke={SENSOR_COLOR[s]} strokeWidth="2" strokeLinejoin="round" />
            {pts.map(([y, v]) => <circle key={y} cx={x(y)} cy={yv(v)} r="4" fill={SENSOR_COLOR[s]} stroke="var(--ink-0)" strokeWidth="2"><title>{`${SENSOR_LABEL[s]} ${y}: ${fmtInt(v)} cell-days`}</title></circle>)}
            <text x={x(last[0]) + 8} y={yv(last[1]) + 3} fontSize="10.5" fill="var(--muted)">{SENSOR_LABEL[s].replace('VIIRS ', '')}</text>
          </g>
        );
      })}
      <path d={line(scale.map((p) => [p.y, p.v]))} fill="none" stroke={EMBER} strokeWidth="3" strokeDasharray="6 4" />
      {scale.filter((p) => !p.obs).map((p) => <circle key={p.y} cx={x(p.y)} cy={yv(p.v)} r="4.5" fill={EMBER} stroke="var(--ink-0)" strokeWidth="2"><title>{`${p.y}: ${fmt1(p.v)} ${SENSOR_LABEL[d.reference_scale]}-equivalent cell-days (converted from MODIS, ${fmt1(p.lo!)}–${fmt1(p.hi!)})`}</title></circle>)}
      <text x={x(2000) + 4} y={PAD.t + 12} fontSize="10.5" fill="var(--muted)">Harmonized, {SENSOR_LABEL[d.reference_scale]} scale (dashed)</text>
    </svg>
  );
}

function AnnualTable({ d }: { d: Harm }) {
  const years = Array.from({ length: 27 }, (_, i) => 2000 + i);
  return (
    <div className="table-scroll"><table className="compact">
      <thead><tr><th scope="col">Year</th>{SENSORS.map((s) => <th key={s} scope="col">{SENSOR_LABEL[s]}</th>)}<th scope="col">MODIS on {SENSOR_LABEL[d.reference_scale]} scale</th></tr></thead>
      <tbody>{years.map((y) => {
        const r = d.harmonized_modis_equivalent.find((z) => z.year === y);
        return <tr key={y}><th scope="row">{y}</th>{SENSORS.map((s) => { const v = d.annual_cell_days[s]?.[y]; return <td key={s}>{v === undefined ? <span className="muted">none</span> : fmtInt(v)}</td>; })}
          <td>{r?.viirs_equivalent !== undefined ? `${fmt1(r.viirs_equivalent)} (${fmt1(r.viirs_low!)}–${fmt1(r.viirs_high!)})` : ''}</td></tr>;
      })}</tbody>
    </table></div>
  );
}

function Scatter({ m }: { m: Model }) {
  const S = 360; const P = 40;
  const vals = m.points.flatMap((p) => [p.viirs, p.modis]);
  const lo = Math.log10(Math.max(1, Math.min(...vals))); const hi = Math.log10(Math.max(...vals)) + 0.1;
  const sx = (v: number) => P + ((Math.log10(v) - lo) / (hi - lo)) * (S - P - 10);
  const sy = (v: number) => S - P - ((Math.log10(v) - lo) / (hi - lo)) * (S - P - 10);
  const fit = Array.from({ length: 40 }, (_, i) => 10 ** (lo + (i / 39) * (hi - lo))).map((v) => [v, m.a * v ** m.b] as [number, number]).filter(([, y]) => y >= 10 ** lo && y <= 10 ** hi);
  const decades = [1, 10, 100, 1000].filter((v) => Math.log10(v) >= lo && Math.log10(v) <= hi);
  const color = SENSOR_COLOR[m.viirs];
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width="100%" style={{ maxWidth: 440 }} role="img"
      aria-label={`Monthly ${SENSOR_LABEL[m.viirs]} against MODIS fire-active cell-days on log axes; held-out R² ${m.test.r2}.`}>
      {decades.map((v) => <g key={v}>
        <line x1={sx(v)} x2={sx(v)} y1={10} y2={S - P} stroke="var(--line-soft)" /><line x1={P} x2={S - 10} y1={sy(v)} y2={sy(v)} stroke="var(--line-soft)" />
        <text x={sx(v)} y={S - P + 14} fontSize="10" textAnchor="middle" fill="var(--faint)">{v}</text><text x={P - 6} y={sy(v) + 3} fontSize="10" textAnchor="end" fill="var(--faint)">{v}</text></g>)}
      <text x={(S + P) / 2} y={S - 6} fontSize="10.5" textAnchor="middle" fill="var(--muted)">{SENSOR_LABEL[m.viirs]} cell-days per month</text>
      <text x={12} y={(S - P) / 2} fontSize="10.5" textAnchor="middle" fill="var(--muted)" transform={`rotate(-90 12 ${(S - P) / 2})`}>MODIS cell-days per month</text>
      <path d={fit.map(([v, y], i) => `${i ? 'L' : 'M'}${sx(v).toFixed(1)},${sy(y).toFixed(1)}`).join('')} fill="none" stroke={EMBER} strokeWidth="2" />
      {m.points.map((p) => <circle key={p.month} cx={sx(p.viirs)} cy={sy(p.modis)} r="4.5" fill={p.set === 'test' ? color : 'none'} stroke={color} strokeWidth="1.6">
        <title>{`${p.month} (${p.set}): ${SENSOR_LABEL[m.viirs]} ${p.viirs}, MODIS ${p.modis}`}</title></circle>)}
      <g transform={`translate(${P + 8}, 18)`} fontSize="10.5" fill="var(--muted)">
        <circle r="4.5" fill="none" stroke={color} strokeWidth="1.6" /><text x="9" y="3.5">train</text>
        <circle cx="54" r="4.5" fill={color} /><text x="63" y="3.5">test</text>
        <line x1="100" x2="118" stroke={EMBER} strokeWidth="2" /><text x="122" y="3.5">fitted conversion</text>
      </g>
    </svg>
  );
}

function Bars({ m }: { m: Model }) {
  const bins = m.matching.by_viirs_frp.filter((b) => b.share !== null);
  const W2 = 520; const H2 = 200; const P = { l: 40, b: 34, t: 10 };
  const bw = (W2 - P.l - 10) / bins.length;
  const y = (v: number) => H2 - P.b - v * (H2 - P.b - P.t);
  return (
    <svg viewBox={`0 0 ${W2} ${H2}`} width="100%" style={{ maxWidth: 620 }} role="img"
      aria-label={`Share of ${SENSOR_LABEL[m.viirs]} detections also seen by Aqua MODIS, by radiant power: ${bins.map((b) => `${b.frp_from}${b.frp_to ? `–${b.frp_to}` : '+'} MW ${Math.round((b.share ?? 0) * 100)}%`).join(', ')}.`}>
      {[0, 0.5, 1].map((v) => <g key={v}><line x1={P.l} x2={W2 - 10} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" /><text x={P.l - 6} y={y(v) + 3} fontSize="10" textAnchor="end" fill="var(--faint)">{v * 100}%</text></g>)}
      {bins.map((b, i) => (
        <g key={b.frp_from}>
          <path d={`M${P.l + i * bw + 6},${y(0)}V${y(b.share!) + 4}q0,-4 4,-4H${P.l + (i + 1) * bw - 10}q4,0 4,4V${y(0)}Z`} fill={SENSOR_COLOR[m.viirs]}>
            <title>{`${b.frp_from}${b.frp_to ? `–${b.frp_to}` : '+'} MW: ${b.matched_by_aqua} of ${b.viirs} seen by Aqua`}</title></path>
          <text x={P.l + (i + 0.5) * bw} y={y(b.share!) - 6} fontSize="10.5" textAnchor="middle" fill="var(--text)">{Math.round(b.share! * 100)}%</text>
          <text x={P.l + (i + 0.5) * bw} y={H2 - P.b + 14} fontSize="10" textAnchor="middle" fill="var(--faint)">{b.frp_from}{b.frp_to ? `–${b.frp_to}` : '+'} MW</text>
        </g>
      ))}
      <text x={(W2 + P.l) / 2} y={H2 - 4} fontSize="10.5" textAnchor="middle" fill="var(--muted)">{SENSOR_LABEL[m.viirs]} fire radiative power</text>
    </svg>
  );
}
