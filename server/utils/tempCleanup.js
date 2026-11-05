// Removal of the per-session clone directories under the server's temp directory. Moved
// out of server.js (T-411) so the rules can be unit-tested with a temporary directory and
// a stub session lookup; server.js passes TEMP_DIR and (id) => sessionStore.get(id).
// Neither function ever throws.
import fs from 'fs-extra';
import path from 'path';
import { isUuidV4 } from './repository.js';

// Sessions in these states have their results in the store; nothing reads their clone
export const FINISHED_STATUSES = new Set(['completed', 'failed']);

// Removes <tempDir>/<sessionId> for one session: only a real directory (not a symlink)
// directly under tempDir whose name is a UUID v4. Resolves true when it was removed.
export async function removeSessionDirectory(tempDir, sessionId) {
  if (!isUuidV4(sessionId)) return false;
  const target = path.join(tempDir, sessionId);
  try {
    if (!(await fs.lstat(target)).isDirectory()) return false;
    await fs.remove(target);
    return true;
  } catch {
    return false;
  }
}

// Removes the directories under tempDir that are no longer needed: deleted sessions
// (deletedIds), orphans (getSession resolves null, e.g. left by a crash) and finished
// sessions (completed or failed), which nothing reads from disk. Only directories directly
// under tempDir whose names are UUID v4 are considered; symlinks, files and other names are
// never touched. A directory whose session cannot be looked up (getSession throws: the
// store is unavailable) is kept, so a store outage never deletes a running clone.
// Resolves the number of directories removed; 0 when tempDir cannot be read.
export async function removeSessionDirectories({ tempDir, deletedIds = [], getSession }) {
  let entries;
  try {
    entries = await fs.readdir(tempDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const deleted = new Set(deletedIds);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !isUuidV4(entry.name)) continue;
    let remove = deleted.has(entry.name);
    if (!remove) {
      try {
        const session = await getSession(entry.name);
        remove = !session || FINISHED_STATUSES.has(session.status);
      } catch {
        continue;
      }
    }
    if (remove && await removeSessionDirectory(tempDir, entry.name)) removed++;
  }
  return removed;
}
