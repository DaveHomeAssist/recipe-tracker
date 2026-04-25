import { handleCorsPreflight, rejectDisallowedOrigin, sendError, sendJson } from '../../src/server/http.js';
import { requireSession } from '../../src/server/require-session.js';
import { getNotionConfigStatus } from '../../src/server/notion-api.js';

export default function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (rejectDisallowedOrigin(req, res)) return;
  if (!requireSession(req, res)) return;

  if (req.method !== 'GET') {
    sendError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Expected one of: GET, OPTIONS');
    return;
  }

  sendJson(req, res, 200, {
    ok: true,
    notion: getNotionConfigStatus(),
  });
}
