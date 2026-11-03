import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toStatusResponse, toFilesResponse, toProgressPayload } from '../utils/sessionView.js';

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
    assert.deepEqual(Object.keys(output).sort(), ['codebaseAnalysis', 'files', 'metadata', 'techStack', 'verificationResults']);
    assert.deepEqual(Object.keys(output.metadata).sort(), ['completedAt', 'repoName', 'repoUrl']);
    assert.deepEqual(output.files, { dockerfile: 'FROM node:20' });
    assertNoMarkers(output);
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
