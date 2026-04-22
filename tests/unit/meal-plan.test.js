import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPlan,
  savePlan,
  addEntry,
  removeEntry,
  updateEntry,
  entriesInRange,
  entriesFor,
  thisWeek,
  plannedToday,
  isRecipePlanned,
} from '../../src/meal-plan.js';

function makeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
    _raw: () => Object.fromEntries(data),
  };
}

describe('meal-plan', () => {
  let storage;
  beforeEach(() => {
    storage = makeStorage();
  });

  it('starts empty', () => {
    const p = loadPlan(storage);
    expect(p.entries).toEqual([]);
    expect(p.version).toBe(1);
  });

  it('addEntry + savePlan + loadPlan round-trip', () => {
    let plan = loadPlan(storage);
    plan = addEntry(plan, { date: '2026-04-27', slot: 'd', recipeId: 'r1', servings: 4 });
    savePlan(plan, storage);
    const reloaded = loadPlan(storage);
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0].recipeId).toBe('r1');
    expect(reloaded.entries[0].slot).toBe('d');
    expect(reloaded.entries[0].servings).toBe(4);
    expect(reloaded.entries[0].id).toMatch(/^mp_/);
  });

  it('rejects invalid date', () => {
    let plan = loadPlan(storage);
    plan = addEntry(plan, { date: 'not-a-date', slot: 'd', recipeId: 'r1' });
    expect(plan.entries).toHaveLength(0);
  });

  it('rejects invalid slot', () => {
    let plan = loadPlan(storage);
    plan = addEntry(plan, { date: '2026-04-27', slot: 'x', recipeId: 'r1' });
    expect(plan.entries).toHaveLength(0);
  });

  it('rejects missing recipeId', () => {
    let plan = loadPlan(storage);
    plan = addEntry(plan, { date: '2026-04-27', slot: 'd' });
    expect(plan.entries).toHaveLength(0);
  });

  it('removeEntry removes by id', () => {
    let plan = loadPlan(storage);
    plan = addEntry(plan, { date: '2026-04-27', slot: 'd', recipeId: 'r1' });
    plan = addEntry(plan, { date: '2026-04-27', slot: 'l', recipeId: 'r2' });
    expect(plan.entries).toHaveLength(2);
    const id = plan.entries[0].id;
    plan = removeEntry(plan, id);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].recipeId).toBe('r2');
  });

  it('updateEntry updates fields', () => {
    let plan = loadPlan(storage);
    plan = addEntry(plan, { date: '2026-04-27', slot: 'd', recipeId: 'r1', servings: 4 });
    const id = plan.entries[0].id;
    plan = updateEntry(plan, id, { servings: 6, notes: 'double' });
    expect(plan.entries[0].servings).toBe(6);
    expect(plan.entries[0].notes).toBe('double');
    expect(plan.entries[0].recipeId).toBe('r1'); // preserved
  });

  it('entriesInRange filters and sorts', () => {
    let plan = loadPlan(storage);
    plan = addEntry(plan, { date: '2026-04-29', slot: 'l', recipeId: 'r3' });
    plan = addEntry(plan, { date: '2026-04-27', slot: 'd', recipeId: 'r1' });
    plan = addEntry(plan, { date: '2026-04-27', slot: 'b', recipeId: 'r2' });
    plan = addEntry(plan, { date: '2026-05-02', slot: 'd', recipeId: 'r4' }); // outside
    const res = entriesInRange(plan, '2026-04-27', '2026-04-30');
    expect(res).toHaveLength(3);
    expect(res[0].slot).toBe('b'); // same date, earlier slot first
    expect(res[1].slot).toBe('d');
    expect(res[2].slot).toBe('l'); // next date
  });

  it('entriesFor returns exact-match only', () => {
    let plan = loadPlan(storage);
    plan = addEntry(plan, { date: '2026-04-27', slot: 'd', recipeId: 'r1' });
    plan = addEntry(plan, { date: '2026-04-27', slot: 'l', recipeId: 'r2' });
    const res = entriesFor(plan, '2026-04-27', 'd');
    expect(res).toHaveLength(1);
    expect(res[0].recipeId).toBe('r1');
  });

  it('thisWeek returns Mon-Sun entries', () => {
    let plan = loadPlan(storage);
    // Test with Wednesday 2026-04-29 as "today"; week = 2026-04-27 to 2026-05-03
    plan = addEntry(plan, { date: '2026-04-27', slot: 'd', recipeId: 'a' });
    plan = addEntry(plan, { date: '2026-05-03', slot: 'l', recipeId: 'b' });
    plan = addEntry(plan, { date: '2026-05-04', slot: 'd', recipeId: 'c' }); // next week
    const today = new Date('2026-04-29T12:00:00Z');
    const res = thisWeek(plan, today);
    expect(res.map((e) => e.recipeId)).toEqual(['a', 'b']);
  });

  it('isRecipePlanned lookahead', () => {
    let plan = loadPlan(storage);
    const t = new Date();
    const iso = new Date(t.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    plan = addEntry(plan, { date: iso, slot: 'd', recipeId: 'r42' });
    expect(isRecipePlanned(plan, 'r42')).toBe(true);
    expect(isRecipePlanned(plan, 'r99')).toBe(false);
  });
});
