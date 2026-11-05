// What to tell the user about a failed API response. The server's `error` text is
// written for users (fixed strings, never request data), so it is shown when the body
// has one; otherwise a fixed text by status. Raw response text, HTML or a stack trace
// is never shown. A fetch that throws (offline, CORS) never reaches this: callers show
// UNREACHABLE_MESSAGE for that.

export interface ApiError {
  status: number;
  code: string | null;
  message: string;
}

export const UNREACHABLE_MESSAGE = 'Could not reach the server. Please try again.';
const MESSAGE_CAP = 300;

// GitHub codes for which reconnecting GitHub is the fix (server/server.js)
export const GITHUB_RECONNECT_CODES = new Set(['GITHUB_AUTH_REQUIRED', 'GITHUB_AUTH_INVALID']);

const fixedMessage = (status: number, fallback: string): string => {
  if (status === 429) return 'Too many requests. Please wait a minute and try again.';
  if (status === 401) return 'Your sign-in has expired. Sign in again.';
  if (status >= 500) return `The server had a problem (HTTP ${status}). Please try again.`;
  return fallback;
};

export async function readApiError(response: Response, fallback: string): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    // no JSON body: an HTML error page from a proxy, an empty body
  }
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const code = typeof record.code === 'string' ? record.code : null;
  const error = typeof record.error === 'string' ? record.error.replace(/\s+/g, ' ').trim() : '';
  const message = error ? error.slice(0, MESSAGE_CAP) : fixedMessage(response.status, fallback);
  return { status: response.status, code, message };
}

// The text shown to the user: the message, with the server's code when it sent one
export const describeApiError = ({ message, code }: Pick<ApiError, 'message' | 'code'>): string =>
  (code ? `${message} (${code})` : message);
