import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewProposal, ReviewRequestError } from './reviewProposal.js';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function isAuthorized(req, token) {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
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

    try {
      const body = await readJsonBody(req, maxBodyBytes);
      const controller = new AbortController();
      req.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      const result = await reviewProposal(body, {
        signal: controller.signal,
        fetchImpl: options.fetchImpl,
        callbacks: options.callbacks,
      });
      sendJson(res, result.status === 'error' ? 502 : 200, result, corsHeaders);
    } catch (err) {
      const statusCode = err instanceof ReviewRequestError ? err.statusCode : 500;
      sendJson(res, statusCode, {
        error: statusCode >= 500 ? 'internal_error' : 'bad_request',
        message: err.message || String(err),
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
