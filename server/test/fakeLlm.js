// Local stand-in for every OpenAI-compatible AI provider. One HTTP server; each provider
// lives under a path prefix (/gemini, /groq, /openrouter, /novita), so the env points
// e.g. GEMINI_BASE_URL at <url>/gemini. Every request is recorded.
import http from 'node:http';

export const FAKE_LLM_CONTENT = '```dockerfile\nFROM node:20\n```';
export const FAKE_PROVIDERS = Object.freeze(['gemini', 'groq', 'openrouter', 'novita']);
export const FAKE_USAGE = Object.freeze({ prompt_tokens: 11, completion_tokens: 7 });

const successBody = (requestBody) => ({
  choices: [{ message: { role: 'assistant', content: requestBody?.response_format ? '{"ok":true}' : FAKE_LLM_CONTENT } }],
  usage: FAKE_USAGE
});

export async function startFakeLlm({ delayMs = 0 } = {}) {
  const requests = []; // { provider, path, headers, body }
  const requestBodies = []; // raw bodies, in order (all providers)
  const queues = new Map(FAKE_PROVIDERS.map((name) => [name, []]));
  const sockets = new Set();
  let delay = delayMs;

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
      const scripted = queues.get(provider).shift() || {};
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
