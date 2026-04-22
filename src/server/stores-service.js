// Notion-backed blob storage for the three non-recipe stores.
// Pattern: one Notion page per (householdId, storeKey). Page title is the
// lookup key; page body holds the JSON blob as a single code block; a
// 'Version' number property guards against concurrent writes.
//
// Env vars required:
//   NOTION_ACCESS_TOKEN           (shared with recipes)
//   NOTION_STORES_DATA_SOURCE_ID  (separate DB so recipes and stores don't collide)
//
// DB schema (Notion):
//   Title:   "Key"      (title)          Format: "<householdId>:<store>"
//   Number:  "Version"                     Starts at 0, increments on each put.
//   Rich text: (body)                      Single code block with JSON blob.
//
// If NOTION_STORES_DATA_SOURCE_ID is unset, every call throws
// StoresServiceError(code=NOT_CONFIGURED, status=503). Clients treat 503
// the same as offline and keep writes in their local queue.

import { Client } from '@notionhq/client';

export class StoresServiceError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR' } = {}) {
    super(message);
    this.name = 'StoresServiceError';
    this.status = status;
    this.code = code;
  }
}

const VALID_STORES = new Set(['meal_plan', 'shopping_list', 'pantry']);

let clientOverride = null;
export const __setNotionClientForStoresTests = (c) => { clientOverride = c; };

const getClient = () => {
  if (clientOverride) return clientOverride;
  const token = process.env.NOTION_ACCESS_TOKEN;
  if (!token) throw new StoresServiceError('Missing NOTION_ACCESS_TOKEN', { status: 503, code: 'NOT_CONFIGURED' });
  return new Client({ auth: token, notionVersion: process.env.NOTION_VERSION || '2026-03-11' });
};

const getDataSourceId = () => {
  const id = process.env.NOTION_STORES_DATA_SOURCE_ID;
  if (!id) throw new StoresServiceError('Stores backend not configured', { status: 503, code: 'NOT_CONFIGURED' });
  return id;
};

const keyFor = (householdId, store) => `${householdId || 'default'}:${store}`;

const assertStore = (store) => {
  if (!VALID_STORES.has(store)) throw new StoresServiceError(`Unknown store ${store}`, { status: 400, code: 'BAD_STORE' });
};

// Find the Notion page for this (household, store). Returns null if none.
const findPage = async (client, dsId, key) => {
  const result = await client.dataSources.query({
    data_source_id: dsId,
    filter: { property: 'Key', title: { equals: key } },
    page_size: 1,
  });
  return result?.results?.[0] || null;
};

// Read blob JSON from a page's first code block. Returns {} if absent.
const readBlob = async (client, pageId) => {
  const blocks = await client.blocks.children.list({ block_id: pageId, page_size: 50 });
  const code = (blocks?.results || []).find((b) => b.type === 'code');
  if (!code) return null;
  const text = (code.code?.rich_text || []).map((r) => r.plain_text || '').join('');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
};

// Replace all page children with a single code block holding the JSON.
const writeBlob = async (client, pageId, obj) => {
  const blocks = await client.blocks.children.list({ block_id: pageId, page_size: 100 });
  for (const b of blocks?.results || []) {
    try { await client.blocks.delete({ block_id: b.id }); } catch { /* ignore; block may be immutable */ }
  }
  const text = JSON.stringify(obj);
  // Notion rich_text caps at 2000 chars per segment; chunk defensively.
  const chunks = [];
  for (let i = 0; i < text.length; i += 1900) chunks.push({ type: 'text', text: { content: text.slice(i, i + 1900) } });
  await client.blocks.children.append({
    block_id: pageId,
    children: [{
      object: 'block',
      type: 'code',
      code: { language: 'json', rich_text: chunks.length ? chunks : [{ type: 'text', text: { content: '{}' } }] },
    }],
  });
};

const versionOf = (page) => {
  const raw = page?.properties?.Version?.number;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

// -------- Public API --------

export async function getStore({ householdId, store }) {
  assertStore(store);
  const client = getClient();
  const dsId = getDataSourceId();
  const key = keyFor(householdId, store);
  const page = await findPage(client, dsId, key);
  if (!page) return { store, version: 0, payload: null };
  const payload = (await readBlob(client, page.id)) || null;
  return { store, version: versionOf(page), payload };
}

export async function putStore({ householdId, store, version, payload }) {
  assertStore(store);
  const expectedVersion = Number.isFinite(Number(version)) ? Number(version) : 0;
  const client = getClient();
  const dsId = getDataSourceId();
  const key = keyFor(householdId, store);
  const existing = await findPage(client, dsId, key);

  if (existing) {
    const serverVersion = versionOf(existing);
    if (serverVersion !== expectedVersion) {
      // Conflict. Return server's current state.
      const serverPayload = (await readBlob(client, existing.id)) || null;
      const err = new StoresServiceError('Version conflict', { status: 409, code: 'VERSION_CONFLICT' });
      err.server = { store, version: serverVersion, payload: serverPayload };
      throw err;
    }
    const nextVersion = serverVersion + 1;
    await client.pages.update({
      page_id: existing.id,
      properties: {
        Version: { number: nextVersion },
      },
    });
    await writeBlob(client, existing.id, payload);
    return { store, version: nextVersion };
  }

  // Create new page. Expected version must be 0 on first write.
  if (expectedVersion !== 0) {
    const err = new StoresServiceError('Version conflict (no page yet but client sent non-zero version)', { status: 409, code: 'VERSION_CONFLICT' });
    err.server = { store, version: 0, payload: null };
    throw err;
  }
  const created = await client.pages.create({
    parent: { data_source_id: dsId },
    properties: {
      Key: { title: [{ type: 'text', text: { content: key } }] },
      Version: { number: 1 },
    },
  });
  await writeBlob(client, created.id, payload);
  return { store, version: 1 };
}
