import {
  handleCorsPreflight,
  methodNotAllowed,
  readJsonBody,
  rejectDisallowedOrigin,
  sendError,
  sendJson,
} from '../../../src/server/http.js';
import { requireSession } from '../../../src/server/require-session.js';
import { getStore, putStore, StoresServiceError } from '../../../src/server/stores-service.js';

// GET  /api/v1/stores/:store  -> { data: { store, version, payload }, meta }
// PUT  /api/v1/stores/:store  -> body: { version, payload }; returns { data: { store, version } }
//
// Auth: requireSession(). Household scoping: session.payload.familyCode (if present)
// falls through to 'default' when only anonymous auth is in play.

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (rejectDisallowedOrigin(req, res)) return;
  const session = requireSession(req, res);
  if (!session) return;

  const store = String(req.query?.store || '').trim();
  if (!store) {
    sendError(req, res, 400, { code: 'BAD_STORE', message: 'Missing :store path param' });
    return;
  }

  const householdId = session?.payload?.familyCode || session?.payload?.userId || 'default';

  try {
    if (req.method === 'GET') {
      const data = await getStore({ householdId, store });
      sendJson(req, res, 200, {
        data,
        meta: { source: 'notion', fetchedAt: new Date().toISOString() },
      });
      return;
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const version = Number(body?.version);
      const payload = body?.payload;
      if (!Number.isFinite(version) || version < 0) {
        sendError(req, res, 400, { code: 'BAD_VERSION', message: 'version must be a non-negative integer' });
        return;
      }
      if (payload == null || typeof payload !== 'object') {
        sendError(req, res, 400, { code: 'BAD_PAYLOAD', message: 'payload must be an object' });
        return;
      }
      const result = await putStore({ householdId, store, version, payload });
      sendJson(req, res, 200, { data: result, meta: { source: 'notion' } });
      return;
    }

    methodNotAllowed(req, res, ['GET', 'PUT', 'OPTIONS']);
  } catch (error) {
    if (error instanceof StoresServiceError) {
      if (error.status === 409 && error.server) {
        sendError(req, res, 409, {
          code: error.code || 'VERSION_CONFLICT',
          message: error.message,
          details: { data: error.server },
        });
        return;
      }
      sendError(req, res, error.status || 500, {
        code: error.code || 'STORES_SERVICE_ERROR',
        message: error.message,
      });
      return;
    }
    console.error('stores handler failed:', error);
    sendError(req, res, 500, { code: 'INTERNAL_ERROR', message: 'Stores request failed' });
  }
}
