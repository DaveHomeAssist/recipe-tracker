import { handleCorsPreflight, methodNotAllowed, readJsonBody, rejectDisallowedOrigin, sendError, sendJson } from '../../src/server/http.js';
import { requireSession } from '../../src/server/require-session.js';
import { importRecipesToNotion } from '../../src/server/recipes-service.js';

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (rejectDisallowedOrigin(req, res)) return;
  if (!requireSession(req, res)) return;

  if (req.method !== 'POST') {
    methodNotAllowed(req, res, ['POST', 'OPTIONS']);
    return;
  }

  try {
    const body = await readJsonBody(req);
    const summary = await importRecipesToNotion({
      mode: body.mode,
      payload: body.payload,
      replaceConfirmed: body.replaceConfirmed,
    });
    sendJson(req, res, 200, { data: summary });
  } catch (error) {
    console.error('import handler failed:', error);
    sendError(
      req,
      res,
      error.status || 500,
      error.code || 'INTERNAL_ERROR',
      error.message || 'Unexpected server error'
    );
  }
}
