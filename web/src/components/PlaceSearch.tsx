import { useId, useMemo, useState } from 'react';
import { expectSchema, fail } from '../lib/data';
import { useData } from '../lib/useData';
import { fmtInt } from '../lib/format';

export interface Place { id: number; name: string; ascii: string; cyr: string[]; lat: number; lon: number; code: string; pop: number }

export function validatePlaces(raw: unknown, path: string): Place[] {
  const d = expectSchema(raw, path, 'firewatch.places.v1');
  const rows = d.rows as [number, string, string, string[], number, number, string, number][];
  if (!Array.isArray(rows) || rows.length < 100) fail(path, 'too few places');
  return rows.map(([id, name, ascii, cyr, lat, lon, code, pop]) => ({ id, name, ascii, cyr, lat, lon, code, pop }));
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function searchPlaces(places: Place[], q: string, limit = 8): Place[] {
  const f = fold(q.trim());
  if (f.length < 2) return [];
  const score = (p: Place) => {
    const names = [p.name, p.ascii, ...p.cyr].map(fold);
    if (names.some((n) => n === f)) return 0;
    if (names.some((n) => n.startsWith(f))) return 1;
    if (names.some((n) => n.includes(f))) return 2;
    return 9;
  };
  return places.map((p) => [score(p), p] as const).filter(([s]) => s < 9)
    .sort((a, b) => a[0] - b[0] || b[1].pop - a[1].pop).slice(0, limit).map(([, p]) => p);
}

/** Offline combobox over the bundled GeoNames populated-place subset; no external geocoding calls. */
export function PlaceSearch({ onPick }: { onPick: (p: Place) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [wanted, setWanted] = useState(false);
  const places = useData(wanted ? 'places.json' : null, validatePlaces);
  const results = useMemo(() => (places.data ? searchPlaces(places.data, q) : []), [places.data, q]);
  const id = useId();

  const pick = (p: Place) => { onPick(p); setQ(p.name); setOpen(false); };
  return (
    <div className="place-search">
      <label htmlFor={`${id}-input`}>Find a place</label>
      <input id={`${id}-input`} type="search" role="combobox" autoComplete="off" placeholder="e.g. Prilep / Прилеп"
        aria-expanded={open && results.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${id}-opt-${results[active].id}` : undefined}
        value={q}
        onFocus={() => setWanted(true)}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); pick(results[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      {places.error && <p className="error small" role="status">Place list unavailable: {places.error}</p>}
      {open && results.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="place-results">
          {results.map((p, i) => (
            <li key={p.id} id={`${id}-opt-${p.id}`} role="option" aria-selected={i === active}
              className={i === active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
              <span>{p.name}</span>{p.cyr[0] && p.cyr[0] !== p.name && <span lang="mk" className="muted"> · {p.cyr[0]}</span>}
              {p.pop > 0 && <span className="muted small"> · pop. {fmtInt(p.pop)} (GeoNames)</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">GeoNames populated places (CC BY 4.0), searched in your browser. Moves the map; it does not name an incident.</p>
    </div>
  );
}
