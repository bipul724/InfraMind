import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AGENT_SEQUENCE, analyzeTechStack, performDetailedAnalysis, runAgentPipeline, scanProjectStructure } from '../agents/index.js';
import { findDockerfiles } from '../agents/grounding.js';
import { resetDefaultAiClient } from '../ai/index.js';
import { generatorUserPrompt } from '../agents/prompts.js';
import { defaultContentFor, generatorKindOf } from './fakeLlm.js';

let fixtureDir;
let outsideDir;
let realFetch;
const capturedBodies = [];
const capturedRequests = [];

// B1.3 used LLAMA_API_*; the AI layer reads these instead. Base URLs are local and
// unreachable: the stubbed fetch answers every request.
const STUB_KEY = 'test-agents-key-AGENTS_KEY_MARKER';
const AI_ENV = {
  AI_PROVIDERS: 'gemini,groq',
  GEMINI_API_KEY: STUB_KEY,
  GEMINI_MODEL: 'test-model-gemini',
  GEMINI_BASE_URL: 'http://127.0.0.1:9/gemini',
  GROQ_API_KEY: STUB_KEY,
  GROQ_MODEL: 'test-model-groq',
  GROQ_BASE_URL: 'http://127.0.0.1:9/groq',
  AI_TIMEOUT_MS: '2000',
  AI_CALL_BUDGET_MS: '10000',
  AI_MAX_ATTEMPTS_PER_PROVIDER: '1'
};
const savedEnv = {};
let stubMode = 'ok';
// Optional per-request failure: (requestBody) => true fails that request (SERVER-FIX)
let failWhen = null;
// B2.5: the generator's user prompts come from agents/prompts.js
const PROMPTS = {
  dockerfile: generatorUserPrompt('dockerfile'),
  githubActions: generatorUserPrompt('githubActions'),
  envExample: generatorUserPrompt('envExample'),
  verifier: 'Verify and validate all generated files'
};
const countRequests = (bodies, prompt) => bodies.filter((body) => body.includes(prompt)).length;
const ERROR_BODY_MARKER = 'SECRET_BODY_MARKER';
// The removed planner agent's system prompt began with this (B2.6)
const OLD_PLANNER_PROMPT = 'You are a DevOps Planning Agent';

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

  for (const [key, value] of Object.entries(AI_ENV)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  resetDefaultAiClient();

  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    capturedBodies.push(String(options.body ?? ''));
    capturedRequests.push({ url: String(url), headers: { ...options.headers } });
    if (stubMode === 'fail' || (failWhen && failWhen(String(options.body ?? '')))) {
      // A provider error body that echoes the key and a marker: neither may reach the result
      return new Response(JSON.stringify({ error: { message: `${ERROR_BODY_MARKER} invalid key ${STUB_KEY}` } }), { status: 500 });
    }
    // B2.5: generator calls get a valid file of the kind they ask for (a chat-style reply);
    // every other call gets 'ok'
    let parsed = null;
    try { parsed = JSON.parse(String(options.body ?? '')); } catch { /* not JSON */ }
    const content = generatorKindOf(parsed) ? defaultContentFor(parsed) : 'ok';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetDefaultAiClient();
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

    assert.ok(capturedBodies[0].includes(PROMPTS.dockerfile), 'the first request is the Dockerfile generator call');
    assert.ok(capturedBodies[0].includes('octocat/Hello-World'), 'the generator prompt names the repository');

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

describe('agent errors reaching state.errors (sent to the browser)', () => {
  test('a provider failure becomes the fixed AI message; no body or key leaks', { timeout: 60000 }, async () => {
    resetDefaultAiClient();
    stubMode = 'fail';
    const requestsBefore = capturedRequests.length;
    let result;
    try {
      result = await runAgentPipeline('octocat/Hello-World', fixtureDir);
    } finally {
      stubMode = 'ok';
      resetDefaultAiClient();
    }

    // SERVER-FIX: one entry per failed generator call; with no files the verifier
    // makes no call, so it reports no error
    assert.deepEqual(result.errors, [
      'Generator Agent Error: Dockerfile: AI providers are unavailable',
      'Generator Agent Error: GitHub Actions workflow: AI providers are unavailable',
      'Generator Agent Error: .env.example: AI providers are unavailable'
    ]);
    const serialised = JSON.stringify(result);
    assert.ok(!serialised.includes(ERROR_BODY_MARKER));
    assert.ok(!serialised.includes(STUB_KEY));

    // The chain was followed: gemini, then groq, for each failed call
    const urls = capturedRequests.slice(requestsBefore).map((r) => r.url);
    assert.ok(urls.some((u) => u.startsWith('http://127.0.0.1:9/gemini/')));
    assert.ok(urls.some((u) => u.startsWith('http://127.0.0.1:9/groq/')));
  });

  test('a non-AI error becomes "Internal error", never its raw message', { timeout: 60000 }, async () => {
    // An invalid AI configuration makes the AI layer throw AiConfigError (not AiError)
    resetDefaultAiClient();
    const saved = process.env.AI_PROVIDERS;
    process.env.AI_PROVIDERS = 'not-a-provider-NONAI_MARKER';
    let result;
    try {
      result = await runAgentPipeline('octocat/Hello-World', fixtureDir);
    } finally {
      process.env.AI_PROVIDERS = saved;
      resetDefaultAiClient();
    }
    assert.deepEqual(result.errors, [
      'Generator Agent Error: Dockerfile: Internal error',
      'Generator Agent Error: GitHub Actions workflow: Internal error',
      'Generator Agent Error: .env.example: Internal error'
    ]);
    const serialised = JSON.stringify(result.errors);
    assert.ok(!serialised.includes('AI_PROVIDERS'));
    assert.ok(!serialised.includes('NONAI_MARKER'));
  });

  test('meta reaches no provider request', { timeout: 60000 }, async () => {
    resetDefaultAiClient();
    const before = capturedBodies.length;
    const meta = { sessionId: 'SESSION_ID_MARKER', userId: 'USER_ID_MARKER' };
    const result = await runAgentPipeline('octocat/Hello-World', fixtureDir, null, meta);
    assert.deepEqual(result.errors, []);
    const sent = capturedBodies.slice(before);
    assert.equal(sent.length, 4, '3 generator calls + verifier');
    assert.equal(countRequests(sent, OLD_PLANNER_PROMPT), 0, 'no planner call');
    for (const body of sent) {
      assert.ok(!body.includes('SESSION_ID_MARKER'));
      assert.ok(!body.includes('USER_ID_MARKER'));
    }
  });
});

describe('B2.6: three agents, no planner', () => {
  test('AGENT_SEQUENCE is analyzer, generator, verifier with 50, 80 and 95', () => {
    assert.deepEqual(AGENT_SEQUENCE.map(({ agent, progress }) => [agent, progress]), [
      ['analyzer', 50], ['generator', 80], ['verifier', 95]
    ]);
  });

  test('a successful run makes 4 AI calls (3 generator, 1 verifier) and none carries the planner prompt', { timeout: 60000 }, async () => {
    resetDefaultAiClient();
    const before = capturedBodies.length;
    const result = await runAgentPipeline('octocat/Hello-World', fixtureDir);
    const sent = capturedBodies.slice(before);
    assert.deepEqual(result.errors, []);
    assert.equal(sent.length, 4);
    assert.deepEqual([PROMPTS.dockerfile, PROMPTS.githubActions, PROMPTS.envExample, PROMPTS.verifier].map((p) => countRequests(sent, p)), [1, 1, 1, 1]);
    assert.equal(countRequests(sent, OLD_PLANNER_PROMPT), 0);
    assert.ok(!result.messages.some((m) => m.agent === 'planner'));
    assert.equal(result.analysisplan, undefined);
  });
});

describe('B2.1: onAgentDone after each agent', () => {
  test('called three times, in order, with the agent\'s progress value and copies of the arrays', { timeout: 60000 }, async () => {
    resetDefaultAiClient();
    const reports = [];
    let firstMessagesRef = null;
    const result = await runAgentPipeline('octocat/Hello-World', fixtureDir, (report) => {
      if (!firstMessagesRef) firstMessagesRef = report.messages;
      reports.push(structuredClone(report));
    });
    assert.deepEqual(reports.map((r) => [r.agent, r.progress, r.messages.length]), [
      ['analyzer', 50, 1], ['generator', 80, 2], ['verifier', 95, 3]
    ]);
    assert.deepEqual(Object.keys(reports[0]).sort(), ['agent', 'currentStep', 'errors', 'messages', 'progress']);
    assert.equal(reports[0].currentStep, 'Analyzing codebase structure');
    assert.equal(reports[2].currentStep, 'Complete');
    assert.deepEqual(reports[2].messages, result.messages);
    assert.notEqual(firstMessagesRef, result.messages, 'a copy, not the state\'s own array');
    assert.equal(firstMessagesRef.length, 1, 'later agents do not change an earlier report');
  });

  test('a throwing callback stops the pipeline with that error', { timeout: 60000 }, async () => {
    resetDefaultAiClient();
    const seen = [];
    await assert.rejects(
      runAgentPipeline('octocat/Hello-World', fixtureDir, (report) => {
        seen.push(report.agent);
        if (report.agent === 'generator') throw new Error('callback failed');
      }),
      /callback failed/
    );
    assert.deepEqual(seen, ['analyzer', 'generator']);
  });
});

describe('generator and verifier (SERVER-FIX)', () => {
  const run = async (predicate) => {
    resetDefaultAiClient();
    failWhen = predicate;
    const before = capturedBodies.length;
    try {
      const result = await runAgentPipeline('octocat/Hello-World', fixtureDir);
      return { result, bodies: capturedBodies.slice(before) };
    } finally {
      failWhen = null;
      resetDefaultAiClient();
    }
  };

  test('one failed generator call keeps the other two files', { timeout: 60000 }, async () => {
    const { result, bodies } = await run((body) => body.includes(PROMPTS.dockerfile));
    assert.deepEqual(Object.keys(result.generatedFiles), ['githubActions', 'envExample']);
    assert.deepEqual(result.errors, ['Generator Agent Error: Dockerfile: AI providers are unavailable']);
    assert.equal(result.errors.filter((error) => error.startsWith('Generator Agent Error:')).length, 1);
    const generator = result.messages.filter((m) => m.agent === 'generator');
    assert.deepEqual(generator.map((m) => m.message), ['Generated 2 of 3 files']);
    assert.equal(countRequests(bodies, PROMPTS.verifier), 1, 'the verifier still reviews the files that exist');
    assert.ok(result.messages.some((m) => m.agent === 'verifier'));
    assert.equal(result.progress, 100);
  });

  test('all three generator calls fail: no files, three errors, no verifier call or message', { timeout: 60000 }, async () => {
    const generatorPrompts = [PROMPTS.dockerfile, PROMPTS.githubActions, PROMPTS.envExample];
    const { result, bodies } = await run((body) => generatorPrompts.some((prompt) => body.includes(prompt)));
    assert.deepEqual(result.generatedFiles, {});
    assert.deepEqual(result.errors, [
      'Generator Agent Error: Dockerfile: AI providers are unavailable',
      'Generator Agent Error: GitHub Actions workflow: AI providers are unavailable',
      'Generator Agent Error: .env.example: AI providers are unavailable'
    ]);
    assert.equal(countRequests(bodies, PROMPTS.verifier), 0, 'no verifier AI call');
    assert.ok(!result.messages.some((m) => m.agent === 'verifier'), 'no verifier message');
    assert.ok(!result.messages.some((m) => m.agent === 'generator'), 'no generator message without files');
    assert.equal(result.verificationResults, undefined);
    assert.equal(result.progress, 100);
    assert.equal(result.currentStep, 'Review skipped: no files were generated');
  });

  test('a successful verifier reports a neutral message, never "production ready"', { timeout: 60000 }, async () => {
    const { result } = await run(null);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.messages.find((m) => m.agent === 'verifier')?.message, 'Review complete: see the review text');
    assert.deepEqual(result.messages.find((m) => m.agent === 'generator')?.message, 'Generated 3 of 3 files');
    assert.equal(result.verificationResults, 'ok');
    assert.ok(!JSON.stringify(result.messages).toLowerCase().includes('production ready'));
  });
});

describe('analyzeTechStack: kubernetes and compose detection (SERVER-FIX)', () => {
  // Builds a fixture repository from relative file paths, then runs the analyzer's own scan
  const detect = async (files) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-detect-'));
    try {
      for (const file of files) {
        await fs.mkdir(path.join(dir, path.dirname(file)), { recursive: true });
        await fs.writeFile(path.join(dir, file), 'x: 1\n');
      }
      return (await analyzeTechStack(dir, await scanProjectStructure(dir))).tools;
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };

  const cases = [
    { files: ['pnpm-lock.yaml'], kubernetes: false, compose: false },
    { files: ['.pre-commit-config.yaml'], kubernetes: false, compose: false },
    { files: ['.github/workflows/ci.yml', 'config/settings.yaml', 'helm/values.yaml'], kubernetes: false, compose: false },
    { files: ['k8s/deployment.yaml'], kubernetes: true, compose: false },
    { files: ['deploy/kubernetes/service.yml'], kubernetes: true, compose: false },
    { files: ['charts/app/Chart.yaml'], kubernetes: true, compose: false },
    { files: ['kustomization.yml'], kubernetes: true, compose: false },
    { files: ['overlays/prod/kustomization.yaml'], kubernetes: true, compose: false },
    { files: ['compose.yaml'], kubernetes: false, compose: true },
    { files: ['compose.yml'], kubernetes: false, compose: true },
    { files: ['docker-compose.yml'], kubernetes: false, compose: true },
    { files: ['docker-compose.yaml'], kubernetes: false, compose: true },
    { files: ['services/api/docker-compose.yml'], kubernetes: false, compose: false }
  ];

  for (const { files, kubernetes, compose } of cases) {
    test(`${files.join(', ')}: kubernetes ${kubernetes}, docker-compose ${compose}`, async () => {
      const tools = await detect(files);
      assert.equal(tools.includes('kubernetes'), kubernetes, JSON.stringify(tools));
      assert.equal(tools.includes('docker-compose'), compose, JSON.stringify(tools));
    });
  }

  test('a Kubernetes directory found inside a skipped directory does not count', async () => {
    assert.ok(!(await detect(['node_modules/pkg/k8s/deployment.yaml'])).includes('kubernetes'));
  });
});

describe('T-243: Dockerfiles at any depth', () => {
  // projectStructure as scanProjectStructure builds it: platform separators, directories included
  const structure = (files) => {
    const result = {};
    for (const file of files) {
      const segments = file.split('/');
      for (let i = 1; i < segments.length; i++) result[path.join(...segments.slice(0, i))] = 'directory';
      result[path.join(...segments)] = 'file';
    }
    return result;
  };

  const cases = [
    { name: 'top-level only', files: ['Dockerfile', 'index.js'], expected: ['Dockerfile'] },
    { name: 'nested only', files: ['backend/Dockerfile', 'backend/app.py'], expected: ['backend/Dockerfile'] },
    { name: 'Dockerfile.<suffix>', files: ['docker/Dockerfile.prod'], expected: ['docker/Dockerfile.prod'] },
    { name: '<prefix>.Dockerfile', files: ['api.Dockerfile'], expected: ['api.Dockerfile'] },
    { name: 'lower case', files: ['services/web/dockerfile'], expected: ['services/web/dockerfile'] },
    { name: 'not Dockerfiles', files: ['Dockerfile-notes.md', 'docs/dockerfile-guide.txt', 'MyDockerfile', 'Dockerfile.', '.Dockerfile', 'Dockerfiles/readme.md'], expected: [] },
    // Architect review of B2.6: a documentation, text or image suffix is not a Dockerfile
    {
      name: 'documentation, text and image names are excluded',
      files: ['Dockerfile.md', 'docs/Dockerfile.txt', 'Dockerfile.MARKDOWN', 'Dockerfile.rst', 'Dockerfile.adoc', 'Dockerfile.html', 'Dockerfile.htm',
        'Dockerfile.pdf', 'Dockerfile.png', 'Dockerfile.JPG', 'Dockerfile.jpeg', 'Dockerfile.gif', 'Dockerfile.svg', 'docs/api.Dockerfile.md'],
      expected: []
    },
    {
      name: 'Dockerfile.prod, Dockerfile.dev, api.Dockerfile and Dockerfile.bak still count',
      files: ['Dockerfile.prod', 'Dockerfile.dev', 'api.Dockerfile', 'Dockerfile.bak', 'Dockerfile.md'],
      expected: ['Dockerfile.bak', 'Dockerfile.dev', 'Dockerfile.prod', 'api.Dockerfile']
    },
    {
      name: 'shallowest first, then alphabetical',
      files: ['z/Dockerfile', 'backend/Dockerfile', 'a/b/Dockerfile', 'web.Dockerfile', 'Dockerfile.dev', 'Dockerfile'],
      expected: ['Dockerfile', 'Dockerfile.dev', 'web.Dockerfile', 'backend/Dockerfile', 'z/Dockerfile', 'a/b/Dockerfile']
    }
  ];
  for (const { name, files, expected } of cases) {
    test(`findDockerfiles: ${name}`, () => assert.deepEqual(findDockerfiles(structure(files)), expected));
  }

  test('findDockerfiles: a directory named Dockerfile and a credential-file name never count', () => {
    assert.deepEqual(findDockerfiles({ Dockerfile: 'directory', 'Dockerfile.pem': 'file', [path.join('x', 'Dockerfile.key')]: 'file' }), []);
  });

  // A real repository through the analyzer's own scan
  const analyze = async (files) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-dockerfiles-'));
    try {
      for (const file of files) {
        await fs.mkdir(path.join(dir, path.dirname(file)), { recursive: true });
        await fs.writeFile(path.join(dir, file), 'FROM node:20\n');
      }
      const projectFiles = await scanProjectStructure(dir);
      return {
        tools: (await analyzeTechStack(dir, projectFiles)).tools,
        recommendations: (await performDetailedAnalysis(dir, projectFiles)).recommendations
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };

  test('a repository whose only Dockerfile is backend/Dockerfile: docker detected, no "Add Dockerfile"', async () => {
    const { tools, recommendations } = await analyze(['package.json', 'backend/Dockerfile']);
    assert.ok(tools.includes('docker'), JSON.stringify(tools));
    assert.ok(!recommendations.includes('Add Dockerfile for containerization'), JSON.stringify(recommendations));
  });

  test('no Dockerfile anywhere: no docker tool, and the recommendation stays', async () => {
    const { tools, recommendations } = await analyze(['package.json', 'docs/dockerfile-guide.txt']);
    assert.ok(!tools.includes('docker'));
    assert.ok(recommendations.includes('Add Dockerfile for containerization'));
  });

  test('a .github/workflows directory means no "Add GitHub Actions" recommendation', async () => {
    const { recommendations } = await analyze(['package.json', '.github/workflows/ci.yml']);
    assert.ok(!recommendations.includes('Add GitHub Actions for CI/CD'), JSON.stringify(recommendations));
    const without = await analyze(['package.json']);
    assert.ok(without.recommendations.includes('Add GitHub Actions for CI/CD'));
  });

  test('a Dockerfile inside a skipped directory does not count', async () => {
    assert.ok(!(await analyze(['node_modules/pkg/Dockerfile'])).tools.includes('docker'));
  });
});
