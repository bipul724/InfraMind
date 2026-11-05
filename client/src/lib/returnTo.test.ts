// safeReturnTo: only same-site paths that are not a sign-in page. Run with `npm test`.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RETURN_TO, authUrlFor, safeReturnTo } from './returnTo.ts';

const D = DEFAULT_RETURN_TO;
// [input, expected]
const CASES: [unknown, string][] = [
  // Kept
  ['/dashboard', '/dashboard'],
  ['/select-repo', '/select-repo'],
  ['/dashboard?session=0f8fad5b-d9cb-469f-a165-70867728950e', '/dashboard?session=0f8fad5b-d9cb-469f-a165-70867728950e'],
  ['/dashboard?tab=saved&x=1', '/dashboard?tab=saved&x=1'],
  ['/dashboard#files', '/dashboard#files'],
  ['/', '/'],
  ['/demo', '/demo'],
  [`/${'a'.repeat(2047)}`, `/${'a'.repeat(2047)}`],
  // Rejected: off-site
  ['//evil.example', D],
  ['//evil.example/dashboard', D],
  ['/\\evil.example', D],
  ['\\\\evil.example', D],
  ['https://evil.example', D],
  ['http://evil.example/dashboard', D],
  ['javascript:alert(1)', D],
  ['data:text/html,<script>alert(1)</script>', D],
  ['/%2F%2Fevil.example', D],
  ['/%2f%2fevil.example', D],
  ['/%5Cevil.example', D],
  ['/dashboard%0A//evil.example', D],
  ['/dashboard%0d%0aSet-Cookie:x', D],
  ['/dash\nboard', D],
  ['/dash\tboard', D],
  ['/%E0%A4%A', D], // malformed percent-encoding
  ['dashboard', D],
  ['', D],
  [`/${'a'.repeat(2048)}`, D],
  // Rejected: a sign-in page
  ['/auth', D],
  ['/auth?returnTo=/auth', D],
  ['/auth/success?complete=x', D],
  ['/Auth', D],
  ['/%61uth', D],
  ['/authors', D],
  ['/sign-in', D],
  ['/sign-up?x=1', D],
  ['/login', D],
  // Rejected: not a string
  [null, D],
  [undefined, D],
  [42, D],
  [['/dashboard'], D]
];

describe('safeReturnTo', () => {
  test('the table has at least 20 inputs', () => assert.ok(CASES.length >= 20, String(CASES.length)));
  for (const [input, expected] of CASES) {
    const name = typeof input === 'string' ? JSON.stringify(input.length > 60 ? `${input.slice(0, 40)}...(${input.length})` : input) : String(input);
    test(name, () => assert.equal(safeReturnTo(input), expected));
  }
});

describe('authUrlFor', () => {
  test('builds /auth?returnTo= that reads back as the same path', () => {
    for (const path of ['/select-repo', '/dashboard?session=0f8fad5b-d9cb-469f-a165-70867728950e', '/dashboard?a=1&b=2']) {
      const url = authUrlFor(path);
      assert.ok(url.startsWith('/auth?returnTo=/'), url);
      assert.equal(new URLSearchParams(url.split('?').slice(1).join('?')).get('returnTo'), path);
      assert.equal(safeReturnTo(path), path);
    }
    assert.equal(authUrlFor('/select-repo'), '/auth?returnTo=/select-repo');
  });
});
