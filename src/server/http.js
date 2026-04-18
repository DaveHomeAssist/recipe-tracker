const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export const applyCors = (req, res) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (!allowedOrigin) return;

  const origin = req.headers?.origin;
  if (!origin || origin !== allowedOrigin) return;

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Vary', 'Origin');
};

export const handleCorsPreflight = (req, res) => {
  applyCors(req, res);
  if (req.method !== 'OPTIONS') return false;
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
