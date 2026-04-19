const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

// Parse a comma-separated ALLOWED_ORIGINS env var into a Set for O(1) lookup.
// Accepts legacy singular ALLOWED_ORIGIN as a fallback. Empty = no CORS headers
// ever emitted (same-origin deploy, or API accessed only from non-browser clients).
export const parseAllowedOrigins = (raw) =>
  new Set(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

const inferRequestProtocol = (req) => {
  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwardedProto) return forwardedProto;
  if (req.socket?.encrypted) return 'https';

  const host = String(req.headers?.host || '').toLowerCase();
  if (host.startsWith('localhost:') || host.startsWith('127.0.0.1:') || host.startsWith('[::1]')) {
    return 'http';
  }
  return 'https';
};

export const isSameOriginRequest = (req, origin) => {
  if (!origin || !req?.headers?.host) return false;
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host === String(req.headers.host) && parsedOrigin.protocol === `${inferRequestProtocol(req)}:`;
  } catch {
    return false;
  }
};

export const isOriginAllowed = (origin, allowedOrigins, req) =>
  !!origin && (allowedOrigins.has(origin) || isSameOriginRequest(req, origin));

export const applyCors = (req, res) => {
  const allowedOrigins = parseAllowedOrigins(
    process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN
  );
  if (!allowedOrigins.size) return;

  const origin = req.headers?.origin;
  if (!isOriginAllowed(origin, allowedOrigins, req)) return;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Family-Code, x-family-code');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Vary', 'Origin');
};

export const rejectDisallowedOrigin = (req, res) => {
  const allowedOrigins = parseAllowedOrigins(
    process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN
  );
  if (!allowedOrigins.size) return false;

  const origin = req.headers?.origin;
  if (!origin || isOriginAllowed(origin, allowedOrigins, req)) return false;

  sendError(req, res, 403, 'CORS_FORBIDDEN', 'Origin is not allowed');
  return true;
};

export const handleCorsPreflight = (req, res) => {
  if (req.method !== 'OPTIONS') return false;
  if (rejectDisallowedOrigin(req, res)) return true;
  applyCors(req, res);
  res.statusCode = 204;
  res.end();
  return true;
};

export const sendJson = (req, res, statusCode, payload) => {
  applyCors(req, res);
  res.writeHead(statusCode, JSON_HEADERS);
  res.end(JSON.stringify(payload));
};

export const sendNoContent = (req, res, statusCode = 204) => {
  applyCors(req, res);
  res.statusCode = statusCode;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
};

export const sendError = (req, res, statusCode, code, message, details = []) => {
  const requestId =
    req.headers?.['x-request-id'] ||
    globalThis.crypto?.randomUUID?.() ||
    `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Structured log for Phase R monitoring. 5xx goes to stderr (via log.error),
  // 4xx to stdout as a warning. 401s are expected traffic and get info level.
  const level = statusCode >= 500 ? 'error' : statusCode === 401 ? 'info' : 'warn';
  // Lazy import to avoid pulling logger into environments that don't want it
  // (e.g. test mocks that stub sendJson directly).
  import('./logger.js').then(({ log }) => {
    log[level]('http.error', {
      requestId,
      route: req.url,
      method: req.method,
      status: statusCode,
      code,
      message,
    });
  }).catch(() => {});

  sendJson(req, res, statusCode, {
    error: { code, message, details, requestId },
  });
};

export const methodNotAllowed = (req, res, methods) =>
  sendError(req, res, 405, 'METHOD_NOT_ALLOWED', `Expected one of: ${methods.join(', ')}`);

export const unauthorized = (req, res, message = 'Authentication required') =>
  sendError(req, res, 401, 'UNAUTHORIZED', message);

export const readJsonBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body;
  if (!req.body && ['GET', 'HEAD'].includes(req.method)) return {};

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
};
