import { apiFetch } from '@/lib/apiClient';
import type { SessionFilesResponse } from '@/lib/session';

// GET /api/files/:sessionId per session id, for this page load and this signed-in user:
// the file viewer, the review and Save in AgentProgress all read it, so a completed run is
// loaded at most once. Module level, not component state, because tab switches unmount
// AgentProgress (Radix TabsContent), and a remount must neither load the files again nor
// forget that they were saved.
//
// Per-user state (T-133): AuthContext calls clearResultCache whenever the signed-in user
// id changes, sign-out included. Sign-out does not reload the page.
const results = new Map<string, SessionFilesResponse>();
const loads = new Map<string, Promise<SessionFilesResponse | null>>();
// Sessions saved to the account: their Save button stays "Saved", so a second click cannot
// insert the same rows again. Not persisted: a reload or a new tab starts over.
const saved = new Set<string>();
// A save in flight, which a remount must not repeat
const saving = new Set<string>();

// Bumped by clearResultCache. A load or save that began before a clear compares its
// generation before writing, so it cannot put a previous user's result back.
let generation = 0;

export const currentGeneration = (): number => generation;

export function clearResultCache(): void {
  generation += 1;
  results.clear();
  loads.clear();
  saved.clear();
  saving.clear();
}

export const getCachedResult = (id: string): SessionFilesResponse | undefined => results.get(id);

// Stores a result that was loaded elsewhere (the status poller), unless the cache has been
// cleared since `startedIn`
export function storeResult(id: string, data: SessionFilesResponse, startedIn: number): boolean {
  if (startedIn !== generation) return false;
  results.set(id, data);
  return true;
}

// Loads GET /api/files/:id once: a load in flight is joined, not repeated. Resolves null
// when the cache was cleared while the request was in flight (the result is dropped).
export function loadResult(id: string): Promise<SessionFilesResponse | null> {
  const pending = loads.get(id);
  if (pending) return pending;
  const startedIn = generation;
  const load = (async () => {
    const response = await apiFetch(`/api/files/${id}`);
    if (!response.ok) throw new Error(`GET /api/files answered ${response.status}`);
    const data: SessionFilesResponse = await response.json();
    return storeResult(id, data, startedIn) ? data : null;
  })();
  loads.set(id, load);
  // A failed load can be tried again; only this generation's entry is removed
  load.catch(() => {
    if (loads.get(id) === load) loads.delete(id);
  });
  return load;
}

export const isSaved = (id: string): boolean => saved.has(id);
export const isSaving = (id: string): boolean => saving.has(id);

export function markSaving(id: string): void {
  saving.add(id);
}

// After a save: records it as saved unless the cache was cleared meanwhile
export function finishSaving(id: string, succeeded: boolean, startedIn: number): void {
  if (startedIn !== generation) return;
  saving.delete(id);
  if (succeeded) saved.add(id);
}
