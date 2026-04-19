import { Client } from '@notionhq/client';
import { activeRecipesFilter, appIdFilter, notionPageToRecipe, recipeToNotionProperties } from './notion-mapper.js';
import { DEFAULT_JOURNAL_ID, JOURNAL_PREFIX } from './journal.js';
import { log } from './logger.js';

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

let notionClientOverride = null;

export const __setNotionClientForTests = (client) => {
  notionClientOverride = client;
};

const getNotionClient = () => {
  const token = process.env.NOTION_ACCESS_TOKEN;
  if (!token) throw new Error('Missing NOTION_ACCESS_TOKEN');
  if (notionClientOverride) return notionClientOverride;
  return new Client({
    auth: token,
    notionVersion: process.env.NOTION_VERSION || '2026-03-11',
  });
};

const normalizeNotionError = (error) => {
  if (!error) return error;
  const retryAfterHeader =
    error.headers?.['retry-after'] ||
    error.headers?.['Retry-After'] ||
    error.response?.headers?.get?.('retry-after') ||
    error.response?.headers?.get?.('Retry-After') ||
    0;
  const normalized = error instanceof Error ? error : new Error(String(error.message || error));
  normalized.status = Number(error.status || normalized.status || 500);
  normalized.code = error.code || normalized.code || 'UPSTREAM_NOTION_ERROR';
  normalized.retryAfterSeconds = Number(retryAfterHeader || 0);
  return normalized;
};

const withNotionRateLimitRetry = async (operation, context, attempt = 0) => {
  try {
    return await operation();
  } catch (rawError) {
    const error = normalizeNotionError(rawError);
    if (Number(error.status) === 429) {
      const retryAfter = Number(error.retryAfterSeconds || 0);
      if (attempt < retryAttempts()) {
        const delayMs = retryDelayMs(attempt, retryAfter);
        log.warn('notion.rate_limited', {
          ...context,
          attempt: attempt + 1,
          delayMs,
          retryAfter,
        });
        await sleep(delayMs);
        return withNotionRateLimitRetry(operation, context, attempt + 1);
      }
      error.code = 'RATE_LIMITED';
    }
    throw error;
  }
};

export const queryAllRecipes = async () => {
  const notion = getNotionClient();
  const dataSourceId = resolveDataSourceId();

  const recipes = [];
  let nextCursor;
  do {
    const response = await withNotionRateLimitRetry(
      () =>
        notion.dataSources.query({
          data_source_id: dataSourceId,
          ...(activeRecipesFilter ? { filter: activeRecipesFilter } : {}),
          page_size: 100,
          ...(nextCursor ? { start_cursor: nextCursor } : {}),
          sorts: [{ property: 'Recipe Name', direction: 'ascending' }],
        }),
      { action: 'queryAllRecipes', dataSourceId }
    );
    recipes.push(...response.results.map(notionPageToRecipe));
    nextCursor = response.has_more ? response.next_cursor : null;
  } while (nextCursor);

  return recipes;
};

export const findRecipePageByAppId = async (id) => {
  const notion = getNotionClient();
  const dataSourceId = resolveDataSourceId();
  const response = await withNotionRateLimitRetry(
    () =>
      notion.dataSources.query({
        data_source_id: dataSourceId,
        filter: appIdFilter(id),
        page_size: 1,
      }),
    { action: 'findRecipePageByAppId', dataSourceId, id }
  );
  return response.results?.[0] || null;
};

export const findRecipeByAppId = async (id) => {
  const page = await findRecipePageByAppId(id);
  return page ? notionPageToRecipe(page) : null;
};

export const createRecipePage = async (recipe) => {
  const notion = getNotionClient();
  const dataSourceId = resolveDataSourceId();
  const page = await withNotionRateLimitRetry(
    () =>
      notion.pages.create({
        parent: { data_source_id: dataSourceId },
        properties: recipeToNotionProperties(recipe),
      }),
    { action: 'createRecipePage', dataSourceId, recipeId: recipe.id }
  );
  return notionPageToRecipe(page);
};

export const updateRecipePage = async (notionPageId, recipe) => {
  const notion = getNotionClient();
  const page = await withNotionRateLimitRetry(
    () =>
      notion.pages.update({
        page_id: notionPageId,
        properties: recipeToNotionProperties(recipe),
        in_trash: false,
      }),
    { action: 'updateRecipePage', notionPageId, recipeId: recipe.id }
  );
  return notionPageToRecipe(page);
};

export const archiveRecipePage = async (notionPageId) => {
  const notion = getNotionClient();
  await withNotionRateLimitRetry(
    () =>
      notion.pages.update({
        page_id: notionPageId,
        in_trash: true,
      }),
    { action: 'archiveRecipePage', notionPageId }
  );
};
