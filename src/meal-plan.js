// Meal plan state. localStorage-backed CRUD matching recipe-prefs.js style.
// Pure data layer; no DOM. UI lives in a separate file (meal-plan-render.js).
//
// Storage key: meal_plan_v1
// Shape: { version: 1, entries: [ { id, date (YYYY-MM-DD), slot, recipeId, servings, notes, createdAt } ] }
//   - slot: 'b' | 'l' | 'd' (breakfast / lunch / dinner)
//   - id: stable uuid-ish; generated at add time
//   - servings: integer >= 1; nullable falls through to recipe.servings
//   - notes: short user text per planned meal

const KEY = 'meal_plan_v1';
const VERSION = 1;
const SLOT_RE = /^[bld]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const newId = () => `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function makeEmpty() {
  return { version: VERSION, entries: [] };
}

function readRaw(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return makeEmpty();
  try {
    const raw = store.getItem(KEY);
    if (!raw) return makeEmpty();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return makeEmpty();
    return { version: parsed.version || VERSION, entries: parsed.entries };
  } catch {
    return makeEmpty();
  }
}

function writeRaw(state, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(state));
  } catch {
    // Quota or serialization failure: best-effort, silently ignore.
  }
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = typeof raw.date === 'string' && DATE_RE.test(raw.date) ? raw.date : null;
  if (!date) return null;
  const slot = typeof raw.slot === 'string' && SLOT_RE.test(raw.slot) ? raw.slot : null;
  if (!slot) return null;
  const recipeId = raw.recipeId == null ? '' : String(raw.recipeId);
  if (!recipeId) return null;
  const servings = Number.isFinite(Number(raw.servings)) && Number(raw.servings) > 0
    ? Math.floor(Number(raw.servings))
    : null;
  const notes = typeof raw.notes === 'string' ? raw.notes.slice(0, 500) : '';
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newId();
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
  return { id, date, slot, recipeId, servings, notes, createdAt };
}

// -------- Public API --------

export function loadPlan(storage) {
  const raw = readRaw(storage);
  const entries = raw.entries.map(normalizeEntry).filter(Boolean);
  return { version: VERSION, entries };
}

export function savePlan(plan, storage) {
  const cleaned = {
    version: VERSION,
    entries: (plan.entries || []).map(normalizeEntry).filter(Boolean),
  };
  writeRaw(cleaned, storage);
  return cleaned;
}

export function addEntry(plan, { date, slot, recipeId, servings = null, notes = '' }) {
  const entry = normalizeEntry({ date, slot, recipeId, servings, notes });
  if (!entry) return plan;
  return { ...plan, entries: [...plan.entries, entry] };
}

export function removeEntry(plan, id) {
  return { ...plan, entries: plan.entries.filter((e) => e.id !== id) };
}

export function updateEntry(plan, id, patch) {
  return {
    ...plan,
    entries: plan.entries.map((e) => {
      if (e.id !== id) return e;
      const merged = normalizeEntry({ ...e, ...patch, id: e.id, createdAt: e.createdAt });
      return merged || e;
    }),
  };
}

// Return entries for a given ISO date range (inclusive), sorted by date+slot.
const SLOT_ORDER = { b: 0, l: 1, d: 2 };
export function entriesInRange(plan, startDate, endDate) {
  return plan.entries
    .filter((e) => e.date >= startDate && e.date <= endDate)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
    });
}

// Entries for a specific date + slot (0 or 1 typically).
export function entriesFor(plan, date, slot) {
  return plan.entries.filter((e) => e.date === date && e.slot === slot);
}

// Convenience: current week (Mon-Sun) entries.
// today defaults to the runtime "today" but can be injected for testing.
export function thisWeek(plan, today = new Date()) {
  const t = new Date(today);
  const day = t.getDay() || 7; // Mon=1..Sun=7
  const monday = new Date(t);
  monday.setDate(t.getDate() - (day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  return entriesInRange(plan, iso(monday), iso(sunday));
}

// Recipes planned on today (any slot).
export function plannedToday(plan, today = new Date()) {
  const iso = today.toISOString().slice(0, 10);
  return plan.entries.filter((e) => e.date === iso);
}

// Is a given recipe planned anywhere in the next N days?
export function isRecipePlanned(plan, recipeId, daysAhead = 14) {
  const start = new Date();
  const end = new Date();
  end.setDate(start.getDate() + daysAhead);
  const iso = (d) => d.toISOString().slice(0, 10);
  return plan.entries.some((e) => e.recipeId === String(recipeId) && e.date >= iso(start) && e.date <= iso(end));
}
