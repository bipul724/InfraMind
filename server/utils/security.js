/**
 * Enhanced Security Middleware
 * Provides rate limiting, security headers and request logging
 */

import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { logger, redactUrl } from './logger.js';

// Rate limiting configurations
export const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn(`Rate limit exceeded for IP: ${req.ip}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: redactUrl(req.originalUrl)
      });
      res.status(429).json({ error: message });
    }
  });
};

// Rate limits for the resource-intensive endpoints (server.js applies both)
export const rateLimiters = {
  // More restrictive for resource-intensive operations
  analysis: createRateLimiter(5 * 60 * 1000, 5, 'Too many analysis requests, please wait before trying again'),
  
  // Clone operations
  clone: createRateLimiter(10 * 60 * 1000, 10, 'Too many clone requests, please wait before trying again')
};

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
