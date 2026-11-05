import http from 'http';
import { resolvePort } from './utils/port.js';

// A probe for a container HEALTHCHECK (e.g. `HEALTHCHECK CMD node healthcheck.js`): requests
// the real server's GET /health on localhost and exits 0 on a 200, 1 otherwise. Render does
// not use it: render.yaml sets healthCheckPath: /health instead.

const options = {
  hostname: 'localhost',
  port: resolvePort(process.env),
  path: '/health',
  method: 'GET',
  timeout: 2000
};

const healthCheck = http.request(options, (res) => {
  console.log(`Health check status: ${res.statusCode}`);
  
  if (res.statusCode === 200) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

healthCheck.on('error', (err) => {
  console.error('Health check failed:', err.message);
  process.exit(1);
});

healthCheck.on('timeout', () => {
  console.error('Health check timed out');
  healthCheck.destroy();
  process.exit(1);
});

healthCheck.end(); 