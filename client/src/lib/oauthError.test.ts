// readOAuthError and oauthErrorMessage: the code of a failed provider sign-in, never its
// description. Run with `npm test`.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOAuthErrorCode, oauthErrorMessage, readOAuthError } from './oauthError.ts';

const DENIED = 'Sign-in was cancelled or not allowed by the provider.';
const GENERIC = 'Sign-in with Google or GitHub failed. Please try again.';

describe('readOAuthError', () => {
  // [search, hash, expected]
  const cases: [string, string, string | null][] = [
    // The hash form (implicit flow) and the query form
    ['', '#error=access_denied&error_code=access_denied&error_description=The+user+denied', 'access_denied'],
    ['?error=access_denied&error_description=x', '', 'access_denied'],
    // error_code is preferred over error
    ['', '#error=server_error&error_code=bad_oauth_state', 'bad_oauth_state'],
    ['?error=access_denied&error_code=provider_email_needs_verification', '', 'provider_email_needs_verification'],
    // An empty error_code falls back to error
    ['', '#error=access_denied&error_code=', 'access_denied'],
    // The query string wins over the hash, as in supabase-js
    ['?error_code=from_query', '#error_code=from_hash', 'from_query'],
    // Invalid codes become "unknown"
    ['', '#error=%3Cscript%3Ealert(1)%3C%2Fscript%3E', 'unknown'],
    ['', '#error=Access_Denied', 'unknown'],
    ['', `#error=${'a'.repeat(65)}`, 'unknown'],
    ['', '#error=access%20denied', 'unknown'],
    ['', '#error=', 'unknown'],
    // A description alone is an error, but its text is never used
    ['', '#error_description=Something%20MARKERDESC%20happened', 'unknown'],
    // No error at all
    ['', '', null],
    ['?session=0f8fad5b-d9cb-469f-a165-70867728950e', '', null],
    ['', '#access_token=x&refresh_token=y', null],
    ['', '#not a query string', null]
  ];
  for (const [search, hash, expected] of cases) {
    test(`${search || '(no query)'} ${hash || '(no hash)'}`, () => assert.equal(readOAuthError(search, hash), expected));
  }

  test('error_description never reaches the result', () => {
    const long = `MARKERDESC ${'<b>x</b> '.repeat(200)}`;
    const code = readOAuthError('', `#error=access_denied&error_description=${encodeURIComponent(long)}`);
    assert.equal(code, 'access_denied');
    assert.ok(!oauthErrorMessage(code).includes('MARKERDESC'));
  });
});

describe('oauthErrorMessage and normalizeOAuthErrorCode', () => {
  test('a fixed message by code', () => {
    assert.equal(oauthErrorMessage('access_denied'), DENIED);
    for (const code of ['server_error', 'unknown', 'bad_oauth_state', '<script>', '', null, undefined, 42]) {
      assert.equal(oauthErrorMessage(code), GENERIC, String(code));
    }
  });
  test('only ^[a-z0-9_]{1,64}$ is kept', () => {
    assert.equal(normalizeOAuthErrorCode('access_denied'), 'access_denied');
    assert.equal(normalizeOAuthErrorCode('a'.repeat(64)), 'a'.repeat(64));
    for (const value of ['a'.repeat(65), 'A', 'a-b', 'a b', '', '<script>', null, {}]) {
      assert.equal(normalizeOAuthErrorCode(value), 'unknown', String(value));
    }
  });
});
