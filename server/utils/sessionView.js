/**
 * Allow-list serializers for everything the server sends about a session.
 * Never spread a session object or progress data: copy named fields only,
 * so a field added to the session later (a token, a path) cannot leak.
 */

export function toStatusResponse(sessionId, session) {
  return {
    sessionId,
    status: session.status,
    repoUrl: session.displayUrl,
    repoName: session.repoName,
    createdAt: session.createdAt,
    clonedAt: session.clonedAt,
    analysisStartedAt: session.analysisStartedAt,
    completedAt: session.completedAt,
    error: session.error
  };
}

export function toFilesResponse(session) {
  const result = session.analysisResult || {};
  return {
    files: result.generatedFiles,
    techStack: result.techStack,
    codebaseAnalysis: result.codebaseAnalysis,
    verificationResults: result.verificationResults,
    metadata: {
      repoUrl: session.displayUrl,
      repoName: session.repoName,
      completedAt: session.completedAt
    }
  };
}

const PROGRESS_FIELDS = ['step', 'progress', 'status', 'messages', 'errors', 'error', 'techStack', 'generatedFiles'];

export function toProgressPayload(sessionId, data = {}) {
  const payload = { sessionId };
  for (const field of PROGRESS_FIELDS) {
    if (data && Object.prototype.hasOwnProperty.call(data, field) && data[field] !== undefined) {
      payload[field] = data[field];
    }
  }
  return payload;
}
