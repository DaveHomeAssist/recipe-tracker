import { dedupeByUrl, normalizeTags } from '../recipe-lib.js';
import { validateImport, validateRecipe } from '../recipe-schema.js';
import { archiveRecipePage, createRecipePage, findRecipeByAppId, findRecipePageByAppId, queryAllRecipes, updateRecipePage } from './notion-api.js';
import { notionPageToRecipe } from './notion-mapper.js';

const sameKey = (value) => String(value || '').trim().toLowerCase();
const makeRecipeId = () =>
  globalThis.crypto?.randomUUID?.() || `recipe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const SYNC_BACKFILL_FIELDS = [
  'name',
  'cuisine',
  'source',
  'location',
  'preptime',
  'cooktime',
  'servings',
  'tags',
  'url',
  'image',
  'date',
  'notes',
  'ingredients',
  'instructions',
];

const normalizeRemoteRecipe = (recipe, overrides = {}) => ({
  ...recipe,
  ...overrides,
  tags: normalizeTags(recipe.tags),
});

const mergeRecipeBackfill = (existing, incoming) => {
  const merged = { ...existing };
  let changed = false;

  for (const field of SYNC_BACKFILL_FIELDS) {
    const current = String(existing?.[field] || '').trim();
    const next = String(incoming?.[field] || '').trim();
    if (!current && next) {
      merged[field] = incoming[field];
      changed = true;
    }
  }

  const currentRating = Number(existing?.rating || 0);
  const nextRating = Number(incoming?.rating || 0);
  if (currentRating === 0 && nextRating > 0) {
    merged.rating = nextRating;
    changed = true;
  }

  if (!changed) return null;

  return normalizeRemoteRecipe({
    ...merged,
    id: existing.id || incoming.id || makeRecipeId(),
    version: Number(existing.version || 0) + 1,
  });
};

export const listRecipes = () => queryAllRecipes();

export const getRecipe = async (id) => {
  const recipe = await findRecipeByAppId(id);
  if (!recipe) {
    const error = new Error('Recipe not found');
    error.code = 'NOT_FOUND';
    error.status = 404;
    throw error;
  }
  return recipe;
};

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
    version: 1,
  });
  return createRecipePage(recipe);
};

export const updateRecipe = async (id, patch) => {
  const existing = await findRecipeByAppId(id);
  if (!existing) {
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

  const validated = validateRecipe({
    ...existing,
    ...patch,
    id: existing.id,
    version: existing.version + 1,
  });

  if (!validated) {
    const error = new Error('Recipe payload is invalid');
    error.code = 'VALIDATION_FAILED';
    error.status = 400;
    throw error;
  }

  const merged = normalizeRemoteRecipe(validated);
  return updateRecipePage(existing.notionPageId, merged);
};

export const deleteRecipe = async (id, version) => {
  const existingPage = await findRecipePageByAppId(id);
  if (!existingPage) {
    const error = new Error('Recipe not found');
    error.code = 'NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const existing = notionPageToRecipe(existingPage);
  if (Number(version) !== Number(existing.version)) {
    const error = new Error('This recipe was changed on another device.');
    error.code = 'VERSION_CONFLICT';
    error.status = 409;
    throw error;
  }

  await archiveRecipePage(existing.notionPageId);
  return {
    id: existing.id,
    archived: true,
  };
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
      await archiveRecipePage(recipe.notionPageId);
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

export const syncRecipesToNotion = async (payload) => {
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
        version: Number(recipe.version || 1),
      })
    )
  );

  const existing = await queryAllRecipes();
  const existingByUrl = new Map(
    existing
      .filter((recipe) => sameKey(recipe.url))
      .map((recipe) => [sameKey(recipe.url), recipe])
  );

  let added = 0;
  let updated = 0;
  let duplicatesSkipped = 0;

  for (const recipe of incoming) {
    const urlKey = sameKey(recipe.url);
    if (urlKey && existingByUrl.has(urlKey)) {
      const existingRecipe = existingByUrl.get(urlKey);
      const merged = mergeRecipeBackfill(existingRecipe, recipe);
      if (merged) {
        const saved = await updateRecipePage(existingRecipe.notionPageId, merged);
        existingByUrl.set(urlKey, saved);
        updated++;
      } else {
        duplicatesSkipped++;
      }
      continue;
    }

    const created = await createRecipePage({
      ...recipe,
      version: 1,
    });

    if (urlKey) existingByUrl.set(urlKey, created);
    added++;
  }

  return {
    added,
    updated,
    duplicatesSkipped,
    dropped: validated.dropped,
    total: incoming.length,
  };
};
