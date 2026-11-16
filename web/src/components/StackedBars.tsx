import { fmtInt } from '../lib/format';

export interface Series { label: string; color: string }

/** Stacked bars, one per category and one segment per series; values[category][series]. Inline SVG like the site's other charts. */
export function StackedBars({ categories, series, values, label, unit, fmt = fmtInt }: {
  categories: string[]; series: Series[]; values: number[][]; label: string; unit: string; fmt?: (v: number) => string;
}) {
  const W = 320; const H = 130; const n = categories.length; const bw = W / n;
  const totals = values.map((r) => r.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals) || 1;
  const every = Math.ceil(n / 7);
  const u = unit ? ` ${unit}` : '';
  return (
    <svg className="wx-chart" viewBox={`0 0 ${W} ${H + 14}`} width="100%" role="img" aria-label={label}>
      {values.map((r, i) => {
        let y = H;
        return (
          <g key={categories[i]}>
            <title>{`${categories[i]}: ${fmt(totals[i])}${u}`}</title>
            {r.map((v, k) => {
              const h = (v / max) * H; y -= h;
              return h > 0.2 ? <rect key={k} x={i * bw} y={y} width={bw} height={h} fill={series[k].color} stroke="var(--ink-0)" strokeWidth={1} /> : null;
            })}
          </g>
        );
      })}
      <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
      {categories.map((c, i) => (i % every === 0 ? <text key={c} x={i * bw + bw / 2} y={H + 11} fontSize="9" fill="var(--faint)" textAnchor="middle">{c}</text> : null))}
      <text x="2" y="9" fontSize="9" fill="var(--faint)">{fmt(max)}{u}</text>
    </svg>
  );
}

/** Swatches for the series that have any value, in stack order. */
export function SeriesLegend({ series, values }: { series: Series[]; values: number[][] }) {
  const used = series.filter((_, k) => values.some((r) => r[k] > 0));
  return <ul className="chart-legend">{used.map((s) => <li key={s.label}><span className="swatch" style={{ background: s.color }} aria-hidden />{s.label}</li>)}</ul>;
}
