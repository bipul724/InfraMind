import { apiFetch } from '@/lib/apiClient';
import { readApiError, UNREACHABLE_MESSAGE } from '@/lib/apiError';
import { ANALYSIS_BUSY } from '@/lib/session';

// The outcome of POST /api/analyze. The server answers 202 as soon as the analysis has
// started; nothing in the response is a result.
export type StartAnalysisOutcome =
  | { kind: 'started' }
  // 503 ANALYSIS_BUSY: retry the same session later, without cloning again
  | { kind: 'busy'; message: string }
  | { kind: 'error'; message: string };

const BUSY_FALLBACK = 'The analysis service is busy. Please try again shortly.';

export async function startAnalysis(sessionId: string): Promise<StartAnalysisOutcome> {
  let response: Response;
  try {
    response = await apiFetch('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ sessionId })
    });
  } catch {
    return { kind: 'error', message: UNREACHABLE_MESSAGE };
  }

  if (response.status === 202) return { kind: 'started' };
  const { code, message } = await readApiError(response, 'The analysis could not be started.');
  if (response.status === 503 && code === ANALYSIS_BUSY) {
    return { kind: 'busy', message: message || BUSY_FALLBACK };
  }
  return { kind: 'error', message };
}
