// Local stand-in for every OpenAI-compatible AI provider. One HTTP server; each provider
// lives under a path prefix (/gemini, /groq, /openrouter, /novita), so the env points
// e.g. GEMINI_BASE_URL at <url>/gemini. Every request is recorded.
import http from 'node:http';

// Default reply for requests that are not a generator call (planner, verifier)
export const FAKE_LLM_CONTENT = 'Fake review: no problems found.';
export const FAKE_PROVIDERS = Object.freeze(['gemini', 'groq', 'openrouter', 'novita']);
export const FAKE_USAGE = Object.freeze({ prompt_tokens: 11, completion_tokens: 7 });

// B2.5: valid files, one per generator kind, keyed by the file name in the output contract
export const FAKE_FILES = Object.freeze({
  dockerfile: '# Add a .dockerignore that excludes .env and .git\nFROM node:20-slim\nWORKDIR /app\nCOPY package.json ./\nRUN npm install --omit=dev\nCOPY . .\nUSER node\nCMD ["node", "index.js"]\n',
  githubActions: 'name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\npermissions:\n  contents: read\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: docker build -t app:ci .\n',
  envExample: '# Server\nPORT=3000\n'
});
const CONTRACT_FILES = Object.freeze({
  Dockerfile: { kind: 'dockerfile', info: 'dockerfile' },
  '.github/workflows/ci.yml': { kind: 'githubActions', info: 'yaml' },
  '.env.example': { kind: 'envExample', info: 'bash' }
});

// The generator kind a request asks for, from its system prompt's output contract, or null
export function generatorKindOf(requestBody) {
  const system = requestBody?.messages?.find?.((message) => message.role === 'system')?.content;
  const match = typeof system === 'string' ? system.match(/Output only the contents of `([^`]+)`/) : null;
  return match && CONTRACT_FILES[match[1]] ? CONTRACT_FILES[match[1]].kind : null;
}

// A chat-style reply (prose around one fenced block), as real models answer
export const chatReply = (kind, content) =>
  `Here is the file you asked for.\n\n\`\`\`${Object.values(CONTRACT_FILES).find((file) => file.kind === kind).info}\n${content}\`\`\`\n\nNotes: adjust as needed.`;

export function defaultContentFor(requestBody) {
  if (requestBody?.response_format) return '{"ok":true}';
  const kind = generatorKindOf(requestBody);
  return kind ? chatReply(kind, FAKE_FILES[kind]) : FAKE_LLM_CONTENT;
}

const successBody = (requestBody) => ({
  choices: [{ message: { role: 'assistant', content: defaultContentFor(requestBody) } }],
  usage: FAKE_USAGE
});
export const replyWith = (content) => ({ body: { choices: [{ message: { role: 'assistant', content } }], usage: FAKE_USAGE } });

export async function startFakeLlm({ delayMs = 0 } = {}) {
  const requests = []; // { provider, path, headers, body }
  const requestBodies = []; // raw bodies, in order (all providers)
  const queues = new Map(FAKE_PROVIDERS.map((name) => [name, []]));
  const sockets = new Set();
  let delay = delayMs;
  // Optional (requestBody, provider) => scripted response | undefined, checked before the queues
  let responder = null;

  const server = http.createServer((req, res) => {
    const match = req.url.match(/^\/([a-z]+)(\/.*)$/);
    const provider = match && queues.has(match[1]) ? match[1] : null;
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw); } catch { /* not JSON */ }
      if (!provider || req.method !== 'POST' || match[2] !== '/chat/completions') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end('{}');
      }
      requests.push({ provider, path: match[2], headers: { ...req.headers }, body });
      requestBodies.push(raw);

      // Scripted response: { status, body, headers, delayMs, hang, destroySocket }
      const scripted = (responder && responder(body, provider)) || queues.get(provider).shift() || {};
      if (scripted.hang) return; // never answer
      if (scripted.destroySocket) return req.socket.destroy();

      const status = scripted.status ?? 200;
      const responseBody = scripted.body !== undefined ? scripted.body : successBody(body);
      const text = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
      setTimeout(() => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...(scripted.headers || {}) });
        res.end(text);
      }, scripted.delayMs ?? delay);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    baseUrlFor: (provider) => `${url}/${provider}`,
    requests,
    requestBodies,
    requestsFor: (provider) => requests.filter((r) => r.provider === provider),
    // Queue scripted responses for one provider; when the queue is empty, the default success is used
    enqueue(provider, ...responses) {
      queues.get(provider).push(...responses);
    },
    reset() {
      requests.length = 0;
      requestBodies.length = 0;
      for (const queue of queues.values()) queue.length = 0;
      delay = delayMs;
      responder = null;
    },
    setResponder(fn) {
      responder = fn;
    },
    setDelay(ms) {
      delay = ms;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
