// Pure render helpers. No DOM mutations, no state — every function takes
// its inputs explicitly and returns strings or arrays. Safe to import from
// tests and from the main page.

import { escapeHtml, safeUrl } from './recipe-lib.js';

export const stars = (n) =>
  Array.from({ length: 5 }, (_, i) => `<span style="opacity:${i < n ? 1 : 0.18}">★</span>`).join('');

const cClass = (c) =>
  'cuisine-' + String(c || 'other').toLowerCase().replace(/[\s/]+/g, '-');

export const filtered = (recipes, { filter = 'all', search = '' } = {}) => {
  const q = String(search || '').toLowerCase();
  return recipes.filter((r) => {
    const mf = filter === 'all' || r.cuisine === filter;
    const ms =
      !q ||
      [r.name, r.location, r.source, r.notes, r.tags, r.ingredients].some((f) =>
        (f || '').toLowerCase().includes(q)
      );
    return mf && ms;
  });
};

export const renderCardHtml = (r, i = 0) => {
  const imageUrl = safeUrl(r.image);
  const cardImage = imageUrl
    ? `<div class="card-image"><img src="${escapeHtml(imageUrl)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt=""></div>`
    : `<div class="card-image card-image-empty" aria-hidden="true"></div>`;

  return `
  <div class="card" style="animation-delay:${i * 0.045}s" data-id="${escapeHtml(r.id)}">
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
      <div class="card-tags">${(r.tags || '').split(',').filter(Boolean).slice(0, 3).map((t) => `<span class="tag">${escapeHtml(t.trim())}</span>`).join('')}</div>
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
  return list.map((r, i) => renderCardHtml(r, i)).join('');
};

export const statsFor = (recipes) => ({
  count: recipes.length,
  cuisines: new Set(recipes.map((r) => r.cuisine)).size,
  locations: new Set(recipes.map((r) => r.location).filter(Boolean)).size,
});
