import { handleCorsPreflight, methodNotAllowed, sendJson } from '../../src/server/http.js';

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, ['GET', 'OPTIONS']);
    return;
  }

  sendJson(req, res, 200, { ok: true, notion: process.env.NOTION_ACCESS_TOKEN ? 'configured' : 'unconfigured' });
}
