import { clearStoredFamilyCode, loadStoredFamilyCode } from './family-code-storage.js';
import { clearStoredSession, loadStoredSession, storeSession } from './session-storage.js';

export const checkSession = async (api) => {
  const existingSession = loadStoredSession();
  if (!existingSession) return false;
  try {
    const session = await api.getSession();
    if (!session?.authenticated) {
      clearStoredSession();
      return false;
    }
    storeSession({
      ...session,
      token: existingSession.token,
    });
    return true;
  } catch {
    clearStoredSession();
    return false;
  }
};

export const submitAccessCode = async (api, accessCode) => {
  const trimmed = String(accessCode || '').trim();
  if (!trimmed) throw new Error('Access code is required');
  const session = await api.createSession(trimmed);
  if (!session?.token) throw new Error('Session could not be created');
  clearStoredFamilyCode();
  return storeSession(session);
};

export const migrateLegacyFamilyCode = async (api) => {
  const code = loadStoredFamilyCode();
  if (!code || loadStoredSession()) return false;
  try {
    await submitAccessCode(api, code);
    return true;
  } catch {
    clearStoredFamilyCode();
    return false;
  }
};

export const logoutSession = async (api) => {
  if (api?.deleteSession) {
    try {
      await api.deleteSession();
    } catch {}
  }
  clearStoredFamilyCode();
  clearStoredSession();
};

export const clearStoredCredentials = () => {
  clearStoredFamilyCode();
  clearStoredSession();
};
