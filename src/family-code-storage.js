export const FAMILY_CODE_STORAGE_KEY = 'recipe_journal_family_code';

const isBrowser = () => typeof localStorage !== 'undefined';

export const clearStoredFamilyCode = () => {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(FAMILY_CODE_STORAGE_KEY);
  } catch {}
};

export const loadStoredFamilyCode = () => {
  if (!isBrowser()) return '';
  try {
    return String(localStorage.getItem(FAMILY_CODE_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
};

export const storeFamilyCode = (value) => {
  const code = String(value || '').trim();
  if (!code) {
    clearStoredFamilyCode();
    return '';
  }

  if (isBrowser()) {
    try {
      localStorage.setItem(FAMILY_CODE_STORAGE_KEY, code);
    } catch {}
  }

  return code;
};
