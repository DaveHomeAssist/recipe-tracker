import { safeUrl } from './recipe-lib.js';

const normalizeUrl = (value) => safeUrl(value).trim().toLowerCase();

export async function mergeSeedImages(recipes, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const source = options.source || './build/public/recipes.json';

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
    const url = normalizeUrl(recipe?.url);
    const image = safeUrl(recipe?.image);
    if (url && image && !imageByUrl.has(url)) {
      imageByUrl.set(url, image);
    }
  }

  let changed = 0;
  const nextRecipes = recipes.map((recipe) => {
    if (safeUrl(recipe?.image)) return recipe;
    const match = imageByUrl.get(normalizeUrl(recipe?.url));
    if (!match) return recipe;
    changed += 1;
    return { ...recipe, image: match };
  });

  return { recipes: nextRecipes, changed };
}
