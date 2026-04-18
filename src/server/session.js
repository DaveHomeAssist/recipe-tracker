import { createHmac, timingSafeEqual } from 'node:crypto';

// 24-hour session window (D4 spec). Shorter than typical web apps because
// this is a tiny family deployment — the cost of re-entering the access
// code once a day is trivial, and it caps the blast radius of a leaked
// token. The session endpoint rotates the token on every successful auth.
const DEFAULT_MAX_AGE = 60 * 60 * 24;
const DEFAULT_SCOPE = 'recipe_journal';

const base64urlEncode = (value) => Buffer.from(value).toString('base64url');
const base64urlDecode = (value) => Buffer.from(value, 'base64url').toString('utf8');

const sign = (value, secret) =>
  createHmac('sha256', secret).update(value).digest('base64url');

export const createSessionToken = (
  secret,
  now = Date.now(),
  maxAge = DEFAULT_MAX_AGE,
  scope = DEFAULT_SCOPE
) => {
  const payload = {
    familyAccess: true,
    scope,
    exp: Math.floor(now / 1000) + maxAge,
    iat: Math.floor(now / 1000),
  };
  const encoded = base64urlEncode(JSON.stringify(payload));
  return {
    token: `${encoded}.${sign(encoded, secret)}`,
    payload,
  };
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
    if (payload.scope !== DEFAULT_SCOPE) return null;
    return payload;
  } catch {
    return null;
  }
};

export const getBearerToken = (header = '') => {
  const [scheme, token] = String(header || '').split(/\s+/, 2);
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
};

export const sessionPayloadToResponse = (payload, token = null) => ({
  authenticated: true,
  scope: payload.scope || DEFAULT_SCOPE,
  issuedAt: new Date(Number(payload.iat) * 1000).toISOString(),
  expiresAt: new Date(Number(payload.exp) * 1000).toISOString(),
  ...(token ? { token } : {}),
});

export const getSessionFromRequest = (req, secret, now = Date.now()) => {
  const token = getBearerToken(req.headers?.authorization || req.headers?.Authorization || '');
  const payload = verifySessionToken(token, secret, now);
  return payload ? { authenticated: true, payload, token } : { authenticated: false, payload: null, token: null };
};
