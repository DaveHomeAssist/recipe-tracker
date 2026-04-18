export const checkSession = async (api) => {
  const result = await api.getSession();
  return Boolean(result?.authenticated);
};

export const submitAccessCode = async (api, accessCode) => {
  const trimmed = String(accessCode || '').trim();
  if (!trimmed) throw new Error('Access code is required');
  await api.createSession(trimmed);
  return true;
};

export const logoutSession = async (api) => {
  await api.clearSession();
};
