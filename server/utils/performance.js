/**
 * Performance Monitoring System
 * Tracks API performance, memory usage, and system metrics
 */

import { logger, redactUrl } from './logger.js';

// Agent-session analytics are kept for one hour, and at most this many sessions
export const SESSION_ANALYTICS_MAX_AGE_MS = 60 * 60 * 1000;
export const SESSION_ANALYTICS_MAX_ENTRIES = 1000;

export class PerformanceMonitor {
  constructor({ now = Date.now, startMonitoring = true } = {}) {
    this.now = now;
    this.metrics = {
      requests: 0,
      totalResponseTime: 0,
      errors: 0,
      unhandledRejections: 0, // process-level, counted by server.js (B1.4)
      sessions: new Map(), // sessionId -> { id, startTime, phases, totalDuration }, oldest first
      systemStats: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      }
    };

    if (startMonitoring) this.startSystemMonitoring();
  }

  // Track API request performance
  trackRequest(req, res, next) {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1000000; // Convert to milliseconds

      this.metrics.requests++;
      this.metrics.totalResponseTime += duration;

      if (res.statusCode >= 400) {
        this.metrics.errors++;
      }

      // Log slow requests
      if (duration > 1000) {
        logger.warn(`Slow request detected: ${req.method} ${redactUrl(req.originalUrl)}`, {
          duration: `${duration}ms`,
          status: res.statusCode,
          ip: req.ip
        });
      }

      logger.performance(`${req.method} ${redactUrl(req.originalUrl)}`, duration, {
        status: res.statusCode,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
    });

    next();
  }

  // Track one phase of an analysis session ('clone' or 'analysis'). Callers pass timing
  // and outcome only: data is logged, so it must never hold a user id, repository name,
  // URL or error text. Each insert prunes expired entries and enforces the cap.
  trackAgentSession(sessionId, phase, duration, data = {}) {
    this.cleanupSessions();
    if (!this.metrics.sessions.has(sessionId)) {
      this.metrics.sessions.set(sessionId, {
        id: sessionId,
        startTime: this.now(),
        phases: {},
        totalDuration: 0
      });
      while (this.metrics.sessions.size > SESSION_ANALYTICS_MAX_ENTRIES) {
        this.metrics.sessions.delete(this.metrics.sessions.keys().next().value);
      }
    }

    const session = this.metrics.sessions.get(sessionId);
    session.phases[phase] = {
      duration,
      completedAt: this.now(),
      ...data
    };

    session.totalDuration += duration;

    logger.agent('performance', `Session ${sessionId} - ${phase} completed`, {
      duration: `${duration}ms`,
      sessionTotal: `${session.totalDuration}ms`,
      ...data
    });
  }

  // Operator metrics (/api/metrics, token-gated)
  getMetrics() {
    const now = this.now();
    const avgResponseTime = this.metrics.requests > 0
      ? this.metrics.totalResponseTime / this.metrics.requests
      : 0;

    return {
      uptime: process.uptime(),
      version: process.version,
      environment: process.env.NODE_ENV || 'development',
      requests: {
        total: this.metrics.requests,
        errors: this.metrics.errors,
        successRate: this.metrics.requests > 0
          ? ((this.metrics.requests - this.metrics.errors) / this.metrics.requests) * 100
          : 100,
        avgResponseTime: Math.round(avgResponseTime * 100) / 100
      },
      memory: {
        ...process.memoryUsage(),
        formatted: {
          rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`
        }
      },
      cpu: process.cpuUsage(),
      // Promise rejections nobody handled; the process keeps serving (B1.4)
      unhandledRejections: this.metrics.unhandledRejections,
      // Sessions in the analytics map (the last hour, at most 1,000), not active sessions
      trackedSessions: this.metrics.sessions.size,
      timestamp: now
    };
  }

  recordUnhandledRejection() {
    this.metrics.unhandledRejections++;
  }

  // Session analytics (/api/analytics, token-gated)
  getSessionAnalytics() {
    this.cleanupSessions();
    const sessions = Array.from(this.metrics.sessions.values());

    if (sessions.length === 0) {
      return {
        total: 0,
        avgDuration: 0,
        phases: {}
      };
    }

    const totalDuration = sessions.reduce((sum, session) => sum + session.totalDuration, 0);
    const avgDuration = totalDuration / sessions.length;

    // Calculate phase statistics
    const phaseStats = {};
    sessions.forEach(session => {
      Object.entries(session.phases).forEach(([phase, data]) => {
        if (!phaseStats[phase]) {
          phaseStats[phase] = {
            count: 0,
            totalDuration: 0,
            avgDuration: 0,
            outcomes: {}
          };
        }
        phaseStats[phase].count++;
        phaseStats[phase].totalDuration += data.duration;
        if (typeof data.outcome === 'string') {
          phaseStats[phase].outcomes[data.outcome] = (phaseStats[phase].outcomes[data.outcome] || 0) + 1;
        }
      });
    });

    // Calculate averages
    Object.keys(phaseStats).forEach(phase => {
      phaseStats[phase].avgDuration = phaseStats[phase].totalDuration / phaseStats[phase].count;
    });

    return {
      total: sessions.length,
      avgDuration: Math.round(avgDuration),
      phases: phaseStats,
      recentSessions: sessions.slice(-10).map(session => ({
        id: session.id,
        duration: session.totalDuration,
        phases: Object.keys(session.phases).length
      }))
    };
  }

  // Drop analytics entries older than SESSION_ANALYTICS_MAX_AGE_MS. Called on every
  // insert and read, and from the server's hourly session cleanup.
  cleanupSessions() {
    const cutoff = this.now() - SESSION_ANALYTICS_MAX_AGE_MS;
    for (const [sessionId, session] of this.metrics.sessions.entries()) {
      if (session.startTime < cutoff) {
        this.metrics.sessions.delete(sessionId);
      }
    }
  }

  // System monitoring. The interval never keeps the process alive on its own.
  startSystemMonitoring() {
    setInterval(() => {
      this.metrics.systemStats = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      };

      // Log system stats every 5 minutes
      if (process.uptime() % 300 < 1) {
        logger.info('System stats update', this.metrics.systemStats);
      }
    }, 1000).unref();
  }

  // Memory usage warning
  checkMemoryUsage() {
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;

    // Warning at 80% heap usage
    if (heapUsedMB / heapTotalMB > 0.8) {
      logger.warn('High memory usage detected', {
        heapUsed: `${Math.round(heapUsedMB)}MB`,
        heapTotal: `${Math.round(heapTotalMB)}MB`,
        usage: `${Math.round((heapUsedMB / heapTotalMB) * 100)}%`
      });
    }
  }
}

export const performanceMonitor = new PerformanceMonitor();

// Public liveness data for GET /health: nothing about the process beyond being up
export const getHealthStatus = () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  uptime: process.uptime()
});
