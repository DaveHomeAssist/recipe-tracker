// Pure render helpers. No DOM mutations, no state — every function takes
// its inputs explicitly and returns strings or arrays. Safe to import from
// tests and from the main page.

import { escapeHtml, getTagLabel, getRecipeTagText, normalizeTagSlugs, resolveTagColor, safeUrl } from './recipe-lib.js';

export const stars = (n) =>
  Array.from({ length: 5 }, (_, i) => `<span style="opacity:${i < n ? 1 : 0.18}">★</span>`).join('');

const cClass = (c) =>
  'cuisine-' + String(c || 'other').toLowerCase().replace(/[\s/]+/g, '-');

const normalizeFilters = ({ filter = 'all', filters = null, search = '' } = {}) => {
  if (filters && typeof filters === 'object') {
    return {
      cuisine: filters.cuisine ? String(filters.cuisine) : null,
      tags: Array.isArray(filters.tags) ? filters.tags.filter(Boolean).map(String) : [],
      rating: Number.isFinite(Number(filters.rating)) ? Number(filters.rating) : 0,
      search: String(filters.search || ''),
    };
  }
  return {
    cuisine: filter && filter !== 'all' ? String(filter) : null,
    tags: [],
    rating: 0,
    search: String(search || ''),
  };
};

export const filtered = (recipes, options = {}) => {
  const activeFilters = normalizeFilters(options);
  const q = activeFilters.search.toLowerCase();
  const tagRegistry = options.tagRegistry || {};
  const hasTagFilters = activeFilters.tags.length > 0;
  const hasRatingFilter = activeFilters.rating > 0;
  const hasQuery = q.length > 0;
  return recipes.filter((r) => {
    if (activeFilters.cuisine && r.cuisine !== activeFilters.cuisine) return false;
    if (hasTagFilters) {
      const recipeTagSlugs = normalizeTagSlugs(r.tags, tagRegistry);
      for (const slug of activeFilters.tags) {
        if (!recipeTagSlugs.includes(slug)) return false;
      }
    }
    if (hasRatingFilter && Number(r.rating || 0) < activeFilters.rating) return false;
    if (!hasQuery) return true;

    if ((r.name || '').toLowerCase().includes(q)) return true;
    if ((r.location || '').toLowerCase().includes(q)) return true;
    if ((r.source || '').toLowerCase().includes(q)) return true;
    if ((r.notes || '').toLowerCase().includes(q)) return true;
    if ((r.ingredients || '').toLowerCase().includes(q)) return true;
    return getRecipeTagText(r.tags, tagRegistry).toLowerCase().includes(q);
  });
};

const resolveCardOptions = (indexOrOptions = 0, maybeOptions = {}) =>
  typeof indexOrOptions === 'number'
    ? { index: indexOrOptions, ...maybeOptions }
    : { index: 0, ...(indexOrOptions || {}) };

export const renderCardHtml = (r, indexOrOptions = 0, maybeOptions = {}) => {
  const { index, tagRegistry = {} } = resolveCardOptions(indexOrOptions, maybeOptions);
  const imageUrl = safeUrl(r.image);
  const cardImage = imageUrl
    ? `<div class="card-image"><img src="${escapeHtml(imageUrl)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt=""></div>`
    : `<div class="card-image card-image-empty" aria-hidden="true"></div>`;
  const tagSlugs = normalizeTagSlugs(r.tags, tagRegistry);

  return `
  <div class="card" style="animation-delay:${index * 0.045}s" data-id="${escapeHtml(r.id)}">
    ${cardImage}
    <div class="card-body">
      <div class="card-banner ${cClass(r.cuisine)}"></div>
      <div class="card-meta"><span class="card-cuisine">${escapeHtml(r.cuisine || '')}</span><span class="card-stars">${stars(r.rating || 0)}</span></div>
      <div class="card-title">${escapeHtml(r.name)}</div>
      ${r.location ? `<div class="card-origin">${escapeHtml(r.location)}</div>` : ''}
      ${r.notes ? `<div class="card-notes">${escapeHtml(r.notes)}</div>` : ''}
      ${r.url ? `<div class="card-link">🔗 ${escapeHtml(r.url)}</div>` : ''}
    </div>
    <div class="card-footer">
      <div class="card-tags">${tagSlugs.map((slug, tagIndex) => {
        const label = getTagLabel(slug, tagRegistry);
        const color = resolveTagColor(tagRegistry[slug], tagIndex);
        return `<button class="tag card-tag" type="button" data-card-tag="${escapeHtml(slug)}" aria-label="Filter by tag ${escapeHtml(label)}" style="--tag-accent:${escapeHtml(color)};">${escapeHtml(label)}</button>`;
      }).join('')}</div>
      <div class="card-actions">
        <button class="icon-btn edit-btn" data-id="${escapeHtml(r.id)}">✏️</button>
        <button class="icon-btn del-btn" data-id="${escapeHtml(r.id)}">🗑️</button>
      </div>
    </div>
  </div>`;
};

export const renderGridHtml = (recipes, opts = {}) => {
  const list = filtered(recipes, opts);
  if (!list.length) {
    return `<div class="empty-state"><div class="ei">🍽️</div><p>No recipes yet — paste a link above or add one manually.</p></div>`;
  }
  return list.map((r, i) => renderCardHtml(r, { index: i, tagRegistry: opts.tagRegistry || {} })).join('');
};

export const statsFor = (recipes) => ({
  count: recipes.length,
  cuisines: new Set(recipes.map((r) => r.cuisine)).size,
  locations: new Set(recipes.map((r) => r.location).filter(Boolean)).size,
});
