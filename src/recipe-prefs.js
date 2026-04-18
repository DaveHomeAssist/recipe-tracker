const PREFS_KEY = 'recipe_journal_prefs';
const DEFAULT_FILTERS = {
  cuisine: null,
  tags: [],
  rating: 0,
  search: '',
};

const DEFAULTS = {
  recentSearches: [],
  lastFilter: 'all',
  filters: DEFAULT_FILTERS,
  defaultRating: 0,
  editsSinceLastExport: 0,
  lastNudgeDismissedAt: 0,
  recentlyViewed: [],
  recentManualRatings: [],
  v: 1,
};

const getStorage = () =>
  globalThis.localStorage &&
  typeof globalThis.localStorage.getItem === 'function' &&
  typeof globalThis.localStorage.setItem === 'function'
    ? globalThis.localStorage
    : null;

const normalizeStringList = (value, max = 5) =>
  Array.isArray(value)
    ? value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, max)
    : [];

const normalizeFilters = (value, fallback = DEFAULT_FILTERS) => {
  const source = value && typeof value === 'object' ? value : {};
  return {
    cuisine: source.cuisine ? String(source.cuisine).trim() || null : fallback.cuisine,
    tags: normalizeStringList(source.tags, 20),
    rating: Number.isFinite(Number(source.rating)) ? Math.max(0, Math.min(5, Number(source.rating))) : fallback.rating,
    search: String(source.search || fallback.search || ''),
  };
};

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

export const loadPrefs = () => {
  try {
    const storage = getStorage();
    if (!storage) return { ...DEFAULTS };
    const raw = storage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const fallbackFilters = parsed?.lastFilter && parsed.lastFilter !== 'all'
      ? { ...DEFAULT_FILTERS, cuisine: String(parsed.lastFilter) }
      : DEFAULT_FILTERS;
    return {
      ...DEFAULTS,
      ...parsed,
      filters: normalizeFilters(parsed?.filters, fallbackFilters),
      recentSearches: normalizeStringList(parsed?.recentSearches, 5),
      recentlyViewed: normalizeStringList(parsed?.recentlyViewed, 5),
      recentManualRatings: Array.isArray(parsed?.recentManualRatings)
        ? parsed.recentManualRatings
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0 && value <= 5)
            .slice(-10)
        : [],
    };
  } catch {
    return { ...DEFAULTS };
  }
};

export const savePrefs = (prefs) => {
  const storage = getStorage();
  if (!storage) return prefs;
  const normalized = {
    ...DEFAULTS,
    ...prefs,
    filters: normalizeFilters(prefs?.filters),
    recentSearches: normalizeStringList(prefs?.recentSearches, 5),
    recentlyViewed: normalizeStringList(prefs?.recentlyViewed, 5),
    recentManualRatings: Array.isArray(prefs?.recentManualRatings)
      ? prefs.recentManualRatings
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0 && value <= 5)
          .slice(-10)
      : [],
  };
  normalized.lastFilter = normalized.filters.cuisine || 'all';
  storage.setItem(PREFS_KEY, JSON.stringify(normalized));
  return normalized;
};

export const recordSearch = (query, prefs = loadPrefs()) => {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 3) {
    return savePrefs({
      ...prefs,
      filters: { ...prefs.filters, search: trimmed },
    });
  }
  const recentSearches = [
    trimmed,
    ...prefs.recentSearches.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
  ].slice(0, 5);
  return savePrefs({
    ...prefs,
    recentSearches,
    filters: { ...prefs.filters, search: trimmed },
  });
};

export const recordFilter = (filter, prefs = loadPrefs()) => {
  if (filter && typeof filter === 'object') {
    return savePrefs({
      ...prefs,
      filters: normalizeFilters(filter, prefs.filters),
    });
  }
  return savePrefs({
    ...prefs,
    filters: {
      ...prefs.filters,
      cuisine: filter && filter !== 'all' ? String(filter) : null,
    },
  });
};

export const recordRating = (rating, prefs = loadPrefs()) => {
  const value = Number(rating);
  if (!Number.isFinite(value) || value <= 0) return prefs;
  const recentManualRatings = [...prefs.recentManualRatings, Math.round(value)].slice(-10);
  return savePrefs({
    ...prefs,
    recentManualRatings,
    defaultRating: median(recentManualRatings),
  });
};

export const recordEdit = (prefs = loadPrefs()) =>
  savePrefs({ ...prefs, editsSinceLastExport: Number(prefs.editsSinceLastExport || 0) + 1 });

export const recordExport = (prefs = loadPrefs()) =>
  savePrefs({ ...prefs, editsSinceLastExport: 0, lastNudgeDismissedAt: 0 });

export const recordView = (id, prefs = loadPrefs()) => {
  const value = String(id || '').trim();
  if (!value) return prefs;
  return savePrefs({
    ...prefs,
    recentlyViewed: [value, ...prefs.recentlyViewed.filter((item) => item !== value)].slice(0, 5),
  });
};
