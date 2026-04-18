import { describe, expect, it, vi } from 'vitest';

import {
  buildClientErrorPayload,
  installGlobalErrorReporting,
  reportClientError,
} from '../../src/client-error-reporting.js';

describe('client error reporting', () => {
  it('builds a bounded payload from an Error', () => {
    const payload = buildClientErrorPayload({
      kind: 'error',
      input: new Error('boom'),
      url: 'https://example.com/app',
      ctx: { syncMode: 'remote' },
    });

    expect(payload.kind).toBe('error');
    expect(payload.message).toBe('boom');
    expect(payload.stack).toContain('Error: boom');
    expect(payload.url).toBe('https://example.com/app');
    expect(payload.ctx).toEqual({ syncMode: 'remote' });
  });

  it('posts JSON to the client-error endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const ok = await reportClientError({
      endpoint: '/api/v1/log/client-error',
      payload: { kind: 'error', message: 'boom' },
      fetchImpl: fetchMock,
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/log/client-error', expect.objectContaining({
      method: 'POST',
      keepalive: true,
    }));
  });

  it('installs global listeners, shows a toast, and dedupes repeated failures', () => {
    const listeners = new Map();
    const target = {
      location: { href: 'https://example.com/app' },
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type) {
        listeners.delete(type);
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const onToast = vi.fn();

    const uninstall = installGlobalErrorReporting({
      target,
      fetchImpl: fetchMock,
      onToast,
      getContext: () => ({ syncMode: 'remote' }),
      dedupeWindowMs: 10_000,
    });

    listeners.get('error')({ error: new Error('boom') });
    listeners.get('error')({ error: new Error('boom') });

    expect(onToast).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    uninstall();
    expect(listeners.size).toBe(0);
  });
});
