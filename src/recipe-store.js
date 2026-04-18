import { loadRemoteRecipeCache, saveRemoteRecipeCache } from './recipe-cache.js';
import { clearStoredSession } from './session-storage.js';

export const bootstrapRemoteRecipes = async ({ api }) => {
  const cached = loadRemoteRecipeCache();
  const session = await api.getSession();
  if (!session?.authenticated) {
    clearStoredSession();
    return {
      recipes: cached.recipes,
      tagRegistry: cached.tagRegistry,
      fetchedAt: cached.fetchedAt,
      authenticated: false,
      offline: false,
    };
  }

  try {
    const remoteRecipes = await api.getRecipes();
    saveRemoteRecipeCache(remoteRecipes);
    return {
      recipes: remoteRecipes,
      tagRegistry: cached.tagRegistry,
      fetchedAt: new Date().toISOString(),
      authenticated: true,
      offline: false,
    };
  } catch (error) {
    if (cached.recipes.length) {
      return {
        recipes: cached.recipes,
        tagRegistry: cached.tagRegistry,
        fetchedAt: cached.fetchedAt,
        authenticated: true,
        offline: true,
        error,
      };
    }
    throw error;
  }
};

export const saveRemoteRecipe = async ({ api, recipe, previous }) => {
  const saved = previous
    ? await api.updateRecipe(recipe.id, { ...recipe, version: previous.version })
    : await api.createRecipe(recipe);
  return saved;
};

export const deleteRemoteRecipe = async ({ api, recipe }) => {
  await api.deleteRecipe(recipe.id, recipe.version);
};

export const importRemoteRecipes = async ({ api, mode, payload, replaceConfirmed = false }) =>
  api.importRecipes(mode, payload, replaceConfirmed);
