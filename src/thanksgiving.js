import { safeUrl } from './recipe-lib.js';
import { renderCardHtml } from './recipe-render.js';

const menu = [
  ['Starters', [
    'foodandwine.com/recipes/alain-ducasses-gougeres',
    'skinnytaste.com/guacamole-deviled-eggs',
  ]],
  ['Mains', [
    'simplyrecipes.com/recipes/maple_glazed_chicken_with_caramelized_onions_and_pears',
    'onceuponachef.com/recipes/roast-beef-tenderloin-wine-sauce.html',
    'sallysbakingaddiction.com/biscuit-vegetable-pot-pie',
  ]],
  ['Sides & bread', [
    'jenniferrecipes.com/roasted-brussels-sprouts-delightful-butternut-squash-with-maple-walnuts-cranberries',
    'onceuponachef.com/recipes/french-string-beans-with-shallots.html',
    'onceuponachef.com/recipes/potatoes-au-gratin.html',
    'sallysbakingaddiction.com/soft-dinner-rolls',
  ]],
  ['Desserts', [
    'onceuponachef.com/recipes/rustic-french-apple-tart.html',
    'mybakingaddiction.com/sweet-potato-cheesecake',
  ]],
];

function sourceKey(recipe) {
  const source = safeUrl(recipe.url);
  if (!source) return '';
  try {
    const url = new URL(source);
    return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function hasMethod(recipe) {
  return Boolean(recipe.ingredients?.trim() && recipe.instructions?.trim());
}

export function renderThanksgivingMenu(recipes, tagRegistry) {
  const bySource = new Map();
  for (const recipe of recipes) {
    const key = sourceKey(recipe);
    if (!key) continue;
    const existing = bySource.get(key);
    if (!existing || (!hasMethod(existing) && hasMethod(recipe))) bySource.set(key, recipe);
  }

  const sections = menu.map(([heading, keys], sectionIndex) => {
    const matches = keys.map((key) => bySource.get(key)).filter(Boolean);
    if (!matches.length) return '';
    const headingId = `thanksgiving-course-${sectionIndex}`;
    const cards = matches.map((recipe, index) => renderCardHtml(recipe, { index, tagRegistry }));
    return `<section class="thanksgiving-course" aria-labelledby="${headingId}">
      <h2 id="${headingId}">${heading}</h2>
      <div class="thanksgiving-cards" role="list">${cards.join('')}</div>
    </section>`;
  }).join('');

  return sections || '<div class="empty-state"><p>No Thanksgiving recipes are currently available in this library.</p></div>';
}
