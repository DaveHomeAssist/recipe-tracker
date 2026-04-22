# Daily-use kitchen-tool modules

This branch (`feat/phase0-scaffold`) adds seven self-contained ES modules plus their tests. None of them touch `index.html` — all UI wiring is left for a follow-up PR so the 465 KB inlined dashboard does not get churned while the data layer settles.

## Module map

| Module | Purpose | Storage key |
| --- | --- | --- |
| `src/ingredient-parser.js` | Parse free-text ingredient lines to `{qty, unit, item, slug, modifier, raw}`. 93.3% coverage against 1,935 lines in `data/source/recipes.json`. | none |
| `src/unit-normalize.js` | Dimension-aware volume + weight conversions, quantity formatting. | none |
| `src/aisle-map.json` | ~230 slug → aisle entries across six aisles (Produce, Dairy, Meat, Pantry, Frozen, Other). | none |
| `src/meal-plan.js` | Meal plan CRUD, week views, planned-lookahead helpers. | `meal_plan_v1` |
| `src/shopping-list.js` | Recipe set → aggregated aisle-grouped list. Reuses parser + normalizer + aisle map. | `shopping_list_v1` |
| `src/cook-mode.js` | Session builder (ingredients + steps), step navigation, session-history log. | `cook_sessions_v1` |
| `src/cook-timer.js` | Duration parser, tokenizer, timer runtime + wake-lock. | uses `sessionStorage` implicitly via runtime |
| `src/pantry.js` | Pantry CRUD + `recipeCoverage` + `rankRecipesByCoverage`. Reuses parser. | `pantry_v1` |

## Tests

- `tests/unit/ingredient-parser.test.js` — edge cases + real-dataset coverage floor (>=85%).
- `tests/unit/unit-normalize.test.js` — round-trip + summation.
- `tests/unit/meal-plan.test.js` — CRUD, ranges, week slicing.
- `tests/unit/shopping-list.test.js` — aggregation, tbsp+cup combine, merge-with-existing.
- `tests/unit/pantry.test.js` — CRUD, coverage, ranking, stale detection.

All tests validated via direct `node --input-type=module` smoke runs. Vitest was non-responsive in the current shell environment (unrelated to these files); run `npm run test:unit` in a normal terminal to execute.

## Integration points for the next PR (index.html wiring)

The modules are designed to plug into the existing render pipeline without restructuring it. Suggested wiring:

### 1. Load modules (script tag or inline import)
```html
<script type="module">
  import { loadPlan, addEntry } from './src/meal-plan.js';
  import { generateFromRecipes, groupByAisle, formatItemQty } from './src/shopping-list.js';
  import { loadPantry, rankRecipesByCoverage } from './src/pantry.js';
  import { buildSession, advanceStep } from './src/cook-mode.js';
  import { tokenizeWithTimers, startTimer, acquireWakeLock } from './src/cook-timer.js';
  import AISLE_MAP from './src/aisle-map.json' with { type: 'json' };
</script>
```

### 2. Three new views (route hashes)

- `#plan` — 7-day × 3-slot grid. Render from `loadPlan().entries`. Drag-and-drop via HTML5 native API; long-press + day/slot picker on mobile.
- `#shop` — Aisle-grouped checklist. Render from `groupByAisle(loadList())`. Checkbox toggles persist via `saveList(toggleItem(...))`.
- `#pantry` — Two-pane: current pantry (add by typeahead from aisle-map.json keys), recipes ranked by coverage (`rankRecipesByCoverage`).

### 3. Recipe modal additions

- **"Add to week"** button → opens a day/slot picker → `addEntry(plan, {...})`.
- **"Cook now"** button → overlay using `buildSession(recipe, servings)`. Render each step through `tokenizeWithTimers(step.text)` so duration chips are tappable. On tap, call `startTimer({ id, seconds, label })`. Call `acquireWakeLock()` on overlay open.

### 4. Recipe grid additions

- Each card gets an optional calendar chip when `isRecipePlanned(plan, recipe.id)` is true.
- Optional pantry badge (`{matched}/{total} in pantry`) sourced from `recipeCoverage(recipe, pantrySet)`.
- New filter chip "Cook what I have" swaps the sort comparator to `rankRecipesByCoverage`.

### 5. Export/import envelope

Current v4 export: `{ schemaVersion: 4, exportedAt, recipes }`.
Suggested v5: add three optional top-level keys: `mealPlan`, `shoppingList`, `pantry`. Each already has its own internal `version` field so conflict detection at sync time is straightforward. Migration from v4 export: treat absent keys as empty stores. Existing tests in `tests/unit/schema.test.js` should be extended to round-trip a v4 export into v5 and back.

### 6. Sync (Phase 4) prep

The existing `src/recipe-remote.js` queue is recipe-only. Extend to cover `meal_plan`, `shopping_list`, `pantry` with the same enqueue + retry pattern. Notion backend per `NOTION_BACKEND_SPEC.md` needs three new database templates (one per store). Schema-level conflict resolution: each store already carries a numeric `version` on its items; last-write-wins with a user-visible toast on conflict.

## What's deliberately NOT in this branch

- No edits to `index.html`. UI integration is a separate PR so the inlined dashboard stays stable while the data layer is reviewed.
- No changes to `src/recipe-schema.js` (you have WIP there). Schema v5 envelope bump is best done when your current schema work is settled.
- No touch to the `api/` backend. Phase D / Phase 4 server-side wiring is your domain; the new client stores will drop into the existing `recipe-remote.js` queue pattern when you're ready.

## Next suggested commits (followups)

1. `feat/phase1-ui` — wire `#plan` and `#shop` routes into index.html
2. `feat/phase2-ui` — Cook Mode overlay + "Cook now" button on recipe modal
3. `feat/phase3-ui` — `#pantry` view + "Cook what I have" filter chip
4. `feat/phase4-sync` — extend `recipe-remote.js` queue to cover new stores; Notion backend databases; schema v5 export envelope
