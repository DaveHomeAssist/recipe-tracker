import { activeRecipesFilter, appIdFilter, notionPageToRecipe, recipeToNotionProperties } from './notion-mapper.js';

const API_BASE = 'https://api.notion.com/v1';

// Multi-tenant revival pattern. Today this resolves to the single env-configured
// data source; future multi-family deployments can swap in a journalId -> DB map
// without changing every callsite. See NOTION_BACKEND_SPEC.md "Chosen Model".
export const JOURNAL_PREFIX = 'journal_family';
const resolveDataSourceId = (journalId = JOURNAL_PREFIX) => {
  if (journalId !== JOURNAL_PREFIX) throw new Error(`Multi-journal not enabled (got ${journalId})`);
  const id = process.env.NOTION_DATA_SOURCE_ID;
  if (!id) throw new Error('Missing NOTION_DATA_SOURCE_ID');
  return id;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const notionFetch = async (path, options = {}, attempt = 0) => {
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

  if (response.status === 429 && attempt < Number(process.env.RATE_LIMIT_RETRY_MAX || 3)) {
    const retryAfter = Number(response.headers.get('Retry-After') || 1);
    await sleep(retryAfter * 1000);
    return notionFetch(path, options, attempt + 1);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const message = error?.message || `Notion request failed with ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.code = error?.code || 'UPSTREAM_NOTION_ERROR';
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
