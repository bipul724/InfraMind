// readApiError: the server's `error` text when there is one, otherwise a fixed text by
// status; never raw response text. Run with `npm test`.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { describeApiError, readApiError } from './apiError.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const FALLBACK = 'The repository could not be cloned. Please try again.';

describe('readApiError', () => {
  test('the server bodies of /api/clone-repo: text and code', async () => {
    const cases: [Response, { status: number; code: string | null; message: string }][] = [
      [json(429, { error: 'Too many clone requests, please wait before trying again', code: 'RATE_LIMITED' }),
        { status: 429, code: 'RATE_LIMITED', message: 'Too many clone requests, please wait before trying again' }],
      [json(503, { error: 'GitHub rate limit reached. Please try again later.', code: 'GITHUB_RATE_LIMITED' }),
        { status: 503, code: 'GITHUB_RATE_LIMITED', message: 'GitHub rate limit reached. Please try again later.' }],
      [json(400, { error: 'Invalid GitHub repository URL' }), { status: 400, code: null, message: 'Invalid GitHub repository URL' }],
      [json(404, { error: 'Repository not found or access denied', code: 'REPO_NOT_FOUND' }),
        { status: 404, code: 'REPO_NOT_FOUND', message: 'Repository not found or access denied' }]
    ];
    for (const [response, expected] of cases) assert.deepEqual(await readApiError(response, FALLBACK), expected);
  });

  test('without a usable `error`: a fixed text by status, never the raw body', async () => {
    const html = (status: number) => new Response('<html><body>502 Bad Gateway MARKERHTML</body></html>', { status, headers: { 'Content-Type': 'text/html' } });
    assert.equal((await readApiError(html(502), FALLBACK)).message, 'The server had a problem (HTTP 502). Please try again.');
    assert.equal((await readApiError(html(429), FALLBACK)).message, 'Too many requests. Please wait a minute and try again.');
    assert.equal((await readApiError(json(401, {}), FALLBACK)).message, 'Your sign-in has expired. Sign in again.');
    assert.equal((await readApiError(json(400, { error: '   ' }), FALLBACK)).message, FALLBACK);
    assert.equal((await readApiError(json(418, { error: 42 }), FALLBACK)).message, FALLBACK);
    assert.equal((await readApiError(new Response(null, { status: 500 }), FALLBACK)).message, 'The server had a problem (HTTP 500). Please try again.');
    assert.equal((await readApiError(json(400, ['not', 'an', 'object']), FALLBACK)).message, FALLBACK);
  });

  test('one line, at most 300 characters; the body stays readable by the caller', async () => {
    const response = json(400, { error: `first line\nsecond\t line ${'x'.repeat(400)}` });
    const { message } = await readApiError(response, FALLBACK);
    assert.ok(!/\s{2,}|\n/.test(message));
    assert.equal(message.length, 300);
    assert.ok(message.startsWith('first line second line '));
    assert.ok((await response.json()).error.startsWith('first line'), 'read from a clone');
  });

  test('describeApiError adds the code when there is one', () => {
    assert.equal(describeApiError({ message: 'GitHub rate limit reached.', code: 'GITHUB_RATE_LIMITED' }), 'GitHub rate limit reached. (GITHUB_RATE_LIMITED)');
    assert.equal(describeApiError({ message: 'Invalid GitHub repository URL', code: null }), 'Invalid GitHub repository URL');
  });
});
