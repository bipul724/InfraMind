// Local stand-in for the OpenAI-compatible chat completions API used by the agents
import http from 'node:http';

export const FAKE_LLM_CONTENT = '```dockerfile\nFROM node:20\n```';

export async function startFakeLlm({ delayMs = 0 } = {}) {
  const requestBodies = [];
  const sockets = new Set();
  let delay = delayMs;

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requestBodies.push(body);
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: FAKE_LLM_CONTENT } }] }));
      }, delay);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requestBodies,
    setDelay(ms) {
      delay = ms;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
