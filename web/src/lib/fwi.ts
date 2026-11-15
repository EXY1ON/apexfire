// Canadian Forest Fire Weather Index System (Van Wagner 1987), the method EFFIS uses for fire danger.
// Inputs are noon local weather: temperature °C, relative humidity %, 10 m wind km/h, 24 h rain mm.

export interface FwiDay { ffmc: number; dmc: number; dc: number; isi: number; bui: number; fwi: number }
export interface Noon { t: number; rh: number; wind: number; rain: number; month: number } // month 1-12

const LE = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0];   // DMC day-length factors (46° N)
const LF = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6];  // DC day-length adjustments

export function ffmcNext(prev: number, w: Noon): number {
  const h = Math.min(100, Math.max(0, w.rh));
  let mo = (147.2 * (101 - prev)) / (59.5 + prev);
  if (w.rain > 0.5) {
    const rf = w.rain - 0.5;
    const wet = 42.5 * rf * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / rf));
    mo = mo > 150 ? mo + wet + 0.0015 * (mo - 150) ** 2 * Math.sqrt(rf) : mo + wet;
    mo = Math.min(mo, 250);
  }
  const ed = 0.942 * h ** 0.679 + 11 * Math.exp((h - 100) / 10) + 0.18 * (21.1 - w.t) * (1 - Math.exp(-0.115 * h));
  let m = mo;
  if (mo > ed) {
    const ko = 0.424 * (1 - (h / 100) ** 1.7) + 0.0694 * Math.sqrt(w.wind) * (1 - (h / 100) ** 8);
    m = ed + (mo - ed) * 10 ** -(ko * 0.581 * Math.exp(0.0365 * w.t));
  } else {
    const ew = 0.618 * h ** 0.753 + 10 * Math.exp((h - 100) / 10) + 0.18 * (21.1 - w.t) * (1 - Math.exp(-0.115 * h));
    if (mo < ew) {
      const k1 = 0.424 * (1 - ((100 - h) / 100) ** 1.7) + 0.0694 * Math.sqrt(w.wind) * (1 - ((100 - h) / 100) ** 8);
      m = ew - (ew - mo) * 10 ** -(k1 * 0.581 * Math.exp(0.0365 * w.t));
    }
  }
  return Math.min(101, Math.max(0, (59.5 * (250 - m)) / (147.2 + m)));
}

export function dmcNext(prev: number, w: Noon): number {
  const t = Math.max(w.t, -1.1);
  let pr = prev;
  if (w.rain > 1.5) {
    const rw = 0.92 * w.rain - 1.27;
    const wmi = 20 + 280 / Math.exp(0.023 * prev);
    const b = prev <= 33 ? 100 / (0.5 + 0.3 * prev) : prev <= 65 ? 14 - 1.3 * Math.log(prev) : 6.2 * Math.log(prev) - 17.2;
    const wmr = wmi + (1000 * rw) / (48.77 + b * rw);
    pr = Math.max(0, 43.43 * (5.6348 - Math.log(wmr - 20)));
  }
  const k = 1.894 * (t + 1.1) * (100 - w.rh) * LE[w.month - 1] * 1e-6;
  return Math.max(0, pr + 100 * k);
}

export function dcNext(prev: number, w: Noon): number {
  const t = Math.max(w.t, -2.8);
  let dr = prev;
  if (w.rain > 2.8) {
    const rw = 0.83 * w.rain - 1.27;
    const smi = 800 * Math.exp(-prev / 400);
    dr = Math.max(0, prev - 400 * Math.log(1 + (3.937 * rw) / smi));
  }
  const pe = Math.max(0, (0.36 * (t + 2.8) + LF[w.month - 1]) / 2);
  return dr + pe;
}

export function isi(ffmc: number, wind: number): number {
  const mo = (147.2 * (101 - ffmc)) / (59.5 + ffmc);
  const ff = 19.115 * Math.exp(-0.1386 * mo) * (1 + mo ** 5.31 / 4.93e7);
  return ff * Math.exp(0.05039 * wind);
}

export function bui(dmc: number, dc: number): number {
  if (dmc === 0 && dc === 0) return 0;
  const v = dmc <= 0.4 * dc
    ? (0.8 * dmc * dc) / (dmc + 0.4 * dc)
    : dmc - (1 - (0.8 * dc) / (dmc + 0.4 * dc)) * (0.92 + (0.0114 * dmc) ** 1.7);
  return Math.max(0, v);
}

export function fwi(isiV: number, buiV: number): number {
  const bb = buiV <= 80 ? 0.1 * isiV * (0.626 * buiV ** 0.809 + 2) : 0.1 * isiV * (1000 / (25 + 108.64 * Math.exp(-0.023 * buiV)));
  return bb <= 1 ? bb : Math.exp(2.72 * (0.434 * Math.log(bb)) ** 0.647);
}

/** Runs the daily system forward from standard start values (FFMC 85, DMC 6, DC 15). */
export function fwiSeries(days: Noon[], start = { ffmc: 85, dmc: 6, dc: 15 }): FwiDay[] {
  let { ffmc, dmc, dc } = start;
  return days.map((w) => {
    ffmc = ffmcNext(ffmc, w);
    dmc = dmcNext(dmc, w);
    dc = dcNext(dc, w);
    const i = isi(ffmc, w.wind);
    const b = bui(dmc, dc);
    return { ffmc, dmc, dc, isi: i, bui: b, fwi: fwi(i, b) };
  });
}

/** EFFIS fire danger classes for FWI. */
export const FWI_CLASSES = [
  { max: 5.2, label: 'Very low', color: '#5f8f6b' },
  { max: 11.2, label: 'Low', color: '#9cb05a' },
  { max: 21.3, label: 'Moderate', color: '#d9b440' },
  { max: 38, label: 'High', color: '#e0812f' },
  { max: 50, label: 'Very high', color: '#cf4a2b' },
  { max: Infinity, label: 'Extreme', color: '#8f1f2a' },
] as const;
export const fwiClass = (v: number) => FWI_CLASSES.find((c) => v < c.max)!;

/** One plain sentence per class (Simple mode). It describes the weather, not whether a fire is burning. */
const MEANING: Record<string, string> = {
  'Very low': 'The weather makes it hard for fires to start.',
  Low: 'The weather gives fires little help to start or spread.',
  Moderate: 'The weather lets fires start, and they can spread where it is dry.',
  High: 'The weather lets fires start and spread easily.',
  'Very high': 'The weather lets fires start very easily and spread fast.',
  Extreme: 'The weather lets fires spread very fast and makes them hard to control.',
};
export const fwiMeaning = (label: string) => MEANING[label] ?? '';
