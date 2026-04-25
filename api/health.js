import { handleCorsPreflight, methodNotAllowed, rejectDisallowedOrigin, sendJson } from '../src/server/http.js';
import { requireSession } from '../src/server/require-session.js';

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (rejectDisallowedOrigin(req, res)) return;

  if (req.method !== 'GET') {
    methodNotAllowed(req, res, ['GET', 'OPTIONS']);
    return;
  }

  if (!requireSession(req, res)) return;

  sendJson(req, res, 200, {
    ok: true,
    authenticated: true,
    notion: process.env.NOTION_ACCESS_TOKEN ? 'configured' : 'unconfigured',
    dataSourceId: process.env.NOTION_DATA_SOURCE_ID ? 'configured' : 'unconfigured',
  });
}
