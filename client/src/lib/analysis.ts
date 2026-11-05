import { apiFetch } from '@/lib/apiClient';
import { ANALYSIS_BUSY } from '@/lib/session';
import type { AnalyzeStartedResponse, ApiErrorBody } from '@/lib/session';

// The outcome of POST /api/analyze (B2.1). The server answers 202 as soon as the
// analysis has started; nothing in the response is a result.
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
    return { kind: 'error', message: 'Could not reach the server. Please try again.' };
  }

  let body: (Partial<AnalyzeStartedResponse> & ApiErrorBody) | null = null;
  try {
    body = await response.json();
  } catch {
    // no JSON body
  }

  if (response.status === 202) return { kind: 'started' };
  if (response.status === 503 && body?.code === ANALYSIS_BUSY) {
    return { kind: 'busy', message: body.error || BUSY_FALLBACK };
  }
  return { kind: 'error', message: body?.error || 'Failed to start the analysis' };
}
