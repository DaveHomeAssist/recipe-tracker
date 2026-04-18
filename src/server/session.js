import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_MAX_AGE = 60 * 60 * 24 * 30;

const base64urlEncode = (value) => Buffer.from(value).toString('base64url');
const base64urlDecode = (value) => Buffer.from(value, 'base64url').toString('utf8');

const sign = (value, secret) =>
  createHmac('sha256', secret).update(value).digest('base64url');

export const parseCookies = (header = '') =>
  String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return acc;
      acc[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
      return acc;
    }, {});

export const createSessionToken = (secret, now = Date.now(), maxAge = DEFAULT_MAX_AGE) => {
  const payload = {
    familyAccess: true,
    exp: Math.floor(now / 1000) + maxAge,
    iat: Math.floor(now / 1000),
  };
  const encoded = base64urlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
};

export const verifySessionToken = (token, secret, now = Date.now()) => {
  if (!token || !secret) return null;
  const [encoded, signature] = String(token).split('.');
  if (!encoded || !signature) return null;

  const expected = sign(encoded, secret);
  const valid =
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return null;

  try {
    const payload = JSON.parse(base64urlDecode(encoded));
    if (!payload?.familyAccess || !payload?.exp) return null;
    if (payload.exp <= Math.floor(now / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
};

export const serializeSessionCookie = (token, maxAge = DEFAULT_MAX_AGE) =>
  `rt_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const serializeClearedSessionCookie = () =>
  'rt_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

export const getSessionFromRequest = (req, secret, now = Date.now()) => {
  const cookies = parseCookies(req.headers?.cookie || '');
  const payload = verifySessionToken(cookies.rt_session, secret, now);
  return payload ? { authenticated: true, payload } : { authenticated: false, payload: null };
};
