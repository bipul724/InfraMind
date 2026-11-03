import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentPipeline, scanProjectStructure } from '../agents/index.js';

let fixtureDir;
let outsideDir;
let realFetch;
const capturedBodies = [];

before(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-agents-fixture-'));
  outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-agents-outside-'));

  const outsideJson = path.join(outsideDir, 'outside.json');
  await fs.writeFile(outsideJson, JSON.stringify({ leak: 'SHOULD_NOT_APPEAR', dependencies: { SHOULD_NOT_APPEAR: '1' } }));
  await fs.mkdir(path.join(outsideDir, 'outside-subdir'));
  await fs.writeFile(path.join(outsideDir, 'outside-subdir', 'SHOULD_NOT_APPEAR.txt'), 'x');

  await fs.writeFile(
    path.join(fixtureDir, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { start: 'node index.js' } })
  );
  await fs.writeFile(path.join(fixtureDir, 'index.js'), 'console.log("fixture");\n');
  await fs.symlink('/', path.join(fixtureDir, 'rootlink'), 'dir');
  await fs.symlink(outsideJson, path.join(fixtureDir, 'secret.json'));
  await fs.symlink(path.join(outsideDir, 'outside-subdir'), path.join(fixtureDir, 'outsidelink'), 'dir');
  await fs.mkdir(path.join(fixtureDir, 'nested'));
  await fs.symlink(outsideJson, path.join(fixtureDir, 'nested', 'package.json'));

  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    capturedBodies.push(String(options.body ?? ''));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'ok' } }] })
    };
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(fixtureDir, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

describe('scanProjectStructure', () => {
  test('records regular files and directories and skips every symlink', async () => {
    const structure = await scanProjectStructure(fixtureDir);
    assert.deepEqual(
      Object.keys(structure).sort(),
      ['index.js', 'nested', 'package.json'].sort()
    );
    assert.equal(structure.nested, 'directory');
  });
});

describe('runAgentPipeline with untrusted repository content', () => {
  test('never sends paths, symlink targets or symlinked content to the LLM', { timeout: 60000 }, async () => {
    const result = await runAgentPipeline('octocat/Hello-World', fixtureDir);

    assert.ok(capturedBodies.length > 0, 'the stubbed LLM should have been called');

    const forbidden = [
      fixtureDir,
      await fs.realpath(fixtureDir),
      outsideDir,
      os.tmpdir(),
      await fs.realpath(os.tmpdir()),
      'SHOULD_NOT_APPEAR',
      'rootlink',
      'outsidelink',
      'secret.json'
    ];
    for (const body of capturedBodies) {
      for (const value of forbidden) {
        assert.ok(!body.includes(value), `LLM request body must not contain ${value}`);
      }
    }

    assert.ok(capturedBodies[0].includes('octocat/Hello-World'), 'planner prompt should name the repository');

    const structureKeys = Object.keys(result.projectStructure);
    assert.ok(!structureKeys.some((key) => key.startsWith('rootlink')));
    assert.ok(!structureKeys.some((key) => key.startsWith('outsidelink')));
    const analysis = JSON.stringify(result.codebaseAnalysis);
    assert.ok(!analysis.includes('SHOULD_NOT_APPEAR'));
    assert.ok(!analysis.includes('rootlink'));

    // The real (non-symlinked) manifest is still analyzed
    assert.deepEqual(result.codebaseAnalysis.buildCommands, ['npm start']);
    assert.equal(result.techStack.primary, 'node');
  });
});
