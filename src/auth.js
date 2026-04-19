import { clearStoredFamilyCode, loadStoredFamilyCode, storeFamilyCode } from './family-code-storage.js';

export const checkSession = async (api) => {
  const code = loadStoredFamilyCode();
  if (!code) return false;
  try {
    await api.health();
    return true;
  } catch {
    clearStoredFamilyCode();
    return false;
  }
};

export const submitAccessCode = async (api, accessCode) => {
  const trimmed = String(accessCode || '').trim();
  if (!trimmed) throw new Error('Access code is required');
  await api.verifyAccessCode(trimmed);
  storeFamilyCode(trimmed);
  return true;
};

export const logoutSession = async () => {
  clearStoredFamilyCode();
};
