import { API_BASE_URL } from '@/lib/api';
import { getAccessToken } from '@/lib/supabase';

export interface ApiFetchOptions {
  // GitHub session JWT; sent only in X-GitHub-Token (transitional until B1.3)
  githubToken?: string | null;
}

// The one way the app calls the backend's /api routes: attaches the Supabase
// access token as a Bearer token and, when given, the GitHub session header.
// Returns the raw Response so callers keep their own .ok handling.
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {}
): Promise<Response> {
  const headers = new Headers(init.headers);

  const accessToken = await getAccessToken();
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  if (options.githubToken) {
    headers.set('X-GitHub-Token', options.githubToken);
  }
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

// Reads the machine-readable `code` from an error response without consuming it
export async function getApiErrorCode(response: Response): Promise<string | null> {
  try {
    const data = await response.clone().json();
    return typeof data?.code === 'string' ? data.code : null;
  } catch {
    return null;
  }
}
