import { dedupeByUrl, normalizeTags } from '../recipe-lib.js';
import { validateImport, validateRecipe } from '../recipe-schema.js';
import { createRecipePage, findRecipeByAppId, queryAllRecipes, updateRecipePage } from './notion-api.js';

const sameKey = (value) => String(value || '').trim().toLowerCase();
const makeRecipeId = () =>
  globalThis.crypto?.randomUUID?.() || `recipe-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const normalizeRemoteRecipe = (recipe, overrides = {}) => ({
  ...recipe,
  ...overrides,
  tags: normalizeTags(recipe.tags),
});

export const listRecipes = () => queryAllRecipes();

export const createRecipe = async (payload) => {
  const validated = validateRecipe(payload);
  if (!validated) {
    const error = new Error('Recipe payload is invalid');
    error.code = 'VALIDATION_FAILED';
    error.status = 400;
    throw error;
  }

  const recipe = normalizeRemoteRecipe(validated, {
    id: validated.id || makeRecipeId(),
    deleted: false,
    version: 1,
  });
  return createRecipePage(recipe);
};

export const updateRecipe = async (id, patch) => {
  const existing = await findRecipeByAppId(id);
  if (!existing || existing.deleted) {
    const error = new Error('Recipe not found');
    error.code = 'NOT_FOUND';
    error.status = 404;
    throw error;
  }

  if (Number(patch.version) !== Number(existing.version)) {
    const error = new Error('This recipe was changed on another device.');
    error.code = 'VERSION_CONFLICT';
    error.status = 409;
    throw error;
  }

  const merged = normalizeRemoteRecipe(
    validateRecipe({
      ...existing,
      ...patch,
      id: existing.id,
      version: existing.version + 1,
      deleted: false,
    })
  );

  if (!merged) {
    const error = new Error('Recipe payload is invalid');
    error.code = 'VALIDATION_FAILED';
    error.status = 400;
    throw error;
  }

  return updateRecipePage(existing.notionPageId, merged);
};

export const deleteRecipe = async (id, version) => {
  const existing = await findRecipeByAppId(id);
  if (!existing || existing.deleted) {
    const error = new Error('Recipe not found');
    error.code = 'NOT_FOUND';
    error.status = 404;
    throw error;
  }

  if (Number(version) !== Number(existing.version)) {
    const error = new Error('This recipe was changed on another device.');
    error.code = 'VERSION_CONFLICT';
    error.status = 409;
    throw error;
  }

  return updateRecipePage(existing.notionPageId, {
    ...existing,
    deleted: true,
    version: existing.version + 1,
  });
};

export const importRecipesToNotion = async ({ mode, payload, replaceConfirmed = false }) => {
  const validated = validateImport(payload);
  if (!validated.ok) {
    const error = new Error(validated.error);
    error.code = 'IMPORT_INVALID';
    error.status = 400;
    throw error;
  }

  const incoming = dedupeByUrl(
    validated.recipes.map((recipe) =>
      normalizeRemoteRecipe(recipe, {
        id: recipe.id || makeRecipeId(),
        deleted: false,
        version: 1,
      })
    )
  );

  const existing = await queryAllRecipes();

  if (mode === 'replace') {
    if (!replaceConfirmed) {
      const error = new Error('Replace imports require explicit confirmation');
      error.code = 'VALIDATION_FAILED';
      error.status = 400;
      throw error;
    }

    for (const recipe of existing) {
      await updateRecipePage(recipe.notionPageId, {
        ...recipe,
        deleted: true,
        version: recipe.version + 1,
      });
    }

    for (const recipe of incoming) {
      await createRecipePage(recipe);
    }

    return {
      added: incoming.length,
      updated: 0,
      duplicatesSkipped: 0,
      dropped: validated.dropped,
    };
  }

  const byUrl = new Map();
  const byFallback = new Set();

  for (const recipe of existing) {
    const urlKey = sameKey(recipe.url);
    const fallbackKey = `${sameKey(recipe.name)}|${sameKey(recipe.source)}`;
    if (urlKey) byUrl.set(urlKey, recipe);
    byFallback.add(fallbackKey);
  }

  let added = 0;
  let duplicatesSkipped = 0;
  for (const recipe of incoming) {
    const urlKey = sameKey(recipe.url);
    const fallbackKey = `${sameKey(recipe.name)}|${sameKey(recipe.source)}`;
    if ((urlKey && byUrl.has(urlKey)) || (!urlKey && byFallback.has(fallbackKey))) {
      duplicatesSkipped++;
      continue;
    }
    await createRecipePage(recipe);
    added++;
  }

  return {
    added,
    updated: 0,
    duplicatesSkipped,
    dropped: validated.dropped,
  };
};
