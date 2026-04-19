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

export const createRecipeApi = ({ baseUrl = '/api', getFamilyCode = () => '', onUnauthorized = () => {} } = {}) => {
  const root = trimTrailingSlash(baseUrl);

  const request = async (path, options = {}) => {
    const familyCode = String(options.familyCode ?? getFamilyCode() ?? '').trim();

    let response;
    try {
      response = await fetch(`${root}${path}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(familyCode ? { 'x-family-code': familyCode } : {}),
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
    verifyAccessCode: (familyCode) =>
      request('/health', {
        method: 'GET',
        familyCode,
      }),
    getRecipes: async () => {
      const payload = await request('/recipes');
      return payload.data || [];
    },
    getRecipe: async (id) => {
      const payload = await request(`/recipes/${encodeURIComponent(id)}`);
      return payload.data?.recipe || null;
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
    syncRecipes: (payload) =>
      request('/recipes/sync', {
        method: 'POST',
        body: JSON.stringify({ payload }),
      }),
    health: () => request('/health'),
  };
};

export { ApiError };
