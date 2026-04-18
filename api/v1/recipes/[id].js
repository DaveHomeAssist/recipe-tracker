import { handleCorsPreflight, methodNotAllowed, readJsonBody, sendError, sendJson, sendNoContent } from '../../../src/server/http.js';
import { requireSession } from '../../../src/server/require-session.js';
import { deleteRecipe, updateRecipe } from '../../../src/server/recipes-service.js';

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (!requireSession(req, res)) return;

  try {
    const id = req.query?.id;
    if (!id) {
      sendError(req, res, 400, 'VALIDATION_FAILED', 'Recipe id is required');
      return;
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const recipe = await updateRecipe(id, body);
      sendJson(req, res, 200, {
        data: {
          id: recipe.id,
          version: recipe.version,
          recipe,
        },
      });
      return;
    }

    if (req.method === 'DELETE') {
      const body = await readJsonBody(req);
      await deleteRecipe(id, body.version);
      sendNoContent(req, res, 204);
      return;
    }

    methodNotAllowed(req, res, ['PATCH', 'DELETE', 'OPTIONS']);
  } catch (error) {
    console.error('recipe item handler failed:', error);
    sendError(
      req,
      res,
      error.status || 500,
      error.code || 'INTERNAL_ERROR',
      error.message || 'Unexpected server error'
    );
  }
}
