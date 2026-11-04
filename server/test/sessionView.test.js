import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toStatusResponse, toFilesResponse, toProgressPayload, toAgentMessages, toErrorList } from '../utils/sessionView.js';

const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const MARKERS = [
  'MARKER_TOKEN',
  'MARKER_ACCESS_TOKEN',
  'MARKER_AUTH_TOKEN',
  'MARKER_CLONE_PATH',
  'MARKER_USER_ID',
  'MARKER_OWNER',
  'MARKER_LAST_PROGRESS'
];

// A session carrying every field that must never leave the server
const plantedSession = () => ({
  token: 'MARKER_TOKEN',
  accessToken: 'MARKER_ACCESS_TOKEN',
  authToken: 'MARKER_AUTH_TOKEN',
  clonePath: '/abs/MARKER_CLONE_PATH/repo',
  userId: 'MARKER_USER_ID',
  owner: 'MARKER_OWNER',
  lastProgress: { step: 'MARKER_LAST_PROGRESS' },
  repo: 'Hello-World',
  fullName: 'octocat/Hello-World',
  displayUrl: 'https://github.com/octocat/Hello-World',
  repoName: 'Hello-World',
  status: 'completed',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  clonedAt: new Date('2026-01-01T00:00:01Z'),
  analysisStartedAt: new Date('2026-01-01T00:00:02Z'),
  completedAt: new Date('2026-01-01T00:00:03Z'),
  error: undefined,
  analysisResult: {
    generatedFiles: { dockerfile: 'FROM node:20' },
    techStack: { primary: 'node' },
    codebaseAnalysis: { entryPoints: [] },
    verificationResults: 'ok',
    repoPath: '/abs/MARKER_CLONE_PATH/repo',
    messages: [{ agent: 'planner', message: 'MARKER_TOKEN' }]
  }
});

const assertNoMarkers = (value) => {
  const text = JSON.stringify(value);
  for (const marker of MARKERS) {
    assert.ok(!text.includes(marker), `output must not contain ${marker}`);
  }
};

describe('toStatusResponse', () => {
  test('returns exactly the allow-listed fields', () => {
    const output = toStatusResponse(SESSION_ID, plantedSession());
    assert.deepEqual(Object.keys(output).sort(), [
      'analysisStartedAt', 'clonedAt', 'completedAt', 'createdAt', 'error',
      'repoName', 'repoUrl', 'sessionId', 'status'
    ]);
    assert.equal(output.repoUrl, 'https://github.com/octocat/Hello-World');
    assert.equal(output.sessionId, SESSION_ID);
    assertNoMarkers(output);
  });
});

describe('toFilesResponse', () => {
  test('returns exactly the allow-listed fields and metadata', () => {
    const output = toFilesResponse(plantedSession());
    assert.deepEqual(Object.keys(output).sort(), [
      'codebaseAnalysis', 'errors', 'files', 'messages', 'metadata', 'techStack', 'verificationResults'
    ]);
    assert.deepEqual(Object.keys(output.metadata).sort(), ['completedAt', 'repoName', 'repoUrl']);
    assert.deepEqual(output.files, { dockerfile: 'FROM node:20' });
    assertNoMarkers(output);
  });

  test('returns the stored messages and errors, copied field by field', () => {
    const session = {
      ...plantedSession(),
      messages: [
        { agent: 'planner', message: 'Created comprehensive analysis plan', timestamp: '2026-01-01T00:00:00.000Z' },
        { agent: 'generator', message: 'Generated 2 of 3 files', timestamp: '2026-01-01T00:00:01.000Z' }
      ],
      errors: ['Generator Agent Error: Dockerfile: AI providers are unavailable']
    };
    const output = toFilesResponse(session);
    assert.deepEqual(output.messages, session.messages);
    assert.deepEqual(output.errors, session.errors);
    assert.notEqual(output.messages[0], session.messages[0], 'a copy, never the stored object');
  });

  test('extra fields on a stored message never appear', () => {
    const output = toFilesResponse({
      ...plantedSession(),
      messages: [{ agent: 'planner', message: 'ok', timestamp: 't', apiKey: 'MARKER_TOKEN', userId: 'MARKER_USER_ID', nested: { token: 'MARKER_ACCESS_TOKEN' } }]
    });
    assert.deepEqual(output.messages, [{ agent: 'planner', message: 'ok', timestamp: 't' }]);
    assertNoMarkers(output);
  });

  test('non-string values are dropped', () => {
    const output = toFilesResponse({
      ...plantedSession(),
      messages: [
        { agent: 'planner', message: 42 },
        { agent: { name: 'x' }, message: 'ok' },
        null,
        'not an object',
        { agent: 'analyzer', message: 'Detected tech stack: node', timestamp: 12345 },
        { agent: 'verifier', message: 'Review complete: see the review text', timestamp: '2026-01-01T00:00:00.000Z' }
      ],
      errors: ['Generator Agent Error: Dockerfile: AI providers are unavailable', 7, null, { error: 'MARKER_TOKEN' }]
    });
    assert.deepEqual(output.messages, [
      { agent: 'analyzer', message: 'Detected tech stack: node' },
      { agent: 'verifier', message: 'Review complete: see the review text', timestamp: '2026-01-01T00:00:00.000Z' }
    ]);
    assert.deepEqual(output.errors, ['Generator Agent Error: Dockerfile: AI providers are unavailable']);
    assertNoMarkers(output);
  });

  test('missing or malformed data gives empty arrays', () => {
    const { messages, errors, ...rest } = plantedSession();
    assert.deepEqual(toFilesResponse(rest).messages, []);
    assert.deepEqual(toFilesResponse(rest).errors, []);
    const odd = toFilesResponse({ ...rest, messages: { agent: 'planner' }, errors: 'Generator Agent Error: x' });
    assert.deepEqual(odd.messages, []);
    assert.deepEqual(odd.errors, []);
  });
});

describe('toAgentMessages and toErrorList', () => {
  test('are the sanitizers used for the files response, the final event and the analyze response', () => {
    assert.deepEqual(toAgentMessages(undefined), []);
    assert.deepEqual(toErrorList(undefined), []);
    assert.deepEqual(toAgentMessages([{ agent: 'a', message: 'b', timestamp: 'c', extra: 'MARKER_TOKEN' }]), [{ agent: 'a', message: 'b', timestamp: 'c' }]);
    assert.deepEqual(toErrorList(['x', 1, 'y']), ['x', 'y']);
  });
});

describe('toProgressPayload', () => {
  test('copies only allow-listed fields from data', () => {
    const output = toProgressPayload(SESSION_ID, {
      step: 'Analysis complete!',
      progress: 100,
      status: 'completed',
      messages: [],
      errors: [],
      error: 'Analysis failed',
      techStack: { primary: 'node' },
      generatedFiles: ['dockerfile'],
      token: 'MARKER_TOKEN',
      accessToken: 'MARKER_ACCESS_TOKEN',
      authToken: 'MARKER_AUTH_TOKEN',
      clonePath: '/abs/MARKER_CLONE_PATH',
      userId: 'MARKER_USER_ID',
      owner: 'MARKER_OWNER',
      lastProgress: 'MARKER_LAST_PROGRESS',
      sessionId: 'MARKER_OWNER'
    });
    assert.deepEqual(Object.keys(output).sort(), [
      'error', 'errors', 'generatedFiles', 'messages', 'progress', 'sessionId', 'status', 'step', 'techStack'
    ]);
    assert.equal(output.sessionId, SESSION_ID, 'sessionId comes from the caller, not from data');
    assertNoMarkers(output);
  });

  test('omits fields that are absent', () => {
    assert.deepEqual(toProgressPayload(SESSION_ID, { step: 'x', status: 'cloning' }), {
      sessionId: SESSION_ID,
      step: 'x',
      status: 'cloning'
    });
  });

  test('ignores inherited properties', () => {
    const data = Object.create({ token: 'MARKER_TOKEN', step: 'inherited' });
    assert.deepEqual(toProgressPayload(SESSION_ID, data), { sessionId: SESSION_ID });
  });
});
