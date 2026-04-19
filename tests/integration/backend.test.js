import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import healthHandler from '../../api/health.js';
import recipeHandler from '../../api/recipes/index.js';
import recipeItemHandler from '../../api/recipes/[id].js';
import recipeSyncHandler from '../../api/recipes/sync.js';
import clientErrorHandler from '../../api/log/client-error.js';
import { __setNotionClientForTests } from '../../src/server/notion-api.js';
import { __resetWriteRateLimitForTests } from '../../src/server/write-rate-limit.js';

const makeReq = ({ method = 'GET', headers = {}, body, query, url = '/api/test', socket } = {}) => ({
  method,
  headers,
  body,
  query,
  url,
  socket: socket || { remoteAddress: '127.0.0.1' },
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

const makePage = ({
  pageId = 'page_1',
  appId = 'recipe_1',
  name = 'Cacio e Pepe',
  url = 'https://example.com/cacio',
  image = '',
  version = 1,
} = {}) => ({
  id: pageId,
  properties: {
    'App ID': { rich_text: [{ plain_text: appId }] },
    'Recipe Name': { title: [{ plain_text: name }] },
    Cuisine: { rich_text: [{ plain_text: 'Italian' }] },
    Source: { rich_text: [{ plain_text: 'Trattoria' }] },
    Location: { rich_text: [{ plain_text: 'Rome' }] },
    'Prep Time': { rich_text: [{ plain_text: '10 min' }] },
    'Cook Time': { rich_text: [{ plain_text: '20 min' }] },
    Servings: { rich_text: [{ plain_text: '2' }] },
    Tags: { rich_text: [{ plain_text: 'Pasta' }] },
    'Source URL': { url },
    Photos: image ? {
      files: [
        {
          type: 'external',
          external: { url: image },
        },
      ],
    } : { files: [] },
    'Date Tried': { date: { start: '2026-04-19' } },
    Rating: { number: 4 },
    Notes: { rich_text: [{ plain_text: 'Family favorite' }] },
    Ingredients: { rich_text: [{ plain_text: 'pecorino' }] },
    Steps: { rich_text: [{ plain_text: 'mix' }] },
    Version: { number: version },
  },
});

describe('recipe proxy handlers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      FAMILY_ACCESS_CODE: 'family-code',
      ALLOWED_ORIGINS: 'https://davehomeassist.github.io',
      NOTION_ACCESS_TOKEN: 'server-secret',
      NOTION_DATA_SOURCE_ID: 'ds_123',
      RATE_LIMIT_BASE_DELAY_MS: '1',
    };
    __resetWriteRateLimitForTests();
  });

  afterEach(() => {
    __setNotionClientForTests(null);
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('returns recipe rows from GET /api/recipes', async () => {
    __setNotionClientForTests({
      dataSources: {
        query: vi.fn().mockResolvedValue({
          results: [makePage()],
          has_more: false,
          next_cursor: null,
        }),
      },
      pages: {},
    });

    const req = makeReq({
      method: 'GET',
      headers: {
        origin: 'https://davehomeassist.github.io',
        'x-family-code': 'family-code',
      },
      url: '/api/recipes',
    });
    const res = makeRes();

    await recipeHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data[0]).toMatchObject({
      id: 'recipe_1',
      name: 'Cacio e Pepe',
    });
  });

  it('returns a single recipe from GET /api/recipes/:id', async () => {
    __setNotionClientForTests({
      dataSources: {
        query: vi.fn().mockResolvedValue({
          results: [makePage()],
          has_more: false,
          next_cursor: null,
        }),
      },
      pages: {},
    });

    const req = makeReq({
      method: 'GET',
      headers: { 'x-family-code': 'family-code' },
      query: { id: 'recipe_1' },
      url: '/api/recipes/recipe_1',
    });
    const res = makeRes();

    await recipeItemHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.recipe.id).toBe('recipe_1');
  });

  it('rejects an invalid family code with 401', async () => {
    const req = makeReq({
      method: 'GET',
      headers: { 'x-family-code': 'wrong' },
      url: '/api/health',
    });
    const res = makeRes();

    await healthHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_FAMILY_CODE');
  });

  it('rejects disallowed origins with 403', async () => {
    const req = makeReq({
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example.com',
        'x-family-code': 'family-code',
      },
      url: '/api/recipes',
    });
    const res = makeRes();

    await recipeHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CORS_FORBIDDEN');
  });

  it('creates recipes through POST /api/recipes', async () => {
    const createMock = vi.fn().mockResolvedValue(makePage({ appId: 'recipe_2', pageId: 'page_2', name: 'Soup' }));
    __setNotionClientForTests({
      dataSources: {
        query: vi.fn(),
      },
      pages: {
        create: createMock,
      },
    });

    const req = makeReq({
      method: 'POST',
      headers: { 'x-family-code': 'family-code' },
      body: {
        name: 'Soup',
        ingredients: 'Water',
        instructions: 'Heat',
        sourceUrl: 'https://example.com/soup',
      },
      url: '/api/recipes',
    });
    const res = makeRes();

    await recipeHandler(req, res);

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].properties['Recipe Name'].title[0].text.content).toBe('Soup');
    expect(createMock.mock.calls[0][0].properties['Source URL'].url).toBe('https://example.com/soup');
  });

  it('archives recipes through DELETE /api/recipes/:id', async () => {
    const updateMock = vi.fn().mockResolvedValue({});
    __setNotionClientForTests({
      dataSources: {
        query: vi.fn().mockResolvedValue({
          results: [makePage({ version: 3 })],
          has_more: false,
          next_cursor: null,
        }),
      },
      pages: {
        update: updateMock,
      },
    });

    const req = makeReq({
      method: 'DELETE',
      headers: { 'x-family-code': 'family-code' },
      body: { version: 3 },
      query: { id: 'recipe_1' },
      url: '/api/recipes/recipe_1',
    });
    const res = makeRes();

    await recipeItemHandler(req, res);

    expect(res.statusCode).toBe(204);
    expect(updateMock).toHaveBeenCalledWith({
      page_id: 'page_1',
      in_trash: true,
    });
  });

  it('increments the recipe version through PATCH /api/recipes/:id', async () => {
    const updateMock = vi.fn().mockResolvedValue(makePage({ version: 2 }));
    __setNotionClientForTests({
      dataSources: {
        query: vi.fn().mockResolvedValue({
          results: [makePage({ version: 1 })],
          has_more: false,
          next_cursor: null,
        }),
      },
      pages: {
        update: updateMock,
      },
    });

    const req = makeReq({
      method: 'PATCH',
      headers: { 'x-family-code': 'family-code' },
      body: {
        version: 1,
        notes: 'Updated remotely',
      },
      query: { id: 'recipe_1' },
      url: '/api/recipes/recipe_1',
    });
    const res = makeRes();

    await recipeItemHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0].properties.Version.number).toBe(2);
    expect(JSON.parse(res.body).data.recipe.version).toBe(2);
  });

  it('syncs a local corpus by deduping on source URL', async () => {
    const createMock = vi.fn().mockResolvedValue(makePage({ appId: 'recipe_3', pageId: 'page_3', name: 'Soup' }));
    __setNotionClientForTests({
      dataSources: {
        query: vi.fn().mockResolvedValue({
          results: [makePage({ appId: 'recipe_existing', url: 'https://example.com/existing' })],
          has_more: false,
          next_cursor: null,
        }),
      },
      pages: {
        create: createMock,
      },
    });

    const req = makeReq({
      method: 'POST',
      headers: { 'x-family-code': 'family-code' },
      body: {
        payload: {
          schemaVersion: 5,
          recipes: [
            { id: 'recipe_existing', name: 'Existing', sourceUrl: 'https://example.com/existing' },
            { id: 'recipe_new', name: 'New Soup', sourceUrl: 'https://example.com/new-soup' },
          ],
        },
      },
      url: '/api/recipes/sync',
    });
    const res = makeRes();

    await recipeSyncHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.body).data).toMatchObject({
      added: 1,
      duplicatesSkipped: 1,
    });
  });

  it('backfills missing Notion photos for duplicate URLs during sync', async () => {
    const updateMock = vi.fn().mockResolvedValue(
      makePage({
        appId: 'recipe_existing',
        url: 'https://example.com/existing',
        image: 'https://example.com/existing.jpg',
        version: 2,
      })
    );
    const createMock = vi.fn();
    __setNotionClientForTests({
      dataSources: {
        query: vi.fn().mockResolvedValue({
          results: [makePage({ appId: 'recipe_existing', url: 'https://example.com/existing', version: 1 })],
          has_more: false,
          next_cursor: null,
        }),
      },
      pages: {
        create: createMock,
        update: updateMock,
      },
    });

    const req = makeReq({
      method: 'POST',
      headers: { 'x-family-code': 'family-code' },
      body: {
        payload: {
          schemaVersion: 5,
          recipes: [
            {
              id: 'recipe_existing',
              name: 'Existing',
              sourceUrl: 'https://example.com/existing',
              image: 'https://example.com/existing.jpg',
            },
          ],
        },
      },
      url: '/api/recipes/sync',
    });
    const res = makeRes();

    await recipeSyncHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0].properties.Photos.files[0].external.url).toBe('https://example.com/existing.jpg');
    expect(updateMock.mock.calls[0][0].properties.Version.number).toBe(2);
    expect(JSON.parse(res.body).data).toMatchObject({
      added: 0,
      updated: 1,
      duplicatesSkipped: 0,
    });
  });

  it('enforces the write rate limit with 429 on the 11th request', async () => {
    const createMock = vi.fn().mockResolvedValue(makePage({ appId: 'recipe_limit', pageId: 'page_limit', name: 'Soup' }));
    __setNotionClientForTests({
      dataSources: {
        query: vi.fn(),
      },
      pages: {
        create: createMock,
      },
    });

    for (let index = 0; index < 10; index += 1) {
      const req = makeReq({
        method: 'POST',
        headers: { 'x-family-code': 'family-code' },
        body: { name: `Soup ${index}` },
        socket: { remoteAddress: '10.0.0.1' },
        url: '/api/recipes',
      });
      const res = makeRes();
      await recipeHandler(req, res);
      expect(res.statusCode).toBe(201);
    }

    const req = makeReq({
      method: 'POST',
      headers: { 'x-family-code': 'family-code' },
      body: { name: 'Soup 11' },
      socket: { remoteAddress: '10.0.0.1' },
      url: '/api/recipes',
    });
    const res = makeRes();
    await recipeHandler(req, res);

    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body).error.code).toBe('RATE_LIMITED');
  });

  it('retries Notion 429 responses and eventually succeeds', async () => {
    __setNotionClientForTests({
      dataSources: {
        query: vi.fn()
          .mockRejectedValueOnce({ status: 429, headers: { 'retry-after': '0' }, message: 'slow down' })
          .mockResolvedValueOnce({
            results: [makePage()],
            has_more: false,
            next_cursor: null,
          }),
      },
      pages: {},
    });

    const req = makeReq({
      method: 'GET',
      headers: { 'x-family-code': 'family-code' },
      url: '/api/recipes',
    });
    const res = makeRes();

    await recipeHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data[0].id).toBe('recipe_1');
  });

  it('applies the same CORS allowlist to client error reports', async () => {
    const req = makeReq({
      method: 'POST',
      headers: { origin: 'https://evil.example.com' },
      body: { kind: 'error', message: 'boom' },
      url: '/api/log/client-error',
    });
    const res = makeRes();

    await clientErrorHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CORS_FORBIDDEN');
  });
});
