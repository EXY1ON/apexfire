// Source-health classification shared by saved samples now and the connected cache later.
// Acquisition time, retrieval time and the last attempt are separate clocks.

export type SourceState = 'sample' | 'sample-empty' | 'ok' | 'empty' | 'stale' | 'error' | 'offline' | 'loading';

export interface SourceInput {
  delivery: 'saved_sample' | 'connected';
  loading?: boolean;
  error?: string | null;
  online?: boolean;
  count?: number | null; // valid records in the snapshot, when countable
  lastSuccessUtc?: string | null;
  staleAfterMs?: number; // application threshold for the connected cache
  now?: number;
}

export function classifySource(s: SourceInput): SourceState {
  if (s.loading) return 'loading';
  if (s.error) return s.online === false ? 'offline' : 'error';
  if (s.delivery === 'saved_sample') return s.count === 0 ? 'sample-empty' : 'sample';
  if (s.lastSuccessUtc && s.staleAfterMs && (s.now ?? Date.now()) - Date.parse(s.lastSuccessUtc) > s.staleAfterMs) return 'stale';
  return s.count === 0 ? 'empty' : 'ok';
}

export const STATE_TEXT: Record<SourceState, string> = {
  sample: 'Saved sample, not live',
  'sample-empty': 'Saved sample, valid empty response',
  ok: 'Updated',
  empty: 'No records returned for this window',
  stale: 'Stale: last refresh older than threshold',
  error: 'Failed to load',
  offline: 'Offline: could not reach data',
  loading: 'Loading…',
};
