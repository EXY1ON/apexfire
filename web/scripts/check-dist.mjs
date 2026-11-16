// Public build boundary check: dist may contain only the app shell, its assets, logos and generated /data files.
// Fails on unexpected paths, private-looking content or the first-view budget being exceeded.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const allowed = [/^index\.html$/, /^apexfire-(icon|logo)\.svg$/, /^apexfire-share\.png$/, /^assets\/[\w.-]+\.(js|css|mjs|woff2|woff)$/, /^data\/[\w/.-]+\.(json|geojson|jpg|png|txt)$/];
const forbidden = [/Token-and-key/i, /MAP_KEY\s*[:=]/, /[A-Fa-f0-9]{32}(?![A-Fa-f0-9])/, /Bearer\s+[A-Za-z0-9._-]{20,}/, /\/Users\//, /\.venv/, /firebase-adminsdk/i, /BEGIN (RSA |EC )?PRIVATE KEY/];
const files = [];
const walk = (d) => readdirSync(d).forEach((n) => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p); });
walk(dist);
const problems = [];
let jsGzip = 0;
for (const f of files) {
  const rel = relative(dist, f);
  if (!allowed.some((r) => r.test(rel))) problems.push(`unexpected file: ${rel}`);
  if (/\.(js|mjs|css|html|json|geojson|txt)$/.test(rel)) {
    const text = readFileSync(f, 'utf8');
    // sha256 hex in data provenance is 64 chars; the 32-hex rule targets FIRMS MAP_KEY-shaped values only.
    // Spread Lab grids are base64 bytes from model rasters; runs of zero bytes encode as "AAAA…", which reads as hex.
    const grids = rel.startsWith('data/spread/lab/') ? text.replace(/"(a|f|fuel_b64)":"[A-Za-z0-9+/=]*"/g, '') : text;
    const scrubbed = grids.replace(/[A-Fa-f0-9]{64}/g, '');
    for (const r of forbidden) if (r.test(scrubbed)) problems.push(`${rel}: matches forbidden pattern ${r}`);
  }
  if (/^assets\/.*\.(js|mjs)$/.test(rel) && !/maplibre/i.test(rel)) jsGzip += gzipSync(readFileSync(f)).length;
}
console.log(`dist: ${files.length} files; app JS (excluding lazy MapLibre chunks) ${(jsGzip / 1024).toFixed(0)} KB gzip`);
if (jsGzip > 500 * 1024) problems.push('app JS exceeds 500 KB gzip budget');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('public build boundary check passed');
