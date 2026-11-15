const num = new Intl.NumberFormat('en-GB');
const num1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

export const fmtInt = (n: number) => num.format(n);
export const fmt1 = (n: number) => num1.format(n);
export const fmt2 = (n: number) => num2.format(n);

const toDate = (t: string) => new Date(t.length === 16 && !t.endsWith('Z') ? `${t}Z` : t);

/** "2024-09-04 01:03 UTC" from any ISO UTC string. */
export function fmtUTC(t: string): string {
  const d = toDate(t);
  return Number.isNaN(d.getTime()) ? t : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const skopje = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Skopje', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
});
/** Local Europe/Skopje display (CET/CEST); UTC remains canonical. */
export const fmtSkopje = (t: string) => skopje.format(toDate(t));
/** ["15 Nov 2026", "14:20 CET"]: local date and time apart, for two-line figures. */
export function skopjeParts(t: string): [string, string] {
  const parts = skopje.formatToParts(toDate(t));
  const v = (k: string) => parts.find((x) => x.type === k)?.value ?? '';
  return [`${v('day')} ${v('month')} ${v('year')}`, `${v('hour')}:${v('minute')} ${v('timeZoneName')}`];
}

export function ageText(fromIso: string, now = Date.now()): string {
  const h = (now - toDate(fromIso).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(0, Math.round(h * 60))} min ago`;
  if (h < 48) return `${h < 3 ? fmt1(h) : Math.round(h)} h ago`;
  return `${fmt1(h / 24)} days ago`;
}

export const kmh = (ms: number) => ms * 3.6;

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Eight-point direction in words ("north-east"), for plain-language text. */
export const compassWords = (deg: number) => WORDS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
