import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cloneRepository, buildGitEnv, getCloneLimits, CloneError } from '../utils/git.js';

let tempRoot;

before(async () => {
  tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-git-test-')));
});

after(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

const newDestination = () => path.join(tempRoot, crypto.randomUUID(), 'repo');

const exists = async (target) => {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
};

// Fake runner that records its arguments and creates a tiny checkout
const recordingRunner = (calls) => async (args, options) => {
  calls.push({ args, options });
  const destination = args[args.length - 1];
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'README'), 'hi');
  return { stdout: '', stderr: '' };
};

describe('cloneRepository argv', () => {
  test('uses a fixed, credential-free URL and hardened options', async () => {
    const calls = [];
    const token = 'ghp_' + 'a'.repeat(36);
    await cloneRepository(
      { owner: 'o', repo: 'r', token, destination: newDestination() },
      { runGit: recordingRunner(calls) }
    );

    const { args } = calls[0];
    const url = args[args.length - 2];
    assert.equal(url, 'https://github.com/o/r.git');
    assert.ok(!url.includes('@'));
    assert.ok(!args.join(' ').includes(token), 'token must not appear in argv');

    for (const expected of ['--depth', '1', '--', 'core.symlinks=false', 'protocol.allow=never', 'credential.helper=', '--single-branch', '--no-tags']) {
      assert.ok(args.includes(expected), `argv should include ${expected}`);
    }
    assert.equal(args[args.indexOf('--depth') + 1], '1');
    assert.equal(args.indexOf('--'), args.length - 3, '-- must come right before the URL');
  });
});

describe('cloneRepository environment', () => {
  test('disables prompts and ignores system/global config; no header without a token', async () => {
    const calls = [];
    await cloneRepository(
      { owner: 'o', repo: 'r', destination: newDestination() },
      { runGit: recordingRunner(calls) }
    );

    const { env } = calls[0].options;
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(env.GIT_CONFIG_GLOBAL, os.devNull);
    assert.equal(env.GCM_INTERACTIVE, 'never');
    assert.ok(!Object.keys(env).some((key) => key.startsWith('GIT_CONFIG_KEY') || key.startsWith('GIT_CONFIG_VALUE')));
    assert.equal(env.GIT_CONFIG_COUNT, undefined);
  });

  test('passes the token only as an Authorization header in the environment', async () => {
    const calls = [];
    const token = 'gho_' + 'B'.repeat(36);
    const before = JSON.stringify(process.env);
    await cloneRepository(
      { owner: 'o', repo: 'r', token, destination: newDestination() },
      { runGit: recordingRunner(calls) }
    );

    const { args, options } = calls[0];
    const expectedHeader = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
    assert.equal(options.env.GIT_CONFIG_COUNT, '1');
    assert.equal(options.env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
    assert.equal(options.env.GIT_CONFIG_VALUE_0, expectedHeader);
    assert.ok(!args.some((arg) => arg.includes(token)));
    assert.equal(JSON.stringify(process.env), before, 'process.env must not be mutated');
  });

  test('drops inherited git variables such as GIT_ASKPASS', () => {
    const env = buildGitEnv(null, {
      PATH: '/usr/bin',
      GIT_ASKPASS: '/editor/askpass.sh',
      SSH_ASKPASS: '/x',
      GIT_CONFIG_PARAMETERS: "'credential.helper=osxkeychain'",
      GIT_TRACE_CURL: '1'
    });
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.GIT_ASKPASS, undefined);
    assert.equal(env.SSH_ASKPASS, undefined);
    assert.equal(env.GIT_CONFIG_PARAMETERS, undefined);
    assert.equal(env.GIT_TRACE_CURL, undefined);
  });

  test('rejects tokens that could inject header lines', async () => {
    const destination = newDestination();
    await assert.rejects(
      cloneRepository({ owner: 'o', repo: 'r', token: 'abc\r\nX-Injected: 1', destination }, { runGit: recordingRunner([]) }),
      (error) => error instanceof CloneError && error.code === 'CLONE_FAILED'
    );
  });
});

describe('cloneRepository failures', () => {
  test('auth failure is REPO_NOT_FOUND and never exposes the token or path', async () => {
    const token = 'ghp_' + 'Z'.repeat(36);
    const destination = newDestination();
    const runGit = async (args) => {
      await fs.mkdir(args[args.length - 1], { recursive: true });
      const error = new Error(`Command failed: git clone https://${token}@github.com/o/r.git ${destination}`);
      error.code = 128;
      error.stderr = `Cloning into '${destination}'...\nremote: Repository not found.\nfatal: repository 'https://${token}@github.com/o/r.git/' not found\n`;
      throw error;
    };

    await assert.rejects(
      cloneRepository({ owner: 'o', repo: 'r', token, destination }, { runGit }),
      (error) => {
        assert.ok(error instanceof CloneError);
        assert.equal(error.code, 'REPO_NOT_FOUND');
        assert.equal(error.status, 404);
        assert.equal(error.publicMessage, 'Repository not found or access denied');
        for (const text of [error.publicMessage, error.message, String(error.stack)]) {
          assert.ok(!text.includes(token));
          assert.ok(!text.includes(destination));
          assert.ok(!text.includes(tempRoot));
        }
        // Server-side details are redacted too
        assert.ok(!error.details.includes(token));
        assert.ok(!error.details.includes(tempRoot));
        return true;
      }
    );

    assert.equal(await exists(path.dirname(destination)), false, 'session directory must be removed');
  });

  test('timeout is CLONE_TIMEOUT', async () => {
    const destination = newDestination();
    const runGit = async () => {
      const error = new Error('Command failed: git clone');
      error.killed = true;
      error.signal = 'SIGKILL';
      throw error;
    };

    await assert.rejects(
      cloneRepository({ owner: 'o', repo: 'r', destination, timeoutMs: 5 }, { runGit }),
      (error) => error instanceof CloneError && error.code === 'CLONE_TIMEOUT' && error.status === 504
    );
    assert.equal(await exists(path.dirname(destination)), false);
  });

  test('passes the configured timeout to git', async () => {
    const calls = [];
    await cloneRepository(
      { owner: 'o', repo: 'r', destination: newDestination(), timeoutMs: 4321 },
      { runGit: recordingRunner(calls) }
    );
    assert.equal(calls[0].options.timeoutMs, 4321);
  });

  test('a checkout over the size cap is REPO_TOO_LARGE and is removed', async () => {
    const destination = newDestination();
    const runGit = async (args) => {
      const target = args[args.length - 1];
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, 'big.bin'), Buffer.alloc(4096));
      return { stdout: '', stderr: '' };
    };

    await assert.rejects(
      cloneRepository({ owner: 'o', repo: 'r', destination, maxSizeBytes: 1024 }, { runGit }),
      (error) => error instanceof CloneError && error.code === 'REPO_TOO_LARGE' && error.status === 413
    );
    assert.equal(await exists(path.dirname(destination)), false);
  });

  test('size check does not follow symlinks', async () => {
    const destination = newDestination();
    const runGit = async (args) => {
      const target = args[args.length - 1];
      await fs.mkdir(target, { recursive: true });
      await fs.symlink('/', path.join(target, 'rootlink'));
      return { stdout: '', stderr: '' };
    };

    await cloneRepository({ owner: 'o', repo: 'r', destination, maxSizeBytes: 1024 * 1024 }, { runGit });
    assert.equal(await exists(destination), true);
  });

  test('refuses destinations outside the <uuid>/repo layout without deleting anything', async () => {
    const victim = path.join(tempRoot, 'not-a-session');
    await fs.mkdir(victim, { recursive: true });
    const runGit = async () => { throw new Error('should not run'); };

    await assert.rejects(
      cloneRepository({ owner: 'o', repo: 'r', destination: path.join(victim, 'repo') }, { runGit }),
      (error) => error instanceof CloneError && error.code === 'CLONE_FAILED'
    );
    assert.equal(await exists(victim), true);
  });
});

describe('getCloneLimits', () => {
  test('uses defaults and ignores invalid values', () => {
    assert.deepEqual(getCloneLimits({}), { timeoutMs: 120000, maxSizeBytes: 200 * 1024 * 1024 });
    assert.deepEqual(
      getCloneLimits({ CLONE_TIMEOUT_MS: 'abc', MAX_REPO_SIZE_MB: '-5' }),
      { timeoutMs: 120000, maxSizeBytes: 200 * 1024 * 1024 }
    );
    assert.deepEqual(
      getCloneLimits({ CLONE_TIMEOUT_MS: '5000', MAX_REPO_SIZE_MB: '10' }),
      { timeoutMs: 5000, maxSizeBytes: 10 * 1024 * 1024 }
    );
  });
});
