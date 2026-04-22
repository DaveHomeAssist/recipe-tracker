// Client API wrapper for the three non-recipe stores.
// Mirrors the pattern in src/recipe-api.js so a future merge is trivial.
// Endpoints:
//   GET  /api/v1/stores/:store    -> { data: { version, payload }, meta }
//   PUT  /api/v1/stores/:store    -> body: { version, payload }
// Stores: 'meal_plan' | 'shopping_list' | 'pantry'
// Conflict: 409 on stale version, response includes server's {version, payload}.

class StoresApiError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details = null } = {}) {
    super(message);
    this.name = 'StoresApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const STORE_KEYS = Object.freeze(['meal_plan', 'shopping_list', 'pantry']);

const trimSlash = (v) => String(v || '').replace(/\/+$/, '');

export function createStoresApi({
  baseUrl = '/api',
  getSessionToken = () => '',
  onUnauthorized = () => {},
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
} = {}) {
  if (!fetchImpl) throw new Error('createStoresApi: no fetch implementation available');
  const root = trimSlash(baseUrl);

  async function request(path, options = {}) {
    const token = String(options.sessionToken ?? getSessionToken() ?? '').trim();
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
        ...options,
      });
    } catch (err) {
      throw new StoresApiError('Network request failed', {
        status: 0, code: 'NETWORK_ERROR', details: err?.message,
      });
    }

    if (response.status === 204) return null;
    let payload = {};
    try { payload = await response.json(); } catch { /* non-JSON */ }
    if (!response.ok) {
      if (response.status === 401) onUnauthorized();
      throw new StoresApiError(payload?.error?.message || `Request failed with ${response.status}`, {
        status: response.status,
        code: payload?.error?.code || 'HTTP_ERROR',
        details: payload?.error?.details || payload,
      });
    }
    return payload;
  }

  function assertStore(key) {
    if (!STORE_KEYS.includes(key)) throw new StoresApiError(`Unknown store: ${key}`, { status: 400, code: 'BAD_STORE' });
  }

  return {
    getStore: async (store) => {
      assertStore(store);
      const r = await request(`/v1/stores/${encodeURIComponent(store)}`, { method: 'GET' });
      return r?.data || null;
    },
    putStore: async (store, { version, payload }) => {
      assertStore(store);
      const body = JSON.stringify({ version: Number(version) || 0, payload });
      const r = await request(`/v1/stores/${encodeURIComponent(store)}`, { method: 'PUT', body });
      return r?.data || null;
    },
  };
}

export { StoresApiError };
