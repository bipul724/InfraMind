// Shapes of the analysis-session data the server sends, and the session-id rule.
// Field lists follow server/utils/sessionView.js (toStatusResponse, toFilesResponse,
// toProgressPayload) and server/agents/index.js (analyzeTechStack, state.messages).

export type SessionStatus = 'cloning' | 'cloned' | 'analyzing' | 'completed' | 'failed';

// analyzeTechStack in server/agents/index.js
export interface TechStack {
  primary: string;
  secondary?: string[];
  frameworks?: string[];
  databases?: string[];
  tools?: string[];
}

// One entry of state.messages in server/agents/index.js
export interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
}

// toProgressPayload in server/utils/sessionView.js: sessionId plus any of these fields
export interface ProgressPayload {
  sessionId: string;
  step?: string;
  progress?: number;
  status?: SessionStatus;
  messages?: AgentMessage[];
  errors?: string[];
  error?: string;
  techStack?: TechStack | null;
  generatedFiles?: string[];
}

// toStatusResponse in server/utils/sessionView.js
export interface SessionStatusResponse {
  sessionId: string;
  status: SessionStatus;
  repoUrl: string;
  repoName: string;
  createdAt: string;
  clonedAt?: string;
  analysisStartedAt?: string;
  completedAt?: string;
  error?: string;
}

// toFilesResponse in server/utils/sessionView.js
export interface SessionFilesResponse {
  files?: Record<string, string>;
  techStack?: TechStack | null;
  // The verifier's review text; null (database store) or absent when there is none
  verificationResults?: string | null;
  messages?: AgentMessage[];
  errors?: string[];
  metadata?: { repoUrl: string; repoName: string; completedAt: string };
}

// 202 body of POST /api/analyze (server/server.js, B2.1): the analysis has started in the
// background; its progress and result arrive as progress events and through
// GET /api/status/:sessionId
export interface AnalyzeStartedResponse {
  success: true;
  sessionId: string;
  status: 'analyzing';
}

// Error bodies of the /api routes: a message, and a machine-readable code on some
export interface ApiErrorBody {
  error?: string;
  code?: string;
}

// 503 from POST /api/analyze when every analysis slot and queue place is taken. The
// session stays "cloned": the same session id can be retried without cloning again.
export const ANALYSIS_BUSY = 'ANALYSIS_BUSY';

// What a finished generation reports to the page that started it
export interface GenerationResult {
  sessionId: string;
  repoUrl: string;
  techStack: TechStack | null;
  generatedFiles: string[];
}

// Statuses in the order a session moves through them (server/server.js). A progress
// event can arrive late, e.g. the stored snapshot sent on subscribe; it must not move
// the displayed status backwards.
const STATUS_ORDER: Record<SessionStatus, number> = {
  cloning: 0,
  cloned: 1,
  analyzing: 2,
  completed: 3,
  failed: 3
};
export const isStatusRegression = (current: SessionStatus, next: SessionStatus) =>
  STATUS_ORDER[next] < STATUS_ORDER[current] || (current !== next && STATUS_ORDER[next] === STATUS_ORDER[current]);

// Same rule as isUuidV4 in server/utils/repository.js
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuidV4 = (value: unknown): value is string =>
  typeof value === 'string' && UUID_V4_PATTERN.test(value);
