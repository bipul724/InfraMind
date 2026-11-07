import { pathToFileURL } from 'node:url';

function originUrl(name, origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new TypeError(`${name} must be an HTTP(S) origin.`);
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) {
    throw new TypeError(`${name} must be an HTTP(S) origin without credentials or a path.`);
  }
  return url;
}

export function buildCsp({ apiOrigin, supabaseOrigin }) {
  const api = originUrl('apiOrigin', apiOrigin);
  originUrl('supabaseOrigin', supabaseOrigin);
  const socket = new URL(api.origin);
  socket.protocol = api.protocol === 'https:' ? 'wss:' : 'ws:';

  // Socket.IO uses the API's websocket origin; Supabase only uses Auth and REST in this app.
  const connections = [...new Set(["'self'", apiOrigin, socket.origin, supabaseOrigin])];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com https://*.googleusercontent.com",
    `connect-src ${connections.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) {
    console.error('Usage: node client/scripts/csp.mjs <apiOrigin> <supabaseOrigin>');
    process.exitCode = 1;
  } else {
    try {
      console.log(buildCsp({ apiOrigin: process.argv[2], supabaseOrigin: process.argv[3] }));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
