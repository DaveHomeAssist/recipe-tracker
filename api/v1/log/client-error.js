// Accepts structured client-side error reports and logs them to stdout.
// Deliberately lightweight — no persistence or deduplication. Phase R
// monitoring reads these off the platform's log tail. The shared write
// limiter caps accidental client loops and unauthenticated log spam.

import { handleCorsPreflight, methodNotAllowed, readJsonBody, rejectDisallowedOrigin, sendNoContent } from '../../../src/server/http.js';
import { log, requestIdFor } from '../../../src/server/logger.js';
import { enforceWriteRateLimit } from '../../../src/server/write-rate-limit.js';

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
  if (!enforceWriteRateLimit(req, res)) return;

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
