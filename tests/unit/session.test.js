import { describe, expect, it } from 'vitest';

import {
  createSessionToken,
  getBearerToken,
  getSessionFromRequest,
  sessionPayloadToResponse,
  verifySessionToken,
} from '../../src/server/session.js';

describe('session helpers', () => {
  const secret = 'super-secret';
  const now = Date.UTC(2026, 3, 16);

  it('creates and verifies a valid session token', () => {
    const { token } = createSessionToken(secret, now, 60);
    const payload = verifySessionToken(token, secret, now + 1000);
    expect(payload?.familyAccess).toBe(true);
    expect(payload?.scope).toBe('recipe_journal');
  });

  it('rejects an expired token', () => {
    const { token } = createSessionToken(secret, now, 1);
    expect(verifySessionToken(token, secret, now + 5000)).toBeNull();
  });

  it('reads the bearer token from Authorization and retrieves the active session', () => {
    const { token } = createSessionToken(secret, now, 60);
    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };
    const session = getSessionFromRequest(req, secret, now + 1000);
    expect(session.authenticated).toBe(true);
    expect(session.token).toBe(token);
  });

  it('extracts bearer tokens only for Bearer auth headers', () => {
    expect(getBearerToken('Bearer abc.def')).toBe('abc.def');
    expect(getBearerToken('Basic abc')).toBeNull();
    expect(getBearerToken('')).toBeNull();
  });

  it('converts a session payload into the client response shape', () => {
    const { token, payload } = createSessionToken(secret, now, 123);
    expect(sessionPayloadToResponse(payload, token)).toEqual({
      authenticated: true,
      token,
      scope: 'recipe_journal',
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 123000).toISOString(),
    });
  });
});
