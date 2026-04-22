// Cook Mode state. Pure data layer (no DOM). Orchestrates a single cooking
// session: step navigation, status tracking, session log to localStorage.

import { parseIngredients } from './ingredient-parser.js';
import { scaleQty, formatQty } from './unit-normalize.js';
import { parseDurations } from './cook-timer.js';

const SESSION_KEY = 'cook_sessions_v1';

// Split instructions blob into ordered steps.
// Supports: "1. step", "2) step", newline-separated, "Step 1:" etc.
// Empty lines are separators.
export function parseSteps(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const steps = [];
  let current = '';
  const flush = () => {
    const clean = current.trim();
    if (clean) steps.push(clean);
    current = '';
  };
  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    // Strip leading "1." / "1)" / "Step 1:" / "1:"
    const stripped = line.replace(/^(?:step\s+)?\d+[.):]\s*/i, '').trim();
    if (stripped) {
      if (current) current += ' ';
      current += stripped;
    }
    // Treat a line ending with "." as a step boundary to avoid mega-paragraphs.
    if (/[.!?]$/.test(line)) flush();
  }
  flush();
  return steps;
}

// Build a cook-session snapshot: ingredient checklist (scaled) + parsed steps.
// Inputs:
//   recipe: { id, name, ingredients, instructions, servings }
//   cookingServings: integer >= 1 (user-chosen target servings)
export function buildSession(recipe, cookingServings = null) {
  if (!recipe) return null;
  const originalServings = Number(recipe.servings) > 0 ? Number(recipe.servings) : null;
  const target = Number(cookingServings) > 0 ? Number(cookingServings) : originalServings;
  const factor = originalServings && target ? target / originalServings : 1;

  const ingredientParts = parseIngredients(recipe.ingredients || '');
  const ingredients = ingredientParts.map((p, i) => ({
    idx: i,
    raw: p.raw,
    slug: p.slug,
    display: renderIngredient(p, factor),
    checked: false,
  }));

  const stepTexts = parseSteps(recipe.instructions || '');
  const steps = stepTexts.map((text, i) => ({
    idx: i,
    text,
    durations: parseDurations(text),
    status: 'pending', // 'pending' | 'active' | 'done'
  }));

  return {
    recipeId: recipe.id != null ? String(recipe.id) : '',
    recipeName: recipe.name || '',
    originalServings,
    targetServings: target,
    factor,
    ingredients,
    steps,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    notes: '',
  };
}

function renderIngredient(part, factor) {
  const qty = scaleQty(part.qty, factor);
  const qtyStr = qty != null ? formatQty(qty) : '';
  const unit = part.unit || '';
  const item = part.item || part.slug || part.raw;
  const mod = part.modifier ? `, ${part.modifier}` : '';
  const left = [qtyStr, unit].filter(Boolean).join(' ');
  return left ? `${left} ${item}${mod}`.trim() : `${item}${mod}`.trim();
}

// ---- Step navigation ----

export function advanceStep(session) {
  if (!session || !session.steps.length) return session;
  const next = session.steps.map((s) => ({ ...s }));
  let activeIdx = next.findIndex((s) => s.status === 'active');
  if (activeIdx === -1) {
    // Nothing active; activate the first pending.
    const firstPending = next.findIndex((s) => s.status === 'pending');
    if (firstPending !== -1) next[firstPending].status = 'active';
    return { ...session, steps: next };
  }
  // Mark current done, activate the next pending.
  next[activeIdx].status = 'done';
  const upcoming = next.findIndex((s, i) => i > activeIdx && s.status === 'pending');
  if (upcoming !== -1) next[upcoming].status = 'active';
  return { ...session, steps: next };
}

export function activateStep(session, idx) {
  if (!session) return session;
  const next = session.steps.map((s, i) => ({
    ...s,
    status: i === idx ? 'active' : (s.status === 'active' ? 'pending' : s.status),
  }));
  return { ...session, steps: next };
}

export function markStepDone(session, idx) {
  if (!session) return session;
  const next = session.steps.map((s, i) => ({
    ...s,
    status: i === idx ? 'done' : s.status,
  }));
  return { ...session, steps: next };
}

export function toggleIngredient(session, idx) {
  if (!session) return session;
  const next = session.ingredients.map((i) => (i.idx === idx ? { ...i, checked: !i.checked } : i));
  return { ...session, ingredients: next };
}

export function finishSession(session) {
  if (!session) return session;
  return { ...session, finishedAt: new Date().toISOString() };
}

export function isSessionComplete(session) {
  if (!session || !session.steps.length) return false;
  return session.steps.every((s) => s.status === 'done');
}

// ---- Session log (persistent, local) ----

export function logSession(session, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || !session || !session.recipeId) return;
  try {
    const raw = store.getItem(SESSION_KEY);
    const log = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(log)) return;
    const record = {
      recipeId: session.recipeId,
      recipeName: session.recipeName,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      stepsCompleted: session.steps.filter((s) => s.status === 'done').length,
      totalSteps: session.steps.length,
      notesAdded: session.notes.length > 0,
    };
    log.push(record);
    // Cap at 500 sessions.
    const capped = log.length > 500 ? log.slice(log.length - 500) : log;
    store.setItem(SESSION_KEY, JSON.stringify(capped));
  } catch {
    // silent
  }
}

export function loadSessionHistory(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return [];
  try {
    const raw = store.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
