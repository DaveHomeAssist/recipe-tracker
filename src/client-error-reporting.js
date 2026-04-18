const DEFAULT_ENDPOINT = '/api/v1/log/client-error';
const DEFAULT_TOAST = 'Something went wrong. Reload if the app stops responding.';

const asString = (value, max = 0) => {
  const normalized = value == null ? '' : String(value);
  return max > 0 ? normalized.slice(0, max) : normalized;
};

const extractError = (input) => {
  if (!input) return { message: 'Unknown client error', stack: '' };
  if (typeof input === 'string') return { message: input, stack: '' };
  if (input instanceof Error) {
    return {
      message: asString(input.message || input.name || 'Unknown client error', 2000),
      stack: asString(input.stack || '', 4000),
    };
  }
  if (typeof input === 'object') {
    return {
      message: asString(input.message || input.reason || input.type || 'Unknown client error', 2000),
      stack: asString(input.stack || '', 4000),
    };
  }
  return { message: asString(input, 2000), stack: '' };
};

export const buildClientErrorPayload = ({
  kind = 'error',
  input,
  url = '',
  ctx = {},
} = {}) => {
  const { message, stack } = extractError(input);
  return {
    kind: asString(kind, 64) || 'error',
    message,
    stack,
    url: asString(url || globalThis.location?.href || '', 512),
    ctx: ctx && typeof ctx === 'object' ? ctx : {},
  };
};

export const reportClientError = async ({
  endpoint = DEFAULT_ENDPOINT,
  payload,
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (!payload || typeof fetchImpl !== 'function') return false;
  try {
    await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return true;
  } catch {
    return false;
  }
};

export const installGlobalErrorReporting = ({
  target = globalThis,
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = globalThis.fetch,
  getContext = () => ({}),
  onToast = () => {},
  toastMessage = DEFAULT_TOAST,
  dedupeWindowMs = 5000,
} = {}) => {
  if (!target || typeof target.addEventListener !== 'function') {
    return () => {};
  }

  let lastFingerprint = '';
  let lastReportedAt = 0;

  const emit = (kind, input) => {
    const payload = buildClientErrorPayload({
      kind,
      input,
      ctx: getContext(),
      url: target.location?.href || globalThis.location?.href || '',
    });
    const fingerprint = `${payload.kind}:${payload.message}:${payload.url}`;
    const now = Date.now();
    if (fingerprint === lastFingerprint && now - lastReportedAt < dedupeWindowMs) {
      return;
    }
    lastFingerprint = fingerprint;
    lastReportedAt = now;
    onToast(toastMessage);
    void reportClientError({ endpoint, payload, fetchImpl });
  };

  const onError = (event) => {
    emit('error', event?.error || event?.message || event);
  };

  const onUnhandledRejection = (event) => {
    emit('unhandledrejection', event?.reason || event);
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => {
    if (typeof target.removeEventListener === 'function') {
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onUnhandledRejection);
    }
  };
};
