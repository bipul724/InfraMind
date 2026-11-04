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

// Agent messages as sent to the browser: { agent, message, timestamp } copied field by
// field. An entry is kept only when agent and message are strings; timestamp is copied
// only when it is a string. Anything that is not an array gives [].
export function toAgentMessages(value) {
  if (!Array.isArray(value)) return [];
  const messages = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.agent !== 'string' || typeof entry.message !== 'string') continue;
    const message = { agent: entry.agent, message: entry.message };
    if (typeof entry.timestamp === 'string') message.timestamp = entry.timestamp;
    messages.push(message);
  }
  return messages;
}

// Agent errors as sent to the browser: the string entries only
export function toErrorList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

export function toFilesResponse(session) {
  const result = session.analysisResult || {};
  return {
    files: result.generatedFiles,
    techStack: result.techStack,
    codebaseAnalysis: result.codebaseAnalysis,
    verificationResults: result.verificationResults,
    messages: toAgentMessages(session.messages),
    errors: toErrorList(session.errors),
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
