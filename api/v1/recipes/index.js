import { handleCorsPreflight, methodNotAllowed, readJsonBody, rejectDisallowedOrigin, sendError, sendJson } from '../../../src/server/http.js';
import { requireSession } from '../../../src/server/require-session.js';
import { createRecipe, listRecipes } from '../../../src/server/recipes-service.js';

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (rejectDisallowedOrigin(req, res)) return;
  if (!requireSession(req, res)) return;

  try {
    if (req.method === 'GET') {
      const recipes = await listRecipes();
      sendJson(req, res, 200, {
        data: recipes,
        meta: {
          source: 'notion',
          fetchedAt: new Date().toISOString(),
        },
      });
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const recipe = await createRecipe(body);
      sendJson(req, res, 201, {
        data: {
          id: recipe.id,
          version: recipe.version,
          recipe,
        },
      });
      return;
    }

    methodNotAllowed(req, res, ['GET', 'POST', 'OPTIONS']);
  } catch (error) {
    console.error('recipes index handler failed:', error);
    sendError(
      req,
      res,
      error.status || 500,
      error.code || 'INTERNAL_ERROR',
      error.message || 'Unexpected server error'
    );
  }
}
