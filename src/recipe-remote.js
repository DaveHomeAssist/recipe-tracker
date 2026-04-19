import { clearRemoteRecipeCache, loadRemoteRecipeCache, saveRemoteRecipeCache } from './recipe-cache.js';

const REMOTE_WRITE_QUEUE_KEY = 'recipe_journal_remote_write_queue_v1';

const getStorage = () =>
  globalThis.localStorage &&
  typeof globalThis.localStorage.getItem === 'function' &&
  typeof globalThis.localStorage.setItem === 'function'
    ? globalThis.localStorage
    : null;

const cloneQueue = (queue = []) =>
  queue.map((entry) => ({
    ...entry,
    recipe: entry.recipe ? { ...entry.recipe } : null,
  }));

export const loadRemoteWriteQueue = () => {
  try {
    const storage = getStorage();
    if (!storage) return [];
    const raw = storage.getItem(REMOTE_WRITE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveRemoteWriteQueue = (queue = []) => {
  const storage = getStorage();
  if (!storage) return [];
  const cleanQueue = cloneQueue(queue);
  storage.setItem(REMOTE_WRITE_QUEUE_KEY, JSON.stringify(cleanQueue));
  return cleanQueue;
};

export const clearRemoteWriteQueue = () => {
  const storage = getStorage();
  if (!storage || typeof storage.removeItem !== 'function') return;
  storage.removeItem(REMOTE_WRITE_QUEUE_KEY);
};

const toLocalVersion = (recipe, previous) => {
  if (Number.isFinite(Number(recipe?.version)) && Number(recipe.version) > 0) return Number(recipe.version);
  if (previous && Number.isFinite(Number(previous.version))) return Number(previous.version) + 1;
  return 1;
};

export const isOfflineError = (error) => error?.code === 'NETWORK_ERROR';

export const enqueueRemoteUpsert = ({ recipe, previous = null }) => {
  const queue = loadRemoteWriteQueue();
  const baseVersion = previous && Number.isFinite(Number(previous.version))
    ? Number(previous.version)
    : null;
  const nextRecipe = {
    ...recipe,
    version: toLocalVersion(recipe, previous),
  };
  const existingIndex = queue.findIndex((entry) => entry.id === nextRecipe.id);
  const nextEntry = existingIndex >= 0
    ? {
        ...queue[existingIndex],
        op: 'upsert',
        recipe: nextRecipe,
      }
    : {
        id: nextRecipe.id,
        op: 'upsert',
        baseVersion,
        recipe: nextRecipe,
        queuedAt: new Date().toISOString(),
      };

  if (existingIndex >= 0) queue.splice(existingIndex, 1, nextEntry);
  else queue.push(nextEntry);
  return saveRemoteWriteQueue(queue);
};

export const enqueueRemoteDelete = ({ recipe }) => {
  const queue = loadRemoteWriteQueue();
  const existingIndex = queue.findIndex((entry) => entry.id === recipe.id);

  if (existingIndex >= 0) {
    const existingEntry = queue[existingIndex];
    if (existingEntry.op === 'upsert' && existingEntry.baseVersion == null) {
      queue.splice(existingIndex, 1);
      return saveRemoteWriteQueue(queue);
    }

    queue.splice(existingIndex, 1, {
      id: recipe.id,
      op: 'delete',
      baseVersion: existingEntry.baseVersion,
      queuedAt: new Date().toISOString(),
    });
    return saveRemoteWriteQueue(queue);
  }

  queue.push({
    id: recipe.id,
    op: 'delete',
    baseVersion: Number.isFinite(Number(recipe.version)) ? Number(recipe.version) : null,
    queuedAt: new Date().toISOString(),
  });
  return saveRemoteWriteQueue(queue);
};

export const bootstrapRemoteRecipes = async ({ api, fallback = { recipes: [], tagRegistry: {}, fetchedAt: '' } }) => {
  const cached = loadRemoteRecipeCache();

  try {
    const remoteRecipes = await api.getRecipes();
    saveRemoteRecipeCache(remoteRecipes, fallback.tagRegistry || cached.tagRegistry);
    return {
      recipes: remoteRecipes,
      tagRegistry: fallback.tagRegistry || cached.tagRegistry || {},
      fetchedAt: new Date().toISOString(),
      authenticated: true,
      offline: false,
      queuedWrites: loadRemoteWriteQueue().length,
    };
  } catch (error) {
    const fallbackRecipes = fallback.recipes?.length ? fallback.recipes : cached.recipes;
    const fallbackRegistry =
      (fallback.tagRegistry && Object.keys(fallback.tagRegistry).length ? fallback.tagRegistry : null) ||
      cached.tagRegistry ||
      {};

    if (error?.code === 'INVALID_FAMILY_CODE') {
      return {
        recipes: fallbackRecipes,
        tagRegistry: fallbackRegistry,
        fetchedAt: cached.fetchedAt || fallback.fetchedAt || '',
        authenticated: false,
        offline: false,
        error,
      };
    }

    if (isOfflineError(error)) {
      return {
        recipes: fallbackRecipes,
        tagRegistry: fallbackRegistry,
        fetchedAt: cached.fetchedAt || fallback.fetchedAt || '',
        authenticated: true,
        offline: true,
        error,
      };
    }

    throw error;
  }
};

export const saveRemoteRecipe = async ({ api, recipe, previous = null }) => {
  try {
    const saved = previous
      ? await api.updateRecipe(recipe.id, { ...recipe, version: previous.version })
      : await api.createRecipe(recipe);
    return { recipe: saved, offline: false, queued: false };
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    enqueueRemoteUpsert({ recipe, previous });
    return {
      recipe: {
        ...recipe,
        version: toLocalVersion(recipe, previous),
      },
      offline: true,
      queued: true,
    };
  }
};

export const deleteRemoteRecipe = async ({ api, recipe }) => {
  try {
    await api.deleteRecipe(recipe.id, recipe.version);
    return { offline: false, queued: false };
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    enqueueRemoteDelete({ recipe });
    return { offline: true, queued: true };
  }
};

export const replayQueuedRemoteWrites = async ({ api }) => {
  const queue = loadRemoteWriteQueue();
  if (!queue.length) return { applied: 0, recipes: null };

  for (let index = 0; index < queue.length; index += 1) {
    const entry = queue[index];
    if (entry.op === 'upsert') {
      if (entry.baseVersion == null) {
        await api.createRecipe(entry.recipe);
      } else {
        await api.updateRecipe(entry.id, {
          ...entry.recipe,
          version: entry.baseVersion,
        });
      }
    } else if (entry.op === 'delete' && entry.baseVersion != null) {
      await api.deleteRecipe(entry.id, entry.baseVersion);
    }
  }

  clearRemoteWriteQueue();
  const recipes = await api.getRecipes();
  clearRemoteRecipeCache();
  saveRemoteRecipeCache(recipes);
  return {
    applied: queue.length,
    recipes,
  };
};

export const syncLocalCorpusToRemote = async ({ api, payload, tagRegistry = {} }) => {
  const summary = await api.syncRecipes(payload);
  const recipes = await api.getRecipes();
  saveRemoteRecipeCache(recipes, tagRegistry);
  return {
    summary,
    recipes,
  };
};
