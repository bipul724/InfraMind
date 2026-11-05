// utils/tempCleanup.js (T-411): which temp/<id> directories startup and periodic cleanup
// remove. Offline: a temporary directory per test and a stub session lookup, no store.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FINISHED_STATUSES, removeSessionDirectories, removeSessionDirectory } from '../utils/tempCleanup.js';

let tempDir;
let outsideDir;
beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-temp-cleanup-'));
  outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-temp-cleanup-outside-'));
});
afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

const exists = (p) => fs.lstat(p).then(() => true, () => false);
// A session directory as a clone leaves it: temp/<id>/repo/<file>
const makeSessionDir = async (id = crypto.randomUUID()) => {
  await fs.mkdir(path.join(tempDir, id, 'repo'), { recursive: true });
  await fs.writeFile(path.join(tempDir, id, 'repo', 'README.md'), 'x');
  return id;
};
// getSession stub: answers from a map of id -> session (or a function that throws)
const lookupFrom = (sessions) => async (id) => {
  const value = sessions[id];
  if (typeof value === 'function') return value();
  return value ?? null;
};
const storeDown = () => { throw new Error('session store unavailable'); };

describe('removeSessionDirectories', () => {
  test('a directory whose session lookup throws (store unavailable) is kept', async () => {
    const id = await makeSessionDir();
    const removed = await removeSessionDirectories({ tempDir, getSession: lookupFrom({ [id]: storeDown }) });
    assert.equal(removed, 0);
    assert.equal(await exists(path.join(tempDir, id, 'repo', 'README.md')), true);
  });

  test('a lookup that rejects (async store error) also keeps the directory', async () => {
    const id = await makeSessionDir();
    const removed = await removeSessionDirectories({ tempDir, getSession: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal(removed, 0);
    assert.equal(await exists(path.join(tempDir, id)), true);
  });

  test('sessions still in use (analyzing, cloned) keep their directories', async () => {
    const analyzing = await makeSessionDir();
    const cloned = await makeSessionDir();
    const removed = await removeSessionDirectories({
      tempDir,
      getSession: lookupFrom({ [analyzing]: { status: 'analyzing' }, [cloned]: { status: 'cloned' } })
    });
    assert.equal(removed, 0);
    assert.equal(await exists(path.join(tempDir, analyzing)), true);
    assert.equal(await exists(path.join(tempDir, cloned)), true);
  });

  test('completed, failed, missing (null) and deleted sessions lose their directories', async () => {
    const completed = await makeSessionDir();
    const failed = await makeSessionDir();
    const orphan = await makeSessionDir();
    const deleted = await makeSessionDir();
    const lookups = [];
    const getSession = async (id) => {
      lookups.push(id);
      return { [completed]: { status: 'completed' }, [failed]: { status: 'failed' }, [deleted]: { status: 'analyzing' } }[id] ?? null;
    };
    const removed = await removeSessionDirectories({ tempDir, deletedIds: [deleted], getSession });
    assert.equal(removed, 4);
    for (const id of [completed, failed, orphan, deleted]) assert.equal(await exists(path.join(tempDir, id)), false, id);
    // A deleted id is removed without asking the store (its row is already gone)
    assert.ok(!lookups.includes(deleted));
  });

  test('a store error for one directory does not stop the others being cleaned', async () => {
    const kept = await makeSessionDir();
    const finished = await makeSessionDir();
    const removed = await removeSessionDirectories({ tempDir, getSession: lookupFrom({ [kept]: storeDown, [finished]: { status: 'completed' } }) });
    assert.equal(removed, 1);
    assert.equal(await exists(path.join(tempDir, kept)), true);
    assert.equal(await exists(path.join(tempDir, finished)), false);
  });

  test('a non-UUID directory, a UUID-named symlink (and its target) and a UUID-named file are untouched', async () => {
    await fs.mkdir(path.join(tempDir, 'not-a-session', 'repo'), { recursive: true });
    await fs.writeFile(path.join(outsideDir, 'keep.txt'), 'outside');
    const linkId = crypto.randomUUID();
    await fs.symlink(outsideDir, path.join(tempDir, linkId), 'dir');
    const fileId = crypto.randomUUID();
    await fs.writeFile(path.join(tempDir, fileId), 'a file');
    const lookups = [];
    // Every lookup says "finished": only the entry checks can keep these
    const getSession = async (id) => { lookups.push(id); return { status: 'completed' }; };

    const removed = await removeSessionDirectories({ tempDir, deletedIds: [linkId, fileId], getSession });
    assert.equal(removed, 0);
    assert.equal(await exists(path.join(tempDir, 'not-a-session', 'repo')), true);
    assert.equal((await fs.lstat(path.join(tempDir, linkId))).isSymbolicLink(), true, 'the symlink itself is kept');
    assert.equal(await fs.readFile(path.join(outsideDir, 'keep.txt'), 'utf8'), 'outside', 'its target is untouched');
    assert.equal(await fs.readFile(path.join(tempDir, fileId), 'utf8'), 'a file');
    assert.deepEqual(lookups, [], 'no lookup for entries that are not UUID directories');
  });

  test('a missing tempDir returns 0', async () => {
    const missing = path.join(tempDir, 'does-not-exist');
    assert.equal(await removeSessionDirectories({ tempDir: missing, getSession: async () => null }), 0);
  });

  test('FINISHED_STATUSES is exactly completed and failed', () => {
    assert.deepEqual([...FINISHED_STATUSES].sort(), ['completed', 'failed']);
  });
});

describe('removeSessionDirectory', () => {
  test('removes a UUID directory and resolves true', async () => {
    const id = await makeSessionDir();
    assert.equal(await removeSessionDirectory(tempDir, id), true);
    assert.equal(await exists(path.join(tempDir, id)), false);
  });

  test('a non-UUID name, a missing directory, a UUID-named symlink and a UUID-named file resolve false and are untouched', async () => {
    await fs.mkdir(path.join(tempDir, 'not-a-session'));
    assert.equal(await removeSessionDirectory(tempDir, 'not-a-session'), false);
    assert.equal(await exists(path.join(tempDir, 'not-a-session')), true);
    assert.equal(await removeSessionDirectory(tempDir, '../outside'), false);

    assert.equal(await removeSessionDirectory(tempDir, crypto.randomUUID()), false, 'missing');

    await fs.writeFile(path.join(outsideDir, 'keep.txt'), 'outside');
    const linkId = crypto.randomUUID();
    await fs.symlink(outsideDir, path.join(tempDir, linkId), 'dir');
    assert.equal(await removeSessionDirectory(tempDir, linkId), false);
    assert.equal((await fs.lstat(path.join(tempDir, linkId))).isSymbolicLink(), true);
    assert.equal(await fs.readFile(path.join(outsideDir, 'keep.txt'), 'utf8'), 'outside');

    const fileId = crypto.randomUUID();
    await fs.writeFile(path.join(tempDir, fileId), 'a file');
    assert.equal(await removeSessionDirectory(tempDir, fileId), false);
    assert.equal(await exists(path.join(tempDir, fileId)), true);
  });
});
