// Small invalidation boundary: no provider credentials, database or network access here.
let revision = 0;
const listeners = new Set<() => void>();
export function gscHistoryRevision(): number { return revision; }
export function invalidateGscHistory(): void {
  revision++;
  for (const listener of listeners) listener();
}
export function onGscHistoryInvalidation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
