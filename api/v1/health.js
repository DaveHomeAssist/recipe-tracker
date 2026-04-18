import { handleCorsPreflight, methodNotAllowed, rejectDisallowedOrigin, sendJson } from '../../src/server/http.js';
import { JOURNAL_PREFIX } from '../../src/server/journal.js';

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (rejectDisallowedOrigin(req, res)) return;
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, ['GET', 'OPTIONS']);
    return;
  }

  sendJson(req, res, 200, {
    ok: true,
    notion: process.env.NOTION_ACCESS_TOKEN ? 'configured' : 'unconfigured',
    journalPrefix: JOURNAL_PREFIX,
  });
}
