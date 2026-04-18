// Structured JSON logger. Emits one line per event to stdout so Vercel/
// Cloudflare log tailing works without a hosted telemetry service.
//
// Schema per line:
//   { ts, level, msg, requestId?, route?, status?, code?, err?, ...ctx }
//
// Usage:
//   import { log } from './logger.js';
//   log.info('recipes.list', { requestId, count: 187 });
//   log.warn('notion.rate_limited', { requestId, retryAfter });
//   log.error('recipes.update', { requestId, code: 'VERSION_CONFLICT' }, err);
//
// Keep this file dependency-free — it runs on every serverless cold start.

const LEVELS = ['debug', 'info', 'warn', 'error'];

const serializeError = (err) => {
  if (!err) return undefined;
  if (typeof err === 'string') return { message: err };
  return {
    name: err.name || 'Error',
    message: err.message || String(err),
    code: err.code,
    status: err.status,
    stack: err.stack ? String(err.stack).split('\n').slice(0, 6).join('\n') : undefined,
  };
};

const emit = (level, msg, ctx = {}, err) => {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  };
  if (err) line.err = serializeError(err);
  // Single-line JSON for log aggregators. Writes to stdout for info/warn/debug,
  // stderr for error — lets platforms separate the two without a parser.
  const out = JSON.stringify(line);
  if (level === 'error') {
    process.stderr.write(out + '\n');
  } else {
    process.stdout.write(out + '\n');
  }
};

export const log = LEVELS.reduce((acc, level) => {
  acc[level] = (msg, ctx, err) => emit(level, msg, ctx, err);
  return acc;
}, {});

// Extract a stable request id from a Vercel/Node request. If absent, mint
// one so every log line can be correlated end-to-end.
export const requestIdFor = (req) =>
  req?.headers?.['x-request-id'] ||
  req?.headers?.['x-vercel-id'] ||
  globalThis.crypto?.randomUUID?.() ||
  `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
