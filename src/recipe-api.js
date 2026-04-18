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

export const createRecipeApi = ({ baseUrl = '/api/v1', getSessionToken = () => null, onUnauthorized = () => {} } = {}) => {
  const root = trimTrailingSlash(baseUrl);

  const request = async (path, options = {}) => {
    const token = getSessionToken();
    const response = await fetch(`${root}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });

    if (response.status === 204) return null;

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) onUnauthorized();
      throw new ApiError(payload?.error?.message || `Request failed with ${response.status}`, {
        status: response.status,
        code: payload?.error?.code,
        details: payload?.error?.details,
      });
    }
    return payload;
  };

  return {
    getSession: () => request('/session'),
    createSession: (accessCode) =>
      request('/session', {
        method: 'POST',
        body: JSON.stringify({ accessCode }),
      }),
    clearSession: () => request('/session', { method: 'DELETE' }),
    getRecipes: async () => {
      const payload = await request('/recipes');
      return payload.data || [];
    },
    createRecipe: async (recipe) => {
      const payload = await request('/recipes', {
        method: 'POST',
        body: JSON.stringify(recipe),
      });
      return payload.data?.recipe || null;
    },
    updateRecipe: async (id, patch) => {
      const payload = await request(`/recipes/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      return payload.data?.recipe || null;
    },
    deleteRecipe: (id, version) =>
      request(`/recipes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ version }),
      }),
    importRecipes: (mode, payload, replaceConfirmed = false) =>
      request('/import', {
        method: 'POST',
        body: JSON.stringify({ mode, payload, replaceConfirmed }),
      }),
    health: () => request('/health'),
  };
};

export { ApiError };
