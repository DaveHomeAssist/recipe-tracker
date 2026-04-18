import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import sessionHandler from '../../api/v1/session.js';
import recipesHandler from '../../api/v1/recipes/index.js';
import importHandler from '../../api/v1/import.js';
import clientErrorHandler from '../../api/v1/log/client-error.js';
import { createSessionToken } from '../../src/server/session.js';
import { queryAllRecipes } from '../../src/server/notion-api.js';

const makeReq = ({ method = 'GET', headers = {}, body, query, url = '/api/test' } = {}) => ({
  method,
  headers,
  body,
  query,
  url,
  [Symbol.asyncIterator]: async function* () {
    if (body === undefined) return;
    yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  },
});

const makeRes = () => {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: '',
    setHeader(name, value) {
      headers[name] = value;
    },
    writeHead(statusCode, extraHeaders = {}) {
      this.statusCode = statusCode;
      Object.assign(headers, extraHeaders);
    },
    end(payload = '') {
      this.body = String(payload || '');
    },
  };
};

const jsonResponse = (status, body, responseHeaders = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get(name) {
      return responseHeaders[name] ?? responseHeaders[String(name).toLowerCase()] ?? null;
    },
  },
  json: async () => body,
});

describe('backend auth, cors, and validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SESSION_SECRET: 'test-session-secret',
      FAMILY_ACCESS_CODE: 'family-code',
      ALLOWED_ORIGINS: 'https://davehomeassist.github.io,https://recipe-tracker.vercel.app',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('issues a scoped bearer session token with a 24h expiry', async () => {
    const req = makeReq({
      method: 'POST',
      body: { accessCode: 'family-code' },
      headers: { origin: 'https://davehomeassist.github.io' },
      url: '/api/v1/session',
    });
    const res = makeRes();

    await sessionHandler(req, res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.authenticated).toBe(true);
    expect(typeof payload.token).toBe('string');
    expect(payload.scope).toBe('recipe_journal');
    expect(Date.parse(payload.expiresAt)).toBeGreaterThan(Date.parse(payload.issuedAt));
  });

  it('rejects disallowed origins with 403 instead of silently reflecting CORS', async () => {
    const req = makeReq({
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.com' },
      url: '/api/v1/session',
    });
    const res = makeRes();

    await sessionHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CORS_FORBIDDEN');
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('applies the same origin allowlist to client error reports', async () => {
    const req = makeReq({
      method: 'POST',
      headers: { origin: 'https://evil.example.com' },
      body: { kind: 'error', message: 'boom' },
      url: '/api/v1/log/client-error',
    });
    const res = makeRes();

    await clientErrorHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CORS_FORBIDDEN');
  });

  it('rejects invalid recipe payloads before they reach Notion', async () => {
    const { token } = createSessionToken(process.env.SESSION_SECRET, Date.now(), 60);
    const req = makeReq({
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: { cuisine: 'Italian' },
      url: '/api/v1/recipes',
    });
    const res = makeRes();

    await recipesHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects invalid import payloads before they reach Notion', async () => {
    const { token } = createSessionToken(process.env.SESSION_SECRET, Date.now(), 60);
    const req = makeReq({
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: { mode: 'merge', payload: { schemaVersion: 5, foo: 'bar' } },
      url: '/api/v1/import',
    });
    const res = makeRes();

    await importHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('IMPORT_INVALID');
  });
});

describe('notion rate-limit handling', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NOTION_ACCESS_TOKEN: 'server-secret',
      NOTION_DATA_SOURCE_ID: 'ds_123',
      RATE_LIMIT_RETRY_MAX: '3',
      RATE_LIMIT_BASE_DELAY_MS: '1',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('retries 429 responses with backoff and eventually succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: 'slow down' }, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(jsonResponse(429, { message: 'slow down' }, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        results: [],
        has_more: false,
        next_cursor: null,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const recipes = await queryAllRecipes();

    expect(recipes).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after the configured retries and surfaces RATE_LIMITED', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(429, { message: 'still slow' }, { 'Retry-After': '0' })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(queryAllRecipes()).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
