import { describe, it, expect } from 'vitest';
import { parseAllowedOrigins, isOriginAllowed, isSameOriginRequest, applyCors, rejectDisallowedOrigin } from '../../src/server/http.js';

describe('parseAllowedOrigins', () => {
  it('splits a comma-separated list and trims whitespace', () => {
    const out = parseAllowedOrigins('https://a.example.com, https://b.example.com');
    expect(out.has('https://a.example.com')).toBe(true);
    expect(out.has('https://b.example.com')).toBe(true);
    expect(out.size).toBe(2);
  });

  it('treats empty, null, undefined as empty allowlist', () => {
    expect(parseAllowedOrigins('').size).toBe(0);
    expect(parseAllowedOrigins(null).size).toBe(0);
    expect(parseAllowedOrigins(undefined).size).toBe(0);
  });

  it('drops empty fragments from sloppy input', () => {
    const out = parseAllowedOrigins(',,https://a.example.com,,');
    expect(out.size).toBe(1);
    expect(out.has('https://a.example.com')).toBe(true);
  });
});

describe('isOriginAllowed', () => {
  const allowed = parseAllowedOrigins('https://a.example.com,https://b.example.com');

  it('accepts an exact match', () => {
    expect(isOriginAllowed('https://a.example.com', allowed)).toBe(true);
  });

  it('rejects a case-mismatched origin (Origin headers are case-sensitive)', () => {
    expect(isOriginAllowed('https://A.EXAMPLE.COM', allowed)).toBe(false);
  });

  it('rejects a subdomain that is not explicitly listed', () => {
    expect(isOriginAllowed('https://evil.a.example.com', allowed)).toBe(false);
  });

  it('rejects null, empty, missing Origin', () => {
    expect(isOriginAllowed(null, allowed)).toBe(false);
    expect(isOriginAllowed('', allowed)).toBe(false);
    expect(isOriginAllowed(undefined, allowed)).toBe(false);
  });

  it('rejects everything when the allowlist is empty', () => {
    expect(isOriginAllowed('https://a.example.com', new Set())).toBe(false);
  });

  it('accepts same-origin requests even when the origin is not in the explicit allowlist', () => {
    expect(
      isOriginAllowed('http://127.0.0.1:4010', allowed, {
        headers: { host: '127.0.0.1:4010' },
      })
    ).toBe(true);
  });
});

describe('isSameOriginRequest', () => {
  it('detects localhost same-origin requests', () => {
    expect(
      isSameOriginRequest(
        { headers: { host: '127.0.0.1:4010' } },
        'http://127.0.0.1:4010'
      )
    ).toBe(true);
  });

  it('rejects different hosts', () => {
    expect(
      isSameOriginRequest(
        { headers: { host: '127.0.0.1:4010' } },
        'http://127.0.0.1:4020'
      )
    ).toBe(false);
  });
});

describe('applyCors', () => {
  const makeReq = (origin, host) => ({ headers: { ...(origin ? { origin } : {}), ...(host ? { host } : {}) } });
  const makeRes = () => {
    const headers = {};
    return {
      headers,
      setHeader: (k, v) => { headers[k] = v; },
    };
  };

  it('sets ACAO to the request origin when allowed (wildcard-free reflection)', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.example.com,https://b.example.com';
    const req = makeReq('https://b.example.com');
    const res = makeRes();
    applyCors(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://b.example.com');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Authorization, Content-Type, X-Family-Code, x-family-code');
    expect(res.headers['Vary']).toBe('Origin');
  });

  it('emits nothing when origin is not in the allowlist', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.example.com';
    const req = makeReq('https://evil.example.com');
    const res = makeRes();
    applyCors(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('reflects same-origin localhost requests for dev without widening cross-origin access', () => {
    process.env.ALLOWED_ORIGINS = 'https://davehomeassist.github.io';
    const req = makeReq('http://127.0.0.1:4010', '127.0.0.1:4010');
    const res = makeRes();
    applyCors(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:4010');
  });

  it('emits nothing when ALLOWED_ORIGINS is unset', () => {
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.ALLOWED_ORIGIN;
    const req = makeReq('https://a.example.com');
    const res = makeRes();
    applyCors(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('falls back to legacy singular ALLOWED_ORIGIN when ALLOWED_ORIGINS is unset', () => {
    delete process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGIN = 'https://legacy.example.com';
    const req = makeReq('https://legacy.example.com');
    const res = makeRes();
    applyCors(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://legacy.example.com');
    delete process.env.ALLOWED_ORIGIN;
  });
});

describe('rejectDisallowedOrigin', () => {
  const makeReq = (origin, host) => ({
    method: 'GET',
    url: '/api/test',
    headers: { ...(origin ? { origin } : {}), ...(host ? { host } : {}) },
  });
  const makeRes = () => {
    const headers = {};
    return {
      headers,
      statusCode: 200,
      body: '',
      setHeader: (k, v) => { headers[k] = v; },
      writeHead(statusCode, extraHeaders = {}) {
        this.statusCode = statusCode;
        Object.assign(headers, extraHeaders);
      },
      end(payload = '') {
        this.body = String(payload || '');
      },
    };
  };

  it('returns false for same-origin or unset allowlist flows', () => {
    delete process.env.ALLOWED_ORIGINS;
    const req = makeReq('https://evil.example.com');
    const res = makeRes();
    expect(rejectDisallowedOrigin(req, res)).toBe(false);
  });

  it('returns 403 and structured error JSON for disallowed origins', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.example.com';
    const req = makeReq('https://evil.example.com');
    const res = makeRes();
    expect(rejectDisallowedOrigin(req, res)).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CORS_FORBIDDEN');
  });

  it('does not reject same-origin localhost requests', () => {
    process.env.ALLOWED_ORIGINS = 'https://davehomeassist.github.io';
    const req = makeReq('http://127.0.0.1:4010', '127.0.0.1:4010');
    const res = makeRes();
    expect(rejectDisallowedOrigin(req, res)).toBe(false);
    expect(res.statusCode).toBe(200);
  });
});
