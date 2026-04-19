import { sendError } from './http.js';

const WINDOW_MS = 60_000;
const DEFAULT_MAX_WRITES = 10;
const writeBuckets = new Map();

const nowMs = () => Date.now();

export const getClientIp = (req) => {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded) return forwarded;
  const realIp = String(req.headers?.['x-real-ip'] || '').trim();
  if (realIp) return realIp;
  return req.socket?.remoteAddress || 'unknown';
};

const maxWritesPerMinute = () => {
  const configured = Number(process.env.WRITE_RATE_LIMIT_PER_MINUTE || process.env.WRITE_RATE_LIMIT_MAX || '');
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_WRITES;
};

export const __resetWriteRateLimitForTests = () => {
  writeBuckets.clear();
};

export const enforceWriteRateLimit = (req, res) => {
  const ip = getClientIp(req);
  const cutoff = nowMs() - WINDOW_MS;
  const bucket = (writeBuckets.get(ip) || []).filter((timestamp) => timestamp > cutoff);

  if (bucket.length >= maxWritesPerMinute()) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket[0] + WINDOW_MS - nowMs()) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    sendError(req, res, 429, 'RATE_LIMITED', 'Too many write requests. Try again in a minute.');
    writeBuckets.set(ip, bucket);
    return false;
  }

  bucket.push(nowMs());
  writeBuckets.set(ip, bucket);
  return true;
};
