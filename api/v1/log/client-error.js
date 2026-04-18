// Accepts structured client-side error reports and logs them to stdout.
// Deliberately lightweight — no persistence, no deduplication, no rate
// limit beyond the CORS allowlist. Phase R monitoring reads these off
// the platform's log tail.

import { handleCorsPreflight, methodNotAllowed, readJsonBody, rejectDisallowedOrigin, sendNoContent } from '../../../src/server/http.js';
import { log, requestIdFor } from '../../../src/server/logger.js';

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 4000;
const truncate = (value, max) =>
  !value ? '' : String(value).slice(0, max);

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (rejectDisallowedOrigin(req, res)) return;
  if (req.method !== 'POST') {
    methodNotAllowed(req, res, ['POST', 'OPTIONS']);
    return;
  }

  const body = await readJsonBody(req).catch(() => ({}));
  const requestId = requestIdFor(req);

  log.warn('client.error', {
    requestId,
    kind: truncate(body.kind, 64),
    message: truncate(body.message, MAX_MESSAGE_LEN),
    stack: truncate(body.stack, MAX_STACK_LEN),
    userAgent: truncate(req.headers?.['user-agent'], 256),
    url: truncate(body.url, 512),
    // Client-supplied context field — structured but clamped.
    ctx: body.ctx && typeof body.ctx === 'object' ? body.ctx : undefined,
  });

  sendNoContent(req, res, 204);
}
