import { parseIngredients } from './ingredient-parser.js';
import { formatQty } from './unit-normalize.js';

const LIST_KEY = 'recipe_kitchen_notion_trip_url';
const GOUGERES_PATH = '/recipes/alain-ducasses-gougeres';

function isDucasseGougeres(recipe) {
  try {
    const url = new URL(recipe.url);
    return ['foodandwine.com', 'www.foodandwine.com'].includes(url.hostname) &&
      url.pathname.replace(/\/$/, '') === GOUGERES_PATH;
  } catch {
    return /^alain ducasse['’]s goug[eè]res(?: recipe)?$/i.test(recipe.name?.trim() || '');
  }
}

function notionTripUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['www.notion.so', 'notion.so', 'app.notion.com'].includes(url.hostname) &&
      url.pathname !== '/' ? url.href : '';
  } catch {
    return '';
  }
}

function savedTripUrl() {
  try {
    return notionTripUrl(localStorage.getItem(LIST_KEY));
  } catch {
    return '';
  }
}

function addHeading(parent, level, title) {
  const heading = document.createElement(level);
  heading.textContent = title;
  parent.append(heading);
}

function isReviewable(ingredient) {
  return Number.isFinite(ingredient.qty) && ingredient.qty > 0 && ingredient.item &&
    !/\b(?:to taste|plus more|as needed)\b|\d\s*(?:[-–]|to)\s*\d/i.test(ingredient.raw);
}

function readQuantity(field) {
  return field.value === '' ? 0 : field.valueAsNumber;
}

function ingredientRow(ingredient, id, scaled) {
  const row = document.createElement('fieldset');
  row.className = 'menu-ingredient';
  addHeading(row, 'legend', ingredient.raw);

  const choice = document.createElement('select');
  choice.setAttribute('aria-label', `Shopping decision for ${ingredient.raw}`);
  for (const [value, label] of [
    ['review', 'Review'],
    ['buy', 'Buy'],
    ['skip', 'Have enough or skip'],
    ...(scaled !== null ? [['garden', 'Use some from the garden']] : []),
  ]) choice.add(new Option(label, value));
  row.append(choice);

  const details = document.createElement('label');
  const amount = document.createElement('input');
  amount.id = id;
  const unit = ingredient.unit || 'count';
  if (scaled === null) {
    details.append('Reviewed shopping line (item and amount)');
    amount.type = 'text';
    amount.maxLength = 100;
  } else {
    details.append(`Confirmed garden amount (${unit})`);
    amount.type = 'number';
    amount.min = '0';
    amount.max = String(scaled);
    amount.step = 'any';
    const required = document.createElement('span');
    required.className = 'muted';
    required.textContent = `Recipe needs ${formatQty(scaled)} ${unit}`;
    row.append(required);
  }
  details.append(amount);
  details.hidden = true;
  row.append(details);
  const syncDetails = () => {
    details.hidden = choice.value !== (scaled === null ? 'buy' : 'garden');
    amount.disabled = details.hidden;
  };
  choice.addEventListener('change', syncDetails);
  syncDetails();

  return {
    row,
    result() {
      if (choice.value === 'review') return { pending: true };
      if (choice.value === 'skip') return {};
      if (scaled === null) {
        const reviewed = amount.value.trim();
        return reviewed ? { line: reviewed } : { pending: true };
      }
      const available = choice.value === 'garden' ? readQuantity(amount) : 0;
      if (!Number.isFinite(available) || available < 0 || available > scaled) return { pending: true };
      const needed = scaled - available;
      const unitText = ingredient.unit ? ` ${ingredient.unit}` : '';
      if (needed <= 1e-9) return {};
      const rounded = formatQty(needed);
      if (!rounded || Number(rounded) === 0) return { pending: true };
      return { line: `${rounded}${unitText} ${ingredient.item}` };
    },
  };
}

export function initMenuPreview({ recipes, openRecipePicker }) {
  const start = document.getElementById('review-menu-groceries');
  const message = document.getElementById('menu-message');
  const panel = document.getElementById('menu-grocery-review');

  function showRecipe(recipe) {
    const ingredients = parseIngredients(recipe.ingredients);
    if (!ingredients.length) {
      message.textContent = 'That recipe has no ingredients to review.';
      panel.hidden = true;
      return;
    }
    message.textContent = '';
    panel.hidden = false;
    panel.innerHTML = `
      <h2 id="menu-preview-heading" tabindex="-1">Review groceries</h2>
      <p id="menu-preview-recipe"></p>
      <form id="menu-batches">
        <label>Recipe batches
          <input type="number" name="batches" min="1" max="12" step="1" value="1" required>
        </label>
        <button type="submit" class="btn ghost">Set batches</button>
      </form>
      <p class="muted">Set batches first. Review each ingredient and enter confirmed garden amounts in the unit shown. Changing batches starts a fresh review.</p>
      <div id="menu-ingredients"></div>
      <p id="menu-review-status" role="status"></p>
      <label>Grocery handoff
        <textarea id="menu-grocery-output" rows="5" readonly></textarea>
      </label>
      <div class="btn-row">
        <button type="button" class="btn" id="copy-menu-groceries" disabled>Copy grocery list</button>
        <a class="btn ghost" id="open-menu-trip" hidden target="_blank" rel="noopener noreferrer">Open Lisa’s list</a>
      </div>
      <form id="menu-trip-setup">
        <label>Lisa’s Notion trip link
          <input name="trip" type="url" placeholder="Paste the This trip link">
        </label>
        <button type="submit" class="btn ghost">Set link</button>
        <p class="muted" id="menu-trip-message" role="status">Saved on this device. Add reviewed items in Notion.</p>
      </form>`;
    panel.querySelector('#menu-preview-recipe').textContent =
      `${recipe.name || 'Selected recipe'} · Saved yield: ${recipe.servings || 'not specified'}`;

    const form = panel.querySelector('#menu-batches');
    const fields = panel.querySelector('#menu-ingredients');
    const status = panel.querySelector('#menu-review-status');
    const output = panel.querySelector('#menu-grocery-output');
    const copy = panel.querySelector('#copy-menu-groceries');
    const trip = panel.querySelector('#open-menu-trip');
    const tripForm = panel.querySelector('#menu-trip-setup');
    const tripMessage = panel.querySelector('#menu-trip-message');
    const tripField = tripForm.elements.trip;

    function setTrip(url) {
      trip.hidden = !url;
      if (url) trip.href = url;
      else trip.removeAttribute('href');
      tripField.value = url;
    }
    setTrip(savedTripUrl());
    tripForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const url = notionTripUrl(tripField.value.trim());
      if (tripField.value.trim() && !url) {
        tripMessage.textContent = 'Use a secure Notion page or database view link.';
        return;
      }
      setTrip(url);
      try {
        if (url) localStorage.setItem(LIST_KEY, url);
        else localStorage.removeItem(LIST_KEY);
        tripMessage.textContent = url ? 'Trip link saved on this device.' : 'Trip link removed.';
      } catch {
        tripMessage.textContent = 'The link is available for this session.';
      }
    });

    let rows;
    function refresh() {
      const results = rows.map(({ result }) => result());
      const pending = results.filter((entry) => entry.pending).length;
      const lines = results.flatMap((entry) => entry.line ? [entry.line] : []);
      output.value = lines.join('\n');
      copy.disabled = pending > 0 || !lines.length;
      status.textContent = pending ? `${pending} ingredient${pending === 1 ? '' : 's'} still need review.`
        : lines.length ? `${lines.length} reviewed shopping line${lines.length === 1 ? '' : 's'}.` : 'No groceries to buy.';
    }
    function buildRows() {
      const batches = form.elements.batches.valueAsNumber;
      rows = ingredients.map((ingredient, index) =>
        ingredientRow(ingredient, `menu-amount-${index}`,
          isReviewable(ingredient) ? ingredient.qty * batches : null));
      fields.replaceChildren(...rows.map(({ row }) => row));
      refresh();
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      buildRows();
    });
    fields.addEventListener('input', refresh);
    fields.addEventListener('change', refresh);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(output.value);
        status.textContent = 'Grocery list copied.';
      } catch {
        output.focus();
        output.select();
        status.textContent = 'Grocery list selected. Copy it with your device’s copy command.';
      }
    });

    buildRows();
    panel.querySelector('h2').focus();
  }

  start.addEventListener('click', () => {
    const matches = recipes.filter(isDucasseGougeres);
    if (matches.length === 1) showRecipe(matches[0]);
    else openRecipePicker(showRecipe);
  });
}
