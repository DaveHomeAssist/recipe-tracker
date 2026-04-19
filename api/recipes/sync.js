import { handleCorsPreflight, methodNotAllowed, readJsonBody, rejectDisallowedOrigin, sendError, sendJson } from '../../src/server/http.js';
import { requireFamilyCode } from '../../src/server/require-family-code.js';
import { enforceWriteRateLimit } from '../../src/server/write-rate-limit.js';
import { syncRecipesToNotion } from '../../src/server/recipes-service.js';

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (rejectDisallowedOrigin(req, res)) return;
  if (!requireFamilyCode(req, res)) return;

  if (req.method !== 'POST') {
    methodNotAllowed(req, res, ['POST', 'OPTIONS']);
    return;
  }

  if (!enforceWriteRateLimit(req, res)) return;

  try {
    const body = await readJsonBody(req);
    const summary = await syncRecipesToNotion(body?.payload || body);
    sendJson(req, res, 200, {
      data: summary,
    });
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
