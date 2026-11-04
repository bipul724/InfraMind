/**
 * Enhanced Security Middleware
 * Provides rate limiting, security headers and request logging
 */

import rateLimit, { MemoryStore } from 'express-rate-limit';
import helmet from 'helmet';
import { logger, redactUrl } from './logger.js';

// Rate limiting (B1.4). Memory store: counts are per server process, so they hold for
// one instance only. Limits come from utils/config.js (readRateLimits); nothing here
// can switch limiting off.
export const RATE_LIMITED_CODE = 'RATE_LIMITED';

// The path only: never a query string, token or body
const pathOf = (url = '') => String(url).split('?')[0];

// ---------------------------------------------------------------------------
// Rate-limit keys for IP addresses. One IPv6 client usually controls a whole /64 (often
// a /56 or /48), so keying by the full address would let it rotate addresses and never
// be limited. IPv6 is counted per /56 prefix; IPv4, and IPv4-mapped IPv6, per address.

export const UNKNOWN_IP_KEY = 'ip:unknown';
export const IPV6_PREFIX_BITS = 56;

// Strict dotted quad: four decimal parts 0-255, no leading zeros
function parseIPv4(text) {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

// An IPv6 address (lower case, zone id already removed) as eight 16-bit groups, or null.
// Accepts the "::" compression and a trailing embedded IPv4 address.
function parseIPv6(text) {
  if (text === '' || (text.match(/::/g) || []).length > 1 || text.includes(':::')) return null;
  const toGroups = (part) => {
    if (part === '') return [];
    const pieces = part.split(':');
    const groups = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (i === pieces.length - 1 && piece.includes('.')) {
        const bytes = parseIPv4(piece);
        if (!bytes) return null;
        groups.push((bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) {
        groups.push(parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return groups;
  };
  const halves = text.split('::');
  const head = toGroups(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1]);
  if (!tail || head.length + tail.length > 7) return null;
  return [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
}

// RFC 5952 text form: lower case, no leading zeros, the longest run of two or more zero
// groups (the first, on a tie) written as "::"
function formatIPv6(groups) {
  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength) { bestStart = i; bestLength = j - i; }
    i = j;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestStart === -1) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

/**
 * rateLimitKeyForIp(ip) -> the bucket key for a client address:
 * "ip4:1.2.3.4" for IPv4 and IPv4-mapped IPv6 (::ffff:1.2.3.4), "ip6:<prefix>/56" for
 * any other IPv6 address (zone id dropped, any case, compressed or full form), and
 * "ip:unknown" for anything else, so an unparsable address cannot escape limiting.
 */
export function rateLimitKeyForIp(ip) {
  if (typeof ip !== 'string') return UNKNOWN_IP_KEY;
  let text = ip.trim().toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (text === '') return UNKNOWN_IP_KEY;

  const v4 = parseIPv4(text);
  if (v4) return `ip4:${v4.join('.')}`;

  const groups = parseIPv6(text);
  if (!groups) return UNKNOWN_IP_KEY;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return `ip4:${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
  }
  // Keep the first 56 bits: three whole groups and the high byte of the fourth
  const prefix = [groups[0], groups[1], groups[2], groups[3] & 0xff00, 0, 0, 0, 0];
  return `ip6:${formatIPv6(prefix)}/${IPV6_PREFIX_BITS}`;
}

// IP-keyed limiters log the IP; user-keyed ones log the user id
function logRateLimited(limit, { ip, userId, endpoint }) {
  const who = limit.key === 'user' ? `user ${userId}` : `IP ${ip}`;
  logger.warn(`Rate limit ${limit.name} exceeded for ${who}`, { limit: limit.name, ...(limit.key === 'user' ? { userId } : { ip }), endpoint });
}

export function createRateLimiter(limit) {
  return rateLimit({
    windowMs: limit.windowMs,
    limit: limit.max,
    standardHeaders: true, // RateLimit-* headers, and Retry-After on a 429
    legacyHeaders: false,
    // User-keyed limiters run after requireUser, so req.user is always set there.
    // IP-keyed ones count IPv6 per /56 (rateLimitKeyForIp), never the raw req.ip.
    keyGenerator: limit.key === 'user' ? (req) => `user:${req.user.id}` : (req) => rateLimitKeyForIp(req.ip),
    handler: (req, res) => {
      logRateLimited(limit, { ip: req.ip, userId: req.user?.id, endpoint: pathOf(req.originalUrl) });
      res.status(429).json({ error: limit.message, code: RATE_LIMITED_CODE });
    }
  });
}

// { <name>: middleware } for every Express limiter in `limits` (from readRateLimits)
export function createRateLimiters(limits) {
  const limiters = {};
  for (const limit of Object.values(limits)) {
    if (limit.name !== 'socketHandshake') limiters[limit.name] = createRateLimiter(limit);
  }
  return limiters;
}

// Socket.IO middleware that counts handshakes per IP, before any token is verified.
// ipOf(socket) must derive the IP exactly as Express does (see server.js).
export function createSocketHandshakeLimiter(limit, ipOf) {
  const store = new MemoryStore();
  store.init({ windowMs: limit.windowMs });
  const middleware = async (socket, next) => {
    const ip = ipOf(socket);
    try {
      const { totalHits } = await store.increment(rateLimitKeyForIp(ip));
      if (totalHits > limit.max) {
        logRateLimited(limit, { ip, endpoint: 'socket.io handshake' });
        return next(new Error(RATE_LIMITED_CODE));
      }
    } catch {
      // A store failure must not let the handshake bypass verification; the next
      // middleware still verifies the token
    }
    next();
  };
  middleware.store = store;
  return middleware;
}

// Security headers configuration
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.github.com", "https://*.supabase.co"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
});

// Request logging middleware
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const url = redactUrl(req.originalUrl);
    logger.info(`${req.method} ${url}`, {
      method: req.method,
      url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  });
  
  next();
};
