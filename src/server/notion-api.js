import { activeRecipesFilter, appIdFilter, notionPageToRecipe, recipeToNotionProperties } from './notion-mapper.js';
import { DEFAULT_JOURNAL_ID, JOURNAL_PREFIX } from './journal.js';
import { log } from './logger.js';

const API_BASE = 'https://api.notion.com/v1';

// Multi-tenant revival pattern. Today this resolves to the single env-configured
// data source; future multi-family deployments swap in a journalId -> DB map
// without changing every callsite. See NOTION_BACKEND_SPEC.md "Chosen Model".
const resolveDataSourceId = (journalId = DEFAULT_JOURNAL_ID) => {
  if (!String(journalId).startsWith(JOURNAL_PREFIX)) {
    throw new Error(`Multi-journal not enabled (got ${journalId})`);
  }
  const id = process.env.NOTION_DATA_SOURCE_ID;
  if (!id) throw new Error('Missing NOTION_DATA_SOURCE_ID');
  return id;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryAttempts = () => Number(process.env.RATE_LIMIT_RETRY_MAX || 3);
const retryBaseMs = () =>
  Number(process.env.RATE_LIMIT_BASE_DELAY_MS || process.env.RATE_LIMIT_RETRY_BASE_MS || 250);
const retryDelayMs = (attempt, retryAfterSeconds = 0) =>
  Math.max(Math.max(0, retryAfterSeconds) * 1000, retryBaseMs() * (2 ** attempt));

export const notionFetch = async (path, options = {}, attempt = 0) => {
  const token = process.env.NOTION_ACCESS_TOKEN;
  const version = process.env.NOTION_VERSION || '2022-06-28';
  if (!token) throw new Error('Missing NOTION_ACCESS_TOKEN');

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': version,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After') || 0);
    if (attempt < retryAttempts()) {
      const delayMs = retryDelayMs(attempt, retryAfter);
      log.warn('notion.rate_limited', {
        path,
        attempt: attempt + 1,
        delayMs,
        retryAfter,
      });
      await sleep(delayMs);
      return notionFetch(path, options, attempt + 1);
    }

    const error = await response.json().catch(() => null);
    const err = new Error(error?.message || 'Notion rate limit exceeded');
    err.status = 429;
    err.code = 'RATE_LIMITED';
    throw err;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const message = error?.message || `Notion request failed with ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.code = response.status === 429 ? 'RATE_LIMITED' : (error?.code || 'UPSTREAM_NOTION_ERROR');
    throw err;
  }

  if (response.status === 204) return null;
  return response.json();
};

export const queryAllRecipes = async () => {
  const dataSourceId = resolveDataSourceId();

  const recipes = [];
  let nextCursor;
  do {
    const payload = {
      filter: activeRecipesFilter,
      page_size: 100,
      start_cursor: nextCursor,
      sorts: [{ property: 'Name', direction: 'ascending' }],
    };
    const out = await notionFetch(`/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      body: payload,
    });
    recipes.push(...out.results.map(notionPageToRecipe));
    nextCursor = out.has_more ? out.next_cursor : null;
  } while (nextCursor);

  return recipes;
};

export const findRecipeByAppId = async (id) => {
  const dataSourceId = resolveDataSourceId();
  const out = await notionFetch(`/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    body: {
      filter: {
        and: [appIdFilter(id)],
      },
      page_size: 1,
    },
  });
  const page = out.results?.[0];
  return page ? notionPageToRecipe(page) : null;
};

export const createRecipePage = async (recipe) => {
  const dataSourceId = resolveDataSourceId();
  const out = await notionFetch('/pages', {
    method: 'POST',
    body: {
      parent: { data_source_id: dataSourceId },
      properties: recipeToNotionProperties(recipe),
    },
  });
  return notionPageToRecipe(out);
};

export const updateRecipePage = async (notionPageId, recipe) => {
  const out = await notionFetch(`/pages/${notionPageId}`, {
    method: 'PATCH',
    body: {
      properties: recipeToNotionProperties(recipe),
    },
  });
  return notionPageToRecipe(out);
};
