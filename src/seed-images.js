import { safeUrl } from './recipe-lib.js';

const normalizeUrl = (value) => safeUrl(value).trim().toLowerCase();

const trackingParam = /^(?:utm_.+|fbclid|gclid|_kx|mc_cid|mc_eid|lctg|lr_input)$/i;

function publicSourceKey(value) {
  try {
    const url = new URL(value);
    if (!safeUrl(value) || url.username || url.password) return '';
    if ([...url.searchParams.keys()].some((key) => !trackingParam.test(key))) return '';
    return url.origin + url.pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function publicCatalogImage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

export async function mergeSeedImages(recipes, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const source = options.source || './build/public/recipes.json';
  const matchKey = options.publicSources ? publicSourceKey : normalizeUrl;
  const imageUrl = options.publicSources ? publicCatalogImage : safeUrl;

  if (!Array.isArray(recipes) || !recipes.length) {
    return { recipes: Array.isArray(recipes) ? recipes : [], changed: 0 };
  }

  const response = await fetchImpl(source, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`seed image fetch failed (${response.status})`);
  }

  const seededRecipes = await response.json();
  const imageByUrl = new Map();

  for (const recipe of seededRecipes) {
    const key = matchKey(recipe?.url);
    const image = imageUrl(recipe?.image);
    if (!key || !image) continue;
    if (!imageByUrl.has(key)) {
      imageByUrl.set(key, image);
    } else if (options.publicSources && imageByUrl.get(key) !== image) {
      imageByUrl.set(key, '');
    }
  }

  let changed = 0;
  const nextRecipes = recipes.map((recipe) => {
    if (safeUrl(recipe?.image)) return recipe;
    const match = imageByUrl.get(matchKey(recipe?.url));
    if (!match) return recipe;
    changed += 1;
    return { ...recipe, image: match };
  });

  return { recipes: nextRecipes, changed };
}
