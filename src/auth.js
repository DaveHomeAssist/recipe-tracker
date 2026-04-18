import { clearStoredSession, storeSession } from './session-storage.js';

export const checkSession = async (api) => {
  const result = await api.getSession();
  if (!result?.authenticated) {
    clearStoredSession();
    return false;
  }
  return true;
};

export const submitAccessCode = async (api, accessCode) => {
  const trimmed = String(accessCode || '').trim();
  if (!trimmed) throw new Error('Access code is required');
  const session = await api.createSession(trimmed);
  if (!session?.token || !session?.expiresAt) {
    throw new Error('Server did not return a valid session');
  }
  storeSession(session);
  return true;
};

export const logoutSession = async (api) => {
  await api.clearSession();
  clearStoredSession();
};
