const REMOTE_CACHE_KEY = 'recipe_journal_remote_cache_v1';
const getStorage = () =>
  globalThis.localStorage &&
  typeof globalThis.localStorage.getItem === 'function' &&
  typeof globalThis.localStorage.setItem === 'function'
    ? globalThis.localStorage
    : null;

export const loadRemoteRecipeCache = () => {
  try {
    const storage = getStorage();
    if (!storage) return { recipes: [], tagRegistry: {}, fetchedAt: '' };
    const raw = storage.getItem(REMOTE_CACHE_KEY);
    if (!raw) return { recipes: [], tagRegistry: {}, fetchedAt: '' };
    const parsed = JSON.parse(raw);
    return {
      recipes: Array.isArray(parsed?.recipes) ? parsed.recipes : [],
      tagRegistry: parsed?.tagRegistry && typeof parsed.tagRegistry === 'object' ? parsed.tagRegistry : {},
      fetchedAt: typeof parsed?.fetchedAt === 'string' ? parsed.fetchedAt : '',
    };
  } catch {
    return { recipes: [], tagRegistry: {}, fetchedAt: '' };
  }
};

export const saveRemoteRecipeCache = (recipes, tagRegistry = {}, fetchedAt = new Date().toISOString()) => {
  const normalizedTagRegistry =
    typeof tagRegistry === 'string' ? {} : (tagRegistry && typeof tagRegistry === 'object' ? tagRegistry : {});
  const normalizedFetchedAt =
    typeof tagRegistry === 'string' ? tagRegistry : fetchedAt;
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(REMOTE_CACHE_KEY, JSON.stringify({
    recipes,
    tagRegistry: normalizedTagRegistry,
    fetchedAt: normalizedFetchedAt,
  }));
};

export const clearRemoteRecipeCache = () => {
  const storage = getStorage();
  if (!storage || typeof storage.removeItem !== 'function') return;
  storage.removeItem(REMOTE_CACHE_KEY);
};
