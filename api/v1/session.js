import { timingSafeEqual } from 'node:crypto';
import { handleCorsPreflight, methodNotAllowed, readJsonBody, rejectDisallowedOrigin, sendError, sendJson, sendNoContent } from '../../src/server/http.js';
import {
  createSessionToken,
  getSessionFromRequest,
  sessionPayloadToResponse,
} from '../../src/server/session.js';

// Constant-time comparison to prevent character-by-character brute force
// via response-timing side channel. Inputs are padded to equal length so
// timingSafeEqual doesn't throw on mismatched lengths.
const safeEqual = (a, b) => {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
};

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (rejectDisallowedOrigin(req, res)) return;

  if (req.method === 'GET') {
    const session = getSessionFromRequest(req, process.env.SESSION_SECRET);
    sendJson(
      req,
      res,
      200,
      session.authenticated ? sessionPayloadToResponse(session.payload) : { authenticated: false }
    );
    return;
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body?.accessCode) {
      sendError(req, res, 400, 'VALIDATION_FAILED', 'Missing access code');
      return;
    }
    if (!process.env.FAMILY_ACCESS_CODE || !process.env.SESSION_SECRET) {
      sendError(req, res, 500, 'INTERNAL_ERROR', 'Server auth is not configured');
      return;
    }
    if (!safeEqual(body.accessCode, process.env.FAMILY_ACCESS_CODE)) {
      sendError(req, res, 401, 'INVALID_ACCESS_CODE', 'That access code was not accepted');
      return;
    }

    const { token, payload } = createSessionToken(process.env.SESSION_SECRET);
    sendJson(req, res, 200, sessionPayloadToResponse(payload, token));
    return;
  }

  if (req.method === 'DELETE') {
    sendNoContent(req, res, 204);
    return;
  }

  methodNotAllowed(req, res, ['GET', 'POST', 'DELETE', 'OPTIONS']);
}
