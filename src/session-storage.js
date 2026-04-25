export const SESSION_STORAGE_KEY = 'recipe_journal_session';

const getStorage = () =>
  typeof localStorage !== 'undefined' &&
  typeof localStorage.getItem === 'function' &&
  typeof localStorage.setItem === 'function'
    ? localStorage
    : null;

const parseDateMs = (value) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
};

export const clearStoredSession = () => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(SESSION_STORAGE_KEY);
  } catch {}
};

export const loadStoredSession = () => {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const token = String(parsed?.token || '').trim();
    const expiresAt = String(parsed?.expiresAt || '').trim();
    const expiresAtMs = parseDateMs(expiresAt);
    if (!token || !expiresAt || !expiresAtMs || expiresAtMs <= Date.now()) {
      clearStoredSession();
      return null;
    }
    return {
      token,
      expiresAt,
      issuedAt: String(parsed?.issuedAt || ''),
      scope: String(parsed?.scope || ''),
    };
  } catch {
    clearStoredSession();
    return null;
  }
};

export const getStoredSessionToken = () => loadStoredSession()?.token || null;

export const storeSession = (session) => {
  const token = String(session?.token || '').trim();
  const expiresAt = String(session?.expiresAt || '').trim();
  const expiresAtMs = parseDateMs(expiresAt);
  if (!token || !expiresAt || !expiresAtMs) {
    clearStoredSession();
    return null;
  }

  const stored = {
    token,
    expiresAt: new Date(expiresAtMs).toISOString(),
    issuedAt: session?.issuedAt ? String(session.issuedAt) : new Date().toISOString(),
    scope: String(session?.scope || 'recipe_journal'),
  };

  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      return stored;
    }
  }

  return stored;
};
