#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { startReviewServer } from '../src/service/server.js';

const USAGE = `\
pm-tools-service — HTTP review service for existing market proposal text

USAGE
  pm-tools-service [--host 127.0.0.1] [--port 8787]

FLAGS
  --host                    Bind host (default: 127.0.0.1)
  --port                    Bind port (default: 8787, or PORT/PM_TOOLS_PORT)
  --token                   Bearer token required by POST /review
  --allow-unauthenticated   Allow non-localhost service without a token
  --help, -h                Show this help

ENVIRONMENT
  OPENROUTER_API_KEY         Required for live reviews
  VITE_OPENROUTER_API_KEY    Fallback API key
  PM_TOOLS_SERVICE_TOKEN     Bearer token for POST /review
  PM_TOOLS_HOST              Default host
  PM_TOOLS_PORT              Default port
  PM_TOOLS_CORS_ORIGIN       CORS origin, default *

ENDPOINTS
  GET  /health
  POST /review
`;

function hasApiKey() {
  return Boolean(
    process.env.OPENROUTER_API_KEY ||
    process.env.VITE_OPENROUTER_API_KEY ||
    process.env.VITE_OPENAI_API_KEY
  );
}

function isLocalHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

async function main() {
  const { values } = parseArgs({
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      token: { type: 'string' },
      'allow-unauthenticated': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  if (!hasApiKey()) {
    process.stderr.write(
      'Error: No API key found. Set OPENROUTER_API_KEY in your environment.\n' +
      '  export OPENROUTER_API_KEY=sk-or-...\n'
    );
    process.exit(2);
  }

  const host = values.host || process.env.PM_TOOLS_HOST || '127.0.0.1';
  const port = Number(values.port || process.env.PORT || process.env.PM_TOOLS_PORT || 8787);
  const token = values.token || process.env.PM_TOOLS_SERVICE_TOKEN || '';

  if (!token && !isLocalHost(host) && !values['allow-unauthenticated']) {
    process.stderr.write(
      'Error: Refusing to bind a network-facing review service without auth.\n' +
      'Set PM_TOOLS_SERVICE_TOKEN or pass --token. For deliberate local testing, pass --allow-unauthenticated.\n'
    );
    process.exit(2);
  }

  const server = await startReviewServer({ host, port, token });
  const address = server.address();
  const actualHost = typeof address === 'object' && address ? address.address : host;
  const actualPort = typeof address === 'object' && address ? address.port : port;
  process.stderr.write(`pm-tools review service listening on http://${actualHost}:${actualPort}\n`);
  process.stderr.write(token ? 'POST /review requires Authorization: Bearer <token>\n' : 'POST /review is unauthenticated\n');

  const shutdown = () => {
    process.stderr.write('\nShutting down pm-tools review service...\n');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message || err}\n`);
  process.exit(2);
});
