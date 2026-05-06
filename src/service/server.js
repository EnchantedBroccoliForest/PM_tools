import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewProposal, ReviewRequestError } from './reviewProposal.js';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_REVIEWS = 2;
const DEFAULT_RATE_LIMIT_MAX = 20;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

function readPackageVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '..', '..', 'package.json'), 'utf8');
    return JSON.parse(raw).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function sendJson(res, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function buildCorsHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-PM-Tools-Token',
  };
}

function timingSafeTokenEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualHash = crypto.createHash('sha256').update(actual).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function extractAuthToken(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string') {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1];
  }
  const headerToken = req.headers['x-pm-tools-token'];
  return typeof headerToken === 'string' ? headerToken : '';
}

function isAuthorized(req, token) {
  if (!token) return true;
  return timingSafeTokenEqual(extractAuthToken(req), token);
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getClientId(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function createRateLimiter({ max, windowMs }) {
  const buckets = new Map();
  return {
    check(req) {
      if (max <= 0) return { allowed: true, remaining: Infinity, resetAt: Date.now() + windowMs };
      const now = Date.now();
      const clientId = getClientId(req);
      let bucket = buckets.get(clientId);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(clientId, bucket);
      }
      if (bucket.count >= max) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: bucket.resetAt,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        };
      }
      bucket.count += 1;
      return {
        allowed: true,
        remaining: Math.max(0, max - bucket.count),
        resetAt: bucket.resetAt,
      };
    },
  };
}

function createConcurrencyGate(max) {
  let active = 0;
  return {
    tryAcquire() {
      if (max <= 0) {
        active += 1;
        return true;
      }
      if (active >= max) return false;
      active += 1;
      return true;
    },
    release() {
      active = Math.max(0, active - 1);
    },
    snapshot() {
      return { active, max };
    },
  };
}

function readJsonBody(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new ReviewRequestError(`Request body exceeds ${maxBodyBytes} bytes`, 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        reject(new ReviewRequestError('Request body must be valid JSON', 400));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new ReviewRequestError(`Request body must be valid JSON: ${err.message}`, 400));
      }
    });
  });
}

export function createReviewServer(options = {}) {
  const token = options.token || process.env.PM_TOOLS_SERVICE_TOKEN || '';
  const corsHeaders = buildCorsHeaders(options.corsOrigin || process.env.PM_TOOLS_CORS_ORIGIN || '*');
  const maxBodyBytes = Number(options.maxBodyBytes || process.env.PM_TOOLS_MAX_BODY_BYTES) || DEFAULT_MAX_BODY_BYTES;
  const maxConcurrentReviews = readPositiveInt(
    options.maxConcurrentReviews || process.env.PM_TOOLS_MAX_CONCURRENT_REVIEWS,
    DEFAULT_MAX_CONCURRENT_REVIEWS,
  );
  const rateLimitMax = readPositiveInt(
    options.rateLimitMax || process.env.PM_TOOLS_RATE_LIMIT_MAX,
    DEFAULT_RATE_LIMIT_MAX,
  );
  const rateLimitWindowMs = readPositiveInt(
    options.rateLimitWindowMs || process.env.PM_TOOLS_RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  );
  const reviewImpl = options.reviewImpl || reviewProposal;
  const rateLimiter = createRateLimiter({ max: rateLimitMax, windowMs: rateLimitWindowMs });
  const concurrency = createConcurrencyGate(maxConcurrentReviews);
  const version = readPackageVersion();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {}, corsHeaders);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'pm-tools-review',
        version,
        authRequired: Boolean(token),
        limits: {
          maxBodyBytes,
          maxConcurrentReviews,
          rateLimitMax,
          rateLimitWindowMs,
          activeReviews: concurrency.snapshot().active,
        },
      }, corsHeaders);
      return;
    }

    if (req.method !== 'POST' || url.pathname !== '/review') {
      sendJson(res, 404, {
        error: 'not_found',
        message: 'Use GET /health or POST /review',
      }, corsHeaders);
      return;
    }

    if (!isAuthorized(req, token)) {
      sendJson(res, 401, {
        error: 'unauthorized',
        message: 'Missing or invalid bearer token',
      }, corsHeaders);
      return;
    }

    const rateLimit = rateLimiter.check(req);
    if (!rateLimit.allowed) {
      sendJson(res, 429, {
        error: 'rate_limited',
        message: 'Too many review requests from this client. Try again later.',
      }, {
        ...corsHeaders,
        'Retry-After': String(rateLimit.retryAfterSeconds),
        'X-RateLimit-Limit': String(rateLimitMax),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
      });
      return;
    }

    try {
      const body = await readJsonBody(req, maxBodyBytes);
      if (!concurrency.tryAcquire()) {
        sendJson(res, 429, {
          error: 'too_many_active_reviews',
          message: 'Too many review jobs are already running. Try again shortly.',
        }, {
          ...corsHeaders,
          'Retry-After': '5',
          'X-RateLimit-Limit': String(rateLimitMax),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
        });
        return;
      }
      const controller = new AbortController();
      req.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      try {
        const result = await reviewImpl(body, {
          signal: controller.signal,
          fetchImpl: options.fetchImpl,
          callbacks: options.callbacks,
        });
        sendJson(res, result.status === 'error' ? 502 : 200, result, {
          ...corsHeaders,
          'X-RateLimit-Limit': String(rateLimitMax),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
        });
      } finally {
        concurrency.release();
      }
    } catch (err) {
      const isRequestError = err instanceof ReviewRequestError;
      const statusCode = isRequestError ? err.statusCode : 500;
      if (!isRequestError) {
        console.error('Unhandled review server error:', err);
      }
      sendJson(res, statusCode, {
        error: statusCode >= 500 ? 'internal_error' : 'bad_request',
        message: isRequestError ? (err.message || String(err)) : 'An internal error occurred.',
      }, corsHeaders);
    }
  });
}

export function startReviewServer(options = {}) {
  const server = createReviewServer(options);
  const host = options.host || process.env.PM_TOOLS_HOST || '127.0.0.1';
  const port = Number(options.port || process.env.PORT || process.env.PM_TOOLS_PORT || 8787);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
