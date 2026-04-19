import { handleCorsPreflight, methodNotAllowed, readJsonBody, rejectDisallowedOrigin, sendError, sendJson, sendNoContent } from '../../src/server/http.js';
import { requireFamilyCode } from '../../src/server/require-family-code.js';
import { enforceWriteRateLimit } from '../../src/server/write-rate-limit.js';
import { deleteRecipe, getRecipe, updateRecipe } from '../../src/server/recipes-service.js';

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (rejectDisallowedOrigin(req, res)) return;
  if (!requireFamilyCode(req, res)) return;

  try {
    const id = req.query?.id;
    if (!id) {
      sendError(req, res, 400, 'VALIDATION_FAILED', 'Recipe id is required');
      return;
    }

    if (req.method === 'GET') {
      const recipe = await getRecipe(id);
      sendJson(req, res, 200, {
        data: {
          recipe,
        },
      });
      return;
    }

    if (req.method === 'PATCH') {
      if (!enforceWriteRateLimit(req, res)) return;
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
      if (!enforceWriteRateLimit(req, res)) return;
      const body = await readJsonBody(req);
      await deleteRecipe(id, body.version);
      sendNoContent(req, res, 204);
      return;
    }

    methodNotAllowed(req, res, ['GET', 'PATCH', 'DELETE', 'OPTIONS']);
  } catch (error) {
    sendError(
      req,
      res,
      error.status || 500,
      error.code || 'INTERNAL_ERROR',
      error.message || 'Unexpected server error'
    );
  }
}
