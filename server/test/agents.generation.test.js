// B2.5: the generator's repair path, its grounding in the repository, the prompt caps
// and the verifier's input. The AI layer runs in-process against the local fake LLM
// (fakeLlm.js); every assertion about calls uses the fake's request log.
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GENERATED_FILES, runAgentPipeline } from '../agents/index.js';
import { resetDefaultAiClient, setDefaultAiCallSink } from '../ai/index.js';
import {
  EXISTING_FILE_CAP,
  MANIFEST_FILE_CAP,
  MANIFEST_FILES,
  MANIFEST_TOTAL_CAP,
  TRUNCATED_MARKER,
  collectRepositoryEvidence,
  isForbiddenFileName,
  readRepoFile
} from '../agents/grounding.js';
import { PROMPT_CAP, VERIFIER_FILE_CAP, buildGeneratorSystemPrompt, buildVerifierSystemPrompt } from '../agents/prompts.js';
import { scanProjectStructure } from '../agents/index.js';
import { FAKE_FILES, FAKE_LLM_CONTENT, chatReply, generatorKindOf, replyWith, startFakeLlm } from './fakeLlm.js';

let fake;
const savedEnv = {};
const tempDirs = [];

const systemOf = (request) => request.body.messages.find((m) => m.role === 'system').content;
const userOf = (request) => request.body.messages.find((m) => m.role === 'user').content;
const generatorRequests = (kind) => fake.requests.filter((request) => generatorKindOf(request.body) === kind);
const verifierRequests = () => fake.requests.filter((request) => request.body.messages.some((m) => m.content === 'Verify and validate all generated files'));

async function makeRepo(files, { symlinks = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inframind-b25-'));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    if (relative.endsWith('/')) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  for (const [relative, target] of Object.entries(symlinks)) await fs.symlink(target, path.join(dir, relative));
  return dir;
}

// The pipeline's console output is captured, not printed: this file runs ~100 AI calls,
// and a flood of child-process stdout can break the test runner's own message stream
let lastWarnings = [];
async function run(repoDir) {
  const { log, warn } = console;
  lastWarnings = [];
  console.log = () => {};
  console.warn = (...args) => lastWarnings.push(args.join(' '));
  try {
    return await runAgentPipeline('octocat/fixture', repoDir);
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

before(async () => {
  fake = await startFakeLlm();
  const env = {
    AI_PROVIDERS: 'gemini',
    GEMINI_API_KEY: 'test-b25-key',
    GEMINI_MODEL: 'test-model-gemini',
    GEMINI_BASE_URL: fake.baseUrlFor('gemini'),
    AI_TIMEOUT_MS: '2000',
    AI_CALL_BUDGET_MS: '10000',
    AI_MAX_ATTEMPTS_PER_PROVIDER: '1'
  };
  for (const [key, value] of Object.entries(env)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

after(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetDefaultAiClient();
  await fake.close();
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  // A fresh client: no circuit state carries over between tests. Call records are
  // dropped instead of printed (the sink applies to the next client)
  resetDefaultAiClient();
  setDefaultAiCallSink(() => {});
  fake.reset();
});

const NODE_REPO = { 'package.json': JSON.stringify({ name: 'n', scripts: { start: 'node index.js' } }), 'index.js': 'x' };

describe('generator: one repair attempt, then honest failure', () => {
  test('defaults: three files from chat-style replies, raw content only, 5 calls', async () => {
    const result = await run(await makeRepo(NODE_REPO));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.generatedFiles, { ...FAKE_FILES });
    assert.equal(fake.requests.length, 5);
    for (const content of Object.values(result.generatedFiles)) {
      assert.ok(!content.includes('Here is'), 'no prose in a saved file');
      assert.ok(!content.includes('```'), 'no fence in a saved file');
    }
  });

  test('first reply invalid, repair valid: file saved, exactly 2 calls for it, no error', async () => {
    const PROSE_MARKER = 'INVALID_REPLY_MARKER';
    let dockerCalls = 0;
    fake.setResponder((body) => {
      if (generatorKindOf(body) !== 'dockerfile') return undefined;
      dockerCalls += 1;
      return dockerCalls === 1 ? replyWith(`I would suggest ${PROSE_MARKER} a Node image.`) : undefined;
    });
    const result = await run(await makeRepo(NODE_REPO));
    const warnings = lastWarnings;

    assert.deepEqual(result.errors, []);
    assert.equal(result.generatedFiles.dockerfile, FAKE_FILES.dockerfile);
    const docker = generatorRequests('dockerfile');
    assert.equal(docker.length, 2, 'one call plus one repair');
    assert.equal(generatorRequests('githubActions').length, 1);
    assert.equal(generatorRequests('envExample').length, 1);

    // The repair: same system prompt, the validation errors and the contract, no content
    assert.equal(systemOf(docker[1]), systemOf(docker[0]));
    assert.match(userOf(docker[1]), /did not pass validation\. Problems: line 1: not a Dockerfile instruction/);
    assert.match(userOf(docker[1]), /Output only the contents of `Dockerfile`\. No explanations/);
    assert.ok(!JSON.stringify(docker[1].body).includes(PROSE_MARKER), 'the invalid reply is not sent back');

    // The log names the kind and the errors, never the content
    const logged = warnings.filter((line) => line.startsWith('Generator validation failed'));
    assert.deepEqual(logged, ['Generator validation failed: kind=dockerfile attempt=1 errors=line 1: not a Dockerfile instruction or a continuation of one; no Dockerfile instructions found']);
    assert.ok(!warnings.join('\n').includes(PROSE_MARKER));
  });

  test('both replies invalid: file absent, one prefixed error, other files kept, verifier reviews the rest', async () => {
    fake.setResponder((body) => (generatorKindOf(body) === 'githubActions'
      ? replyWith(chatReply('githubActions', 'name: ci\non: push\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@main\n'))
      : undefined));
    const result = await run(await makeRepo(NODE_REPO));

    assert.deepEqual(Object.keys(result.generatedFiles), ['dockerfile', 'envExample']);
    assert.deepEqual(result.errors, ['Generator Agent Error: GitHub Actions workflow: the AI output did not pass validation']);
    assert.equal(generatorRequests('githubActions').length, 2);
    assert.match(userOf(generatorRequests('githubActions')[1]), /job 1 step 1: uses a branch ref/);
    assert.equal(result.messages.find((m) => m.agent === 'generator').message, 'Generated 2 of 3 files');

    const verifier = verifierRequests();
    assert.equal(verifier.length, 1, 'the verifier still runs');
    assert.ok(systemOf(verifier[0]).includes('--- Dockerfile ---'));
    assert.ok(!systemOf(verifier[0]).includes('GitHub Actions workflow'), 'the rejected file is not reviewed');
    assert.equal(result.verificationResults, FAKE_LLM_CONTENT);
  });

  test('an AiError gets no repair call here (the AI layer already retried)', async () => {
    fake.setResponder((body) => (generatorKindOf(body) === 'envExample' ? { status: 400 } : undefined));
    const result = await run(await makeRepo(NODE_REPO));
    assert.deepEqual(result.errors, ['Generator Agent Error: .env.example: AI providers are unavailable']);
    assert.equal(generatorRequests('envExample').length, 1);
    assert.deepEqual(Object.keys(result.generatedFiles), ['dockerfile', 'githubActions']);
  });

  test('an AiError on the repair call keeps the AI message', async () => {
    let calls = 0;
    fake.setResponder((body) => {
      if (generatorKindOf(body) !== 'dockerfile') return undefined;
      calls += 1;
      return calls === 1 ? replyWith('not a dockerfile') : { status: 400 };
    });
    const result = await run(await makeRepo(NODE_REPO));
    assert.deepEqual(result.errors, ['Generator Agent Error: Dockerfile: AI providers are unavailable']);
    assert.equal(generatorRequests('dockerfile').length, 2);
  });

  test('maximum call count: every file needs its repair -> 1 + 6 + 1 = 8 calls', async () => {
    const seen = new Set();
    fake.setResponder((body) => {
      const kind = generatorKindOf(body);
      if (!kind || seen.has(kind)) return undefined;
      seen.add(kind);
      return replyWith('Sorry, here are some thoughts instead of a file.');
    });
    const result = await run(await makeRepo(NODE_REPO));
    assert.deepEqual(result.errors, []);
    assert.equal(Object.keys(result.generatedFiles).length, 3);
    assert.equal(fake.requests.length, 8);
    for (const file of GENERATED_FILES) assert.equal(generatorRequests(file.key).length, 2);
  });

  test('every reply invalid twice: 7 calls, no files, no verifier call', async () => {
    fake.setResponder((body) => (generatorKindOf(body) ? replyWith('nothing useful') : undefined));
    const result = await run(await makeRepo(NODE_REPO));
    assert.deepEqual(result.generatedFiles, {});
    assert.deepEqual(result.errors, GENERATED_FILES.map((file) => `Generator Agent Error: ${file.label}: the AI output did not pass validation`));
    assert.equal(fake.requests.length, 7);
    assert.equal(verifierRequests().length, 0);
  });
});

describe('generator prompts: one file each, grounded in the repository', () => {
  const PYTHON_REPO = {
    'requirements.txt': 'flask==3.0.3\ngunicorn==22.0.0  # production server\nopenai>=1.30\n',
    'app.py': 'from flask import Flask\n',
    'tests/test_app.py': 'def test_ok(): pass\n',
    'static/style.css': 'body {}\n'
  };

  test('a Python repository: requirements text, entry point, test evidence, frameworks from dependencies', async () => {
    const result = await run(await makeRepo(PYTHON_REPO));
    assert.deepEqual(result.techStack.frameworks, ['flask', 'gunicorn']);
    assert.equal(result.techStack.primary, 'python');

    for (const file of GENERATED_FILES) {
      const [request] = generatorRequests(file.key);
      const system = systemOf(request);
      assert.ok(system.includes('--- requirements.txt ---\nflask==3.0.3\ngunicorn==22.0.0  # production server\nopenai>=1.30\n--- end of requirements.txt ---'));
      assert.ok(system.includes('- Entry-point candidates: app.py'));
      assert.ok(system.includes('- Test evidence: tests/ directory'));
      assert.ok(system.includes('- Linter evidence: none found'));
      assert.ok(system.includes('- Python dependency names: flask; gunicorn; openai'));
      assert.ok(system.length <= PROMPT_CAP);
    }
  });

  test('each system prompt names only its own file', async () => {
    await run(await makeRepo(PYTHON_REPO));
    const names = { dockerfile: 'Dockerfile', githubActions: '.github/workflows/ci.yml', envExample: '.env.example' };
    for (const file of GENERATED_FILES) {
      const system = systemOf(generatorRequests(file.key)[0]);
      assert.ok(system.includes(`Output only the contents of \`${names[file.key]}\`. No explanations, no headings, no Markdown, no code fences, no other files.`));
      for (const [otherKey, otherName] of Object.entries(names)) {
        if (otherKey !== file.key) assert.ok(!system.includes(otherName), `${file.key} prompt mentions ${otherName}`);
      }
    }
  });

  test('path-substring detection is gone: a flask/ directory without the dependency is not flask', async () => {
    const result = await run(await makeRepo({ 'requirements.txt': 'requests\n', 'flask_notes/readme.md': 'x', 'fastapi-demo.md': 'x', 'manage.py': 'x' }));
    assert.deepEqual(result.techStack.frameworks, ['django']);
  });

  test('pyproject.toml dependencies are read; [tool.ruff] and [tool.pytest] are evidence', async () => {
    const pyproject = '[project]\nname = "x"\ndependencies = [\n  "FastAPI>=0.110",\n  "uvicorn[standard]",\n]\n\n[tool.ruff]\nline-length = 100\n\n[tool.pytest.ini_options]\naddopts = "-q"\n';
    const result = await run(await makeRepo({ 'pyproject.toml': pyproject, 'main.py': 'x' }));
    assert.deepEqual(result.techStack.frameworks, ['fastapi', 'uvicorn']);
    const system = systemOf(generatorRequests('githubActions')[0]);
    assert.ok(system.includes('- Linter evidence: [tool.ruff] in pyproject.toml'));
    assert.ok(system.includes('- Test evidence: [tool.pytest] in pyproject.toml'));
    assert.ok(system.includes('- Entry-point candidates: main.py'));
  });

  test('without [tool.ruff] there is no linter evidence', async () => {
    await run(await makeRepo({ 'pyproject.toml': '[project]\nname = "x"\ndependencies = ["flask"]\n', 'app.py': 'x' }));
    const system = systemOf(generatorRequests('githubActions')[0]);
    assert.ok(system.includes('- Linter evidence: none found'));
    assert.ok(system.includes('- Test evidence: none found'));
  });

  test('package.json, Procfile and existing configuration', async () => {
    const repo = await makeRepo({
      'package.json': JSON.stringify({ main: 'server.js', scripts: { start: 'node server.js', test: 'echo "Error: no test specified" && exit 1' } }),
      Procfile: 'web: node server.js\nworker: node jobs.js\n',
      '.eslintrc.json': '{}',
      Dockerfile: 'FROM node:18\nEXISTING_DOCKERFILE_LINE\n',
      '.dockerignore': 'node_modules\n',
      'compose.yaml': 'services: {}\n',
      '.github/workflows/old.yml': 'name: old\nEXISTING_WORKFLOW_LINE\n'
    });
    await run(repo);
    const system = systemOf(generatorRequests('dockerfile')[0]);
    assert.ok(system.includes('- Entry-point candidates: package.json main: server.js; package.json scripts.start: node server.js; Procfile web: node server.js'));
    assert.ok(system.includes('- Test evidence: none found'), 'npm\'s placeholder test script is not evidence');
    assert.ok(system.includes('- Linter evidence: .eslintrc.json'));
    assert.ok(system.includes('Existing container and CI configuration: Dockerfile, .dockerignore, compose.yaml, .github/workflows/old.yml'));
    assert.ok(system.includes('--- Dockerfile (existing) ---\nFROM node:18\nEXISTING_DOCKERFILE_LINE\n--- end of Dockerfile ---'));
    assert.ok(system.includes('EXISTING_WORKFLOW_LINE'));
  });

  test('.env, .npmrc and other credential files never reach any request', async () => {
    const markers = {
      '.env': 'DOTENV_MARKER_1',
      '.env.local': 'DOTENV_MARKER_2',
      '.env.example': 'DOTENV_MARKER_3',
      '.npmrc': 'NPMRC_MARKER',
      '.pypirc': 'PYPIRC_MARKER',
      '.netrc': 'NETRC_MARKER',
      'deploy.pem': 'PEM_MARKER',
      'server.key': 'KEY_MARKER'
    };
    const files = { ...PYTHON_REPO };
    for (const [name, marker] of Object.entries(markers)) files[name] = `SECRET=${marker}\n`;
    await run(await makeRepo(files));
    assert.ok(fake.requestBodies.length >= 5);
    for (const body of fake.requestBodies) {
      for (const marker of Object.values(markers)) assert.ok(!body.includes(marker), `${marker} reached the AI`);
    }
  });

  test('a symlinked requirements.txt pointing outside the repository is not read', async () => {
    const outside = await makeRepo({ 'requirements.txt': 'OUTSIDE_REQUIREMENTS_MARKER==1.0\nflask\n' });
    const repo = await makeRepo({ 'app.py': 'x', 'pyproject.toml': '[project]\nname = "x"\n' }, {
      symlinks: { 'requirements.txt': path.join(outside, 'requirements.txt') }
    });
    const result = await run(repo);
    for (const body of fake.requestBodies) assert.ok(!body.includes('OUTSIDE_REQUIREMENTS_MARKER'));
    assert.ok(!result.techStack.frameworks.includes('flask'));
    await assert.rejects(readRepoFile(repo, 'requirements.txt', { maxBytes: MANIFEST_FILE_CAP }), /not a regular file/);
  });

  test('a repository with 5,000 files: prompt within 24,000 characters, at most 300 paths, with the summary', async () => {
    const files = { ...PYTHON_REPO };
    for (let d = 0; d < 50; d += 1) {
      for (let f = 0; f < 100; f += 1) files[`pkg${String(d).padStart(2, '0')}/module_${String(f).padStart(3, '0')}.py`] = '';
    }
    const result = await run(await makeRepo(files));
    assert.ok(Object.keys(result.projectStructure).length > 5000, 'the full structure stays in state');

    for (const file of GENERATED_FILES) {
      const system = systemOf(generatorRequests(file.key)[0]);
      assert.ok(system.length <= PROMPT_CAP, `${file.key}: ${system.length} characters`);
      const listing = system.match(/File list \(([^)]*)\):\n([\s\S]*?)\nEND REPOSITORY DATA/);
      assert.ok(listing, 'the file list section');
      // 5,000 modules + requirements.txt, app.py, tests/test_app.py, static/style.css;
      // 50 package directories + tests/ + static/
      assert.match(listing[1], /^5004 files and 52 directories in total; top extensions: \.py 5002, \.css 1, \.txt 1; showing \d+ of 5056 paths, shallowest first$/);
      const paths = listing[2].split('\n').filter(Boolean);
      assert.ok(paths.length <= 300, `${paths.length} paths`);
      assert.equal(Number(listing[1].match(/showing (\d+)/)[1]), paths.length);
      // Shallowest first: the top-level entries come before any nested path
      assert.deepEqual(paths.slice(0, 3), ['app.py', 'pkg00/', 'pkg01/']);
      assert.ok(system.includes('--- requirements.txt ---'), 'manifests are never dropped');
    }
  });
});

describe('grounding units', () => {
  test('MANIFEST_FILES holds no forbidden name, and forbidden names are recognised', () => {
    for (const name of MANIFEST_FILES) assert.equal(isForbiddenFileName(name), false, name);
    for (const name of ['.env', '.env.local', '.env.example', '.npmrc', '.pypirc', '.netrc', 'id.pem', 'tls.key', 'sub/.env']) {
      assert.equal(isForbiddenFileName(name), true, name);
    }
  });

  test('per-file and total caps, with a visible [truncated] marker', async () => {
    const big = (char) => `${char.repeat(80)}\n`.repeat(200); // 16,200 characters
    const repo = await makeRepo({
      'requirements.txt': big('a'),
      'requirements-dev.txt': big('b'),
      'pyproject.toml': big('c'),
      Pipfile: big('d'),
      'setup.cfg': big('e'),
      'package.json': '{}'
    });
    const evidence = await collectRepositoryEvidence(repo, await scanProjectStructure(repo));
    const total = evidence.manifests.reduce((sum, manifest) => sum + manifest.content.length, 0);
    assert.ok(total <= MANIFEST_TOTAL_CAP, `total ${total}`);
    for (const manifest of evidence.manifests) {
      assert.ok(manifest.content.length <= MANIFEST_FILE_CAP);
      assert.equal(manifest.truncated, true);
    }
    assert.deepEqual(evidence.manifests.map((m) => m.name), ['requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'Pipfile']);
    assert.deepEqual(evidence.manifestsOmitted, ['setup.cfg', 'package.json']);

    const { system, stats } = buildGeneratorSystemPrompt('dockerfile', {
      repoName: 'o/r', techStack: null, evidence, projectFiles: await scanProjectStructure(repo)
    });
    assert.ok(system.length <= PROMPT_CAP, `${system.length}`);
    assert.ok(system.includes(TRUNCATED_MARKER));
    assert.ok(system.includes('Not included (over the size limit): setup.cfg, package.json'));
    assert.equal(stats.manifestsCut, true, '32 KB of manifests cannot fit a 24,000-character prompt');
  });

  test('over the budget, existing-configuration excerpts go first, then the file list; manifests stay', async () => {
    const files = { 'requirements.txt': 'flask\n', Dockerfile: `FROM x\n${'RUN echo\n'.repeat(600)}` };
    for (let i = 0; i < 10; i += 1) files[`.github/workflows/w${i}.yml`] = `name: w\n${'# filler line\n'.repeat(400)}`;
    for (let i = 0; i < 400; i += 1) files[`src/deeply/nested/path/module_number_${i}.py`] = '';
    const repo = await makeRepo(files);
    const projectFiles = await scanProjectStructure(repo);
    const evidence = await collectRepositoryEvidence(repo, projectFiles);
    assert.ok(evidence.existingConfig.excerpts.every((excerpt) => excerpt.content.length <= EXISTING_FILE_CAP));
    const { system, stats } = buildGeneratorSystemPrompt('envExample', { repoName: 'o/r', techStack: null, evidence, projectFiles });
    assert.equal(stats.excerpts, false);
    assert.equal(stats.manifestsCut, false);
    assert.ok(system.length <= PROMPT_CAP);
    assert.ok(system.includes('--- requirements.txt ---\nflask\n--- end of requirements.txt ---'));
    assert.ok(!system.includes('(existing) ---'));
    assert.ok(system.includes('Existing container and CI configuration: Dockerfile, .github/workflows/w0.yml'), 'names stay');
  });
});

describe('verifier input', () => {
  test('files longer than 500 characters reach the verifier up to 4,000 characters each', async () => {
    const longDockerfile = `FROM node:20\n${Array.from({ length: 400 }, (_, i) => `RUN echo step-${String(i).padStart(4, '0')}`).join('\n')}\n`;
    const longEnv = `${Array.from({ length: 300 }, (_, i) => `VARIABLE_NUMBER_${String(i).padStart(4, '0')}=placeholder`).join('\n')}\n`;
    fake.setResponder((body) => {
      const kind = generatorKindOf(body);
      if (kind === 'dockerfile') return replyWith(chatReply('dockerfile', longDockerfile));
      if (kind === 'envExample') return replyWith(longEnv);
      return undefined;
    });
    const result = await run(await makeRepo(NODE_REPO));
    assert.equal(result.generatedFiles.dockerfile, longDockerfile);
    assert.ok(longDockerfile.length > VERIFIER_FILE_CAP && longEnv.length > VERIFIER_FILE_CAP);

    const system = systemOf(verifierRequests()[0]);
    assert.ok(system.length <= PROMPT_CAP);
    assert.ok(system.includes(`--- Dockerfile (first ${VERIFIER_FILE_CAP} of ${longDockerfile.length} characters) ---\n${longDockerfile.slice(0, VERIFIER_FILE_CAP).trimEnd()}\n--- end of Dockerfile ---`));
    assert.ok(!system.includes(longDockerfile.slice(0, VERIFIER_FILE_CAP + 20)));
    assert.ok(system.includes(longEnv.slice(0, VERIFIER_FILE_CAP).trimEnd()));
    assert.ok(system.includes(`--- GitHub Actions workflow ---\n${FAKE_FILES.githubActions.trimEnd()}\n`), 'a short file is shown whole');
  });

  test('the verifier prompt cap holds for any input', () => {
    const files = ['A', 'B', 'C'].map((label) => ({ label, content: label.repeat(20000) }));
    assert.ok(buildVerifierSystemPrompt(files).length <= PROMPT_CAP);
    const small = buildVerifierSystemPrompt(files, 6000);
    assert.ok(small.length <= 6000, `${small.length}`);
    assert.match(small, /--- A \(first \d+ of 20000 characters\) ---/);
  });
});

describe('credentials in manifests and existing configuration are redacted (architect review)', () => {
  const MARKERS = ['MARKERSECRET111', 'MARKERTOKEN222', 'MARKERKEY333'];
  const REPO = {
    'requirements.txt': [
      '--extra-index-url https://deploy:MARKERSECRET111@pypi.corp.example/simple',
      'flask==3.0.3',
      'privlib @ git+https://ghp_MARKERTOKEN222@github.com/org/privlib.git',
      'gunicorn',
      ''
    ].join('\n'),
    '.github/workflows/ci.yml': 'name: old\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    env:\n      API_KEY: sk-MARKERKEY333\n    steps:\n      - run: echo\n',
    'app.py': 'x'
  };

  // A valid file of the kind asked for, whose comments repeat the prompt's whole
  // repository data: whatever reached the prompt would reach the saved file
  const echoFile = (kind, system) => {
    const data = system.split('BEGIN REPOSITORY DATA\n')[1].split('\nEND REPOSITORY DATA')[0];
    const comments = data.split('\n').map((line) => `# ${line}`).join('\n');
    if (kind === 'dockerfile') return `FROM python:3.12-slim\n${comments}\nCMD ["gunicorn", "app:app"]\n`;
    if (kind === 'githubActions') return `${FAKE_FILES.githubActions}${comments}\n`;
    return `PORT=8000\n${comments}\n`;
  };

  test('the markers reach no request (6 generator calls and the verifier) and no generated file', async () => {
    const seen = new Set();
    fake.setResponder((body) => {
      const kind = generatorKindOf(body);
      if (!kind) return undefined;
      if (!seen.has(kind)) {
        seen.add(kind);
        return replyWith('not a file'); // forces the repair call, so all 6 generator calls run
      }
      return replyWith(chatReply(kind, echoFile(kind, body.messages.find((m) => m.role === 'system').content)));
    });
    const result = await run(await makeRepo(REPO));

    assert.deepEqual(result.errors, []);
    for (const file of GENERATED_FILES) assert.equal(generatorRequests(file.key).length, 2, file.key);
    assert.equal(verifierRequests().length, 1);
    assert.equal(fake.requestBodies.length, 8);
    for (const body of fake.requestBodies) {
      for (const marker of MARKERS) assert.ok(!body.includes(marker), `${marker} reached the AI`);
    }

    // The echo works: the redacted data, with its hosts, is in every file and in the verifier's prompt
    assert.deepEqual(Object.keys(result.generatedFiles), ['dockerfile', 'githubActions', 'envExample']);
    for (const content of Object.values(result.generatedFiles)) {
      assert.ok(content.includes('https://REDACTED@pypi.corp.example/simple'));
      assert.ok(content.includes('git+https://REDACTED@github.com/org/privlib.git'));
      assert.ok(content.includes('API_KEY: REDACTED'));
      for (const marker of MARKERS) assert.ok(!content.includes(marker), `${marker} in a generated file`);
    }
    assert.ok(systemOf(verifierRequests()[0]).includes('pypi.corp.example'));
  });

  test('dependency names and frameworks are unchanged', async () => {
    const result = await run(await makeRepo(REPO));
    assert.deepEqual(result.evidence.pythonDependencies, ['flask', 'gunicorn', 'privlib']);
    assert.deepEqual(result.techStack.frameworks, ['flask', 'gunicorn']);
    const system = systemOf(generatorRequests('dockerfile')[0]);
    assert.ok(system.includes('- Python dependency names: flask; gunicorn; privlib'));
    assert.ok(system.includes('--- requirements.txt ---\n--extra-index-url https://REDACTED@pypi.corp.example/simple\nflask==3.0.3\n'));
  });

  test('a credential crossing the 8 KB cut is redacted before the cut, never half-shown', async () => {
    // The userinfo starts a few bytes before byte 8,192, so a plain cut would end inside it
    const filler = `${'#'.repeat(99)}\n`.repeat(81); // 8,100 bytes
    // 50 + " --extra-index-url https://" = 77 bytes: the userinfo starts at byte 8,177, and a
    // plain cut at 8,192 would end inside it, after "deploy:MARKERSE"
    const line = `${'x'.repeat(50)} --extra-index-url https://deploy:MARKERSECRET111@pypi.corp.example/simple\n`;
    const repo = await makeRepo({ 'requirements.txt': `${filler}${line}flask\n${filler}` });
    const evidence = await collectRepositoryEvidence(repo, await scanProjectStructure(repo));
    const [manifest] = evidence.manifests;
    assert.ok(manifest.truncated);
    assert.ok(manifest.content.length <= MANIFEST_FILE_CAP);
    assert.ok(!manifest.content.includes('MARKERSE'), 'no part of the password');
    assert.ok(!manifest.content.includes('deploy:'), 'no part of the user name and password');
  });
});
