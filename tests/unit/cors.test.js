import { describe, it, expect } from 'vitest';
import { parseAllowedOrigins, isOriginAllowed, applyCors } from '../../src/server/http.js';

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
});

describe('applyCors', () => {
  const makeReq = (origin) => ({ headers: origin ? { origin } : {} });
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
    expect(res.headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(res.headers['Vary']).toBe('Origin');
  });

  it('emits nothing when origin is not in the allowlist', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.example.com';
    const req = makeReq('https://evil.example.com');
    const res = makeRes();
    applyCors(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
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
