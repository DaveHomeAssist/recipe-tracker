import { handleCorsPreflight, methodNotAllowed, rejectDisallowedOrigin, sendError, sendJson } from '../../src/server/http.js';
import { listRecipes } from '../../src/server/recipes-service.js';

function publicSourceUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function publicRecipe(recipe, index) {
  return {
    id: 'public-' + index,
    name: recipe.name,
    cuisine: recipe.cuisine,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions,
    preptime: recipe.preptime,
    cooktime: recipe.cooktime,
    servings: recipe.servings,
    url: publicSourceUrl(recipe.url),
  };
}

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (handleCorsPreflight(req, res)) return;
  if (rejectDisallowedOrigin(req, res)) return;
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, ['GET', 'OPTIONS']);
    return;
  }

  try {
    const recipes = await listRecipes();
    sendJson(req, res, 200, { data: recipes.map(publicRecipe) });
  } catch {
    sendError(req, res, 503, 'LIBRARY_UNAVAILABLE', 'The recipe library is temporarily unavailable.');
  }
}
