import { describe, expect, it } from 'vitest';

import {
  createSessionToken,
  getSessionFromRequest,
  parseCookies,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  verifySessionToken,
} from '../../src/server/session.js';

describe('session helpers', () => {
  const secret = 'super-secret';
  const now = Date.UTC(2026, 3, 16);

  it('creates and verifies a valid session token', () => {
    const token = createSessionToken(secret, now, 60);
    const payload = verifySessionToken(token, secret, now + 1000);
    expect(payload?.familyAccess).toBe(true);
  });

  it('rejects an expired token', () => {
    const token = createSessionToken(secret, now, 1);
    expect(verifySessionToken(token, secret, now + 5000)).toBeNull();
  });

  it('parses cookies and retrieves the active session from a request', () => {
    const token = createSessionToken(secret, now, 60);
    const req = {
      headers: {
        cookie: `foo=bar; rt_session=${token}`,
      },
    };
    const session = getSessionFromRequest(req, secret, now + 1000);
    expect(session.authenticated).toBe(true);
  });

  it('serializes set-cookie headers for create and clear', () => {
    const cookie = serializeSessionCookie('abc', 123);
    expect(cookie).toContain('rt_session=abc');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=123');
    expect(serializeClearedSessionCookie()).toContain('Max-Age=0');
  });

  it('parses a raw cookie header into a map', () => {
    expect(parseCookies('foo=bar; hello=world')).toEqual({
      foo: 'bar',
      hello: 'world',
    });
  });
});
