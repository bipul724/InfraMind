// Where to go after signing in. ProtectedRoute sends a signed-out user to
// /auth?returnTo=<path + search>; the value comes back from the address bar, so anyone can
// write it. Only a path on this site is used: anything that could leave the site
// (//host, /\host, a scheme, encoded slashes or control characters) or lead back to a
// sign-in page falls back to the dashboard. No imports, so `node --test` loads it directly.

export const DEFAULT_RETURN_TO = '/dashboard';
const MAX_LENGTH = 2048;
// The sign-in page and its aliases: returning there would only show sign-in again
const SIGN_IN_PATHS = /^\/(?:auth|sign-in|sign-up|login)(?:[/?#]|$)/i;
// Control characters and "\" (browsers treat "\" in a path like "/")
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/;

const isSafePath = (path: string): boolean =>
  path.startsWith('/') &&
  !path.startsWith('//') &&
  !UNSAFE_CHARS.test(path) &&
  !path.toLowerCase().startsWith('/auth') &&
  !SIGN_IN_PATHS.test(path);

// The value itself when it is a safe same-site path, otherwise DEFAULT_RETURN_TO. The
// decoded form must be safe too, so "/%2F%2Fhost" or "/%5Chost" cannot become a host later.
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_LENGTH) return DEFAULT_RETURN_TO;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return DEFAULT_RETURN_TO; // malformed percent-encoding
  }
  if (!isSafePath(value) || !isSafePath(decoded)) return DEFAULT_RETURN_TO;
  // Resolved against a placeholder origin, the result must stay on that origin
  try {
    if (new URL(value, 'https://return-to.invalid').origin !== 'https://return-to.invalid') return DEFAULT_RETURN_TO;
  } catch {
    return DEFAULT_RETURN_TO;
  }
  return value;
}

// The /auth address that brings the user back to `path` after signing in. "/" stays
// readable in the query string; everything else is encoded.
export const authUrlFor = (path: string): string =>
  `/auth?returnTo=${encodeURIComponent(path).replace(/%2F/gi, '/')}`;
