// A failed Google or GitHub sign-in comes back from Supabase to /dashboard with error,
// error_code and error_description in the URL. supabase-js reads both the hash and the
// query string (query values win) and leaves them in the address bar on an error
// (@supabase/auth-js GoTrueClient _getSessionFromURL), so ProtectedRoute reads them here
// before it redirects to /auth. Only a short code is kept: error_description is text
// anyone can put in a link, so it is never shown. No imports, so `node --test` loads it.

const CODE_PATTERN = /^[a-z0-9_]{1,64}$/;
export const UNKNOWN_OAUTH_ERROR = 'unknown';

// A code safe to put in a URL and look up: the value itself, or "unknown"
export const normalizeOAuthErrorCode = (value: unknown): string =>
  (typeof value === 'string' && CODE_PATTERN.test(value) ? value : UNKNOWN_OAUTH_ERROR);

const paramsOf = (search: string, hash: string): URLSearchParams => {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  // As in supabase-js, a query-string value takes precedence over the hash
  new URLSearchParams(search).forEach((value, key) => params.set(key, value));
  return params;
};

// The error code of a failed provider sign-in in this URL, or null when there is none
export function readOAuthError(search: string, hash: string): string | null {
  const params = paramsOf(search, hash);
  if (!params.has('error') && !params.has('error_code') && !params.has('error_description')) return null;
  // error_code is the more specific of the two; an empty one counts as missing
  return normalizeOAuthErrorCode(params.get('error_code') || params.get('error'));
}

// The fixed text shown on /auth for a code from ?oauth_error=
export const oauthErrorMessage = (code: unknown): string =>
  (normalizeOAuthErrorCode(code) === 'access_denied'
    ? 'Sign-in was cancelled or not allowed by the provider.'
    : 'Sign-in with Google or GitHub failed. Please try again.');
