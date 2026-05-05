import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { installQueryModel, resetQueryModel } from '../../src/api/openrouter.js';
import { createReviewServer } from '../../src/service/server.js';
import { createMockQueryModel } from '../../eval/mockApi.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const FIXTURE = JSON.parse(readFileSync(join(REPO, 'eval', 'fixtures', '_defaults.json'), 'utf8'));

class MockRequest extends Readable {
  constructor({ method = 'GET', url = '/', headers = {}, body = '' } = {}) {
    super();
    this.method = method;
    this.url = url;
    this.headers = { host: 'localhost', ...headers };
    this.body = body;
    this.socket = { remoteAddress: '127.0.0.1' };
  }

  _read() {
    if (this.body != null) {
      this.push(this.body);
      this.body = null;
    } else {
      this.push(null);
    }
  }
}

function request(server, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = new MockRequest({ method, url, headers, body });
    const res = {
      statusCode: 200,
      headers: {},
      writableEnded: false,
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders;
      },
      end(payload = '') {
        this.writableEnded = true;
        try {
          resolve({
            status: this.statusCode,
            headers: this.headers,
            text: String(payload),
            json: payload ? JSON.parse(String(payload)) : null,
          });
        } catch (err) {
          reject(err);
        }
      },
    };
    server.emit('request', req, res);
  });
}

beforeEach(() => {
  installQueryModel(createMockQueryModel(FIXTURE));
});

afterEach(() => {
  resetQueryModel();
});

describe('review service', () => {
  it('reports health', async () => {
    const server = createReviewServer({ token: 'secret' });
    const response = await request(server, { url: '/health' });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);
    expect(response.json.authRequired).toBe(true);
  });

  it('requires bearer auth when token is configured', async () => {
    const server = createReviewServer({ token: 'secret' });
    const response = await request(server, {
      method: 'POST',
      url: '/review',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposalText: FIXTURE.mockResponses.draft }),
    });
    expect(response.status).toBe(401);
  });

  it('reviews proposal text over HTTP', async () => {
    const server = createReviewServer({ token: 'secret' });
    const response = await request(server, {
      method: 'POST',
      url: '/review',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        proposalText: FIXTURE.mockResponses.draft,
        models: {
          drafter: 'mock/drafter',
          reviewers: [{ id: 'mock/reviewer-a', name: 'Mock Reviewer A' }],
        },
        options: { evidence: 'none' },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.json.status).toBe('reviewed');
    expect(response.json.reviews[0].reviewProse).toContain('Baseline clean review');
    expect(response.json.run.aggregation.overall).toBe('pass');
  });

  it('accepts the explicit service token header', async () => {
    const server = createReviewServer({ token: 'secret' });
    const response = await request(server, {
      method: 'POST',
      url: '/review',
      headers: {
        'x-pm-tools-token': 'secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        proposalText: FIXTURE.mockResponses.draft,
        models: {
          drafter: 'mock/drafter',
          reviewers: [{ id: 'mock/reviewer-a', name: 'Mock Reviewer A' }],
        },
        options: { evidence: 'none' },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.json.status).toBe('reviewed');
  });

  it('rate limits repeated review requests from the same client', async () => {
    const server = createReviewServer({
      token: 'secret',
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000,
    });
    const payload = {
      proposalText: FIXTURE.mockResponses.draft,
      models: {
        drafter: 'mock/drafter',
        reviewers: [{ id: 'mock/reviewer-a', name: 'Mock Reviewer A' }],
      },
      options: { evidence: 'none' },
    };
    const first = await request(server, {
      method: 'POST',
      url: '/review',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const second = await request(server, {
      method: 'POST',
      url: '/review',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.json.error).toBe('rate_limited');
    expect(Number(second.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('rejects concurrent review jobs above the configured cap', async () => {
    let releaseFirst;
    let firstStarted;
    const firstStartedPromise = new Promise((resolve) => {
      firstStarted = resolve;
    });
    const releaseFirstPromise = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const reviewImpl = async () => {
      firstStarted();
      await releaseFirstPromise;
      return { status: 'reviewed', summary: {}, reviews: [], run: {} };
    };
    const server = createReviewServer({
      token: 'secret',
      maxConcurrentReviews: 1,
      rateLimitMax: 10,
      reviewImpl,
    });
    const body = JSON.stringify({ proposalText: FIXTURE.mockResponses.draft });
    const first = request(server, {
      method: 'POST',
      url: '/review',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body,
    });
    await firstStartedPromise;

    const second = await request(server, {
      method: 'POST',
      url: '/review',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body,
    });
    releaseFirst();
    const firstResponse = await first;

    expect(second.status).toBe(429);
    expect(second.json.error).toBe('too_many_active_reviews');
    expect(firstResponse.status).toBe(200);
  });
});
