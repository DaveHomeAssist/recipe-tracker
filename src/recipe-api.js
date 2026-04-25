class ApiError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details = [] } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

export const createRecipeApi = ({ baseUrl = '/api', getSessionToken = () => '', onUnauthorized = () => {} } = {}) => {
  const root = trimTrailingSlash(baseUrl);

  const request = async (path, options = {}) => {
    const sessionToken = String(options.sessionToken ?? getSessionToken() ?? '').trim();

    let response;
    try {
      response = await fetch(`${root}${path}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
          ...(options.headers || {}),
        },
        ...options,
      });
    } catch (error) {
      throw new ApiError('Network request failed', {
        status: 0,
        code: 'NETWORK_ERROR',
        details: [{ message: error.message }],
      });
    }

    if (response.status === 204) return null;

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && payload?.error?.code === 'UNAUTHORIZED') onUnauthorized();
      throw new ApiError(payload?.error?.message || `Request failed with ${response.status}`, {
        status: response.status,
        code: payload?.error?.code,
        details: payload?.error?.details,
      });
    }
    return payload;
  };

  return {
    createSession: async (accessCode) => {
      const payload = await request('/v1/session', {
        method: 'POST',
        body: JSON.stringify({ accessCode }),
      });
      return payload;
    },
    getSession: () => request('/v1/session', { method: 'GET' }),
    deleteSession: () => request('/v1/session', { method: 'DELETE' }),
    getRecipes: async () => {
      const payload = await request('/v1/recipes');
      return payload.data || [];
    },
    getRecipe: async (id) => {
      const payload = await request(`/v1/recipes/${encodeURIComponent(id)}`);
      return payload.data?.recipe || null;
    },
    createRecipe: async (recipe) => {
      const payload = await request('/v1/recipes', {
        method: 'POST',
        body: JSON.stringify(recipe),
      });
      return payload.data?.recipe || null;
    },
    updateRecipe: async (id, patch) => {
      const payload = await request(`/v1/recipes/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      return payload.data?.recipe || null;
    },
    deleteRecipe: (id, version) =>
      request(`/v1/recipes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ version }),
      }),
    syncRecipes: (payload) =>
      request('/v1/recipes/sync', {
        method: 'POST',
        body: JSON.stringify({ payload }),
      }),
    health: () => request('/v1/health'),
  };
};

export { ApiError };
