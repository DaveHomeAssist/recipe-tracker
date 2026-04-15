# Audit — Recipe Tracker

**Date:** 2026-04-15
**Auditor:** Claude Code (Opus 4.6)
**Scope:** Security, data integrity, performance, mobile, SEO, code quality, error handling, state management.
**Baseline:** commit at `main` after the Phase 1 patches.

## Method

- Read every line of `index.html`, `src/recipe-lib.js`, `src/recipe-render.js`.
- Ran `npx vitest run` + `npx playwright test` (53/53 green) against the post-refactor code.
- Adversarial fixtures in the integration suite exercise XSS, unicode, null fields, and stored XSS via localStorage.
- `node --check` on the inline module script before each commit.

## Findings

### Security — XSS

**Checked:** every `innerHTML` sink in `index.html` + both `src/` modules.

- `renderGridHtml` / `renderCardHtml`: every recipe field routed through `escapeHtml()`. ✓
- `openView` (view modal): `view-title` uses `textContent`; everything else inside `viewBody` is interpolated through `escapeHtml()`. Source link `href` validated by `safeUrl()` (only `http(s):`). ✓
- `openReview`, `openEdit`: all use `.value=` on inputs/textareas — not HTML sinks. ✓
- `statsBar.innerHTML`: interpolates numbers, not user data. ✓
- `filterBtns.innerHTML`: chip labels now escaped through `escapeHtml()` even though cuisine strings come from recipe data. ✓
- **Imported JSON:** now validated as an array or `{recipes: []}` shape, but individual recipe fields are NOT schema-validated. An imported recipe with a malicious `name` will still be safely escaped on render — XSS hardening covers it. Schema enforcement is deferred as a known gap below.

**Result:** no XSS sinks remaining. Stored-XSS test fixture in `tests/e2e/recipes.spec.js` proves live browser behaviour.

### Data integrity

| Risk | Handled? | How |
|---|---|---|
| `localStorage` full (QuotaExceededError) | ✓ | `persist()` catches, toast suggests Export. Recipes remain in memory so current session keeps working. |
| `localStorage` disabled (Safari private mode) | ✓ | Same `try/catch`; app degrades to "session-only" silently from the user's perspective, with a visible toast. |
| Corrupted JSON in `localStorage` | ✓ | `loadRecipes()` catches parse errors, logs, returns `[]` so the seed re-runs. |
| Stored data is an object, not an array | ✓ | `loadRecipes()` returns `[]` when `Array.isArray(parsed)` is false. |
| Import of newer schema version | ✓ | Blocked with a "cannot import safely" toast. |
| Import of mismatched shape | ✓ | `Array.isArray` check + toast. |
| Merge duplicates when importing | ✓ | Deduped by trimmed lowercased `url`; records with no URL all survive. |

### Performance

- Initial load ships the full 187-recipe corpus inlined in `index.html` (~381 KB raw, ~95 KB gzipped). First paint on Playwright is ~2 s from cold — acceptable for a family tool.
- `renderGrid` rebuilds the full grid string on every state change. At 187 cards this runs in <50 ms per the integration perf test. No `requestAnimationFrame` batching needed yet.
- No image fetches to worry about — the UI doesn't render recipe images even though the extractor captured them.
- `filtered` at 10 k records runs in <50 ms (integration perf test).

### Mobile viewports

**Checked:** CSS media queries at `max-width: 540px` and `max-width: 720px`, plus the toolbar/modal layout.

- Toolbar wraps correctly at 375 px — filter chips drop to their own row, Add Recipe button stays prominent.
- Modal `max-width: 600px` with `max-height: 92vh; overflow-y: auto` handles narrow screens.
- `.form-row` collapses to a single column at 540 px.
- Touch targets: Add Recipe button is `padding:12px 24px` (44px tall ✓). Icon buttons (edit/delete) are still 16-ish px — flagged as a gap below.
- Skip link appears at `top: 8px` only on focus, doesn't interfere with layout.

### SEO

**Before:** only `<title>` and `<meta charset>`.
**After:** `<title>`, description, theme-color, canonical, favicon (SVG), OG 5-tuple, Twitter Card, JSON-LD `WebApplication`, `lang="en"` on `<html>`. One H1.

### Code quality

- `index.html` inline module script is ~400 lines after the refactor. Still well under a split-into-files threshold.
- `src/` modules are small (~60 lines each), single-purpose.
- Magic string `'recipe_journal_v3'` now has a named constant `KEY` and a named `SCHEMA_VERSION`.
- Some dead markup remains — the `progressModal` and `reviewModal` wrappers are still in the HTML even though nothing opens them (they were used by the removed Anthropic extractor). Left in to minimize diff; flagged as low-priority cleanup.
- A11y post-pass `IIFE` at the end of the inline script could be moved into a module but the cost/benefit isn't worth another split right now.

### Error handling

- `JSON.parse` in `loadRecipes`: ✓ wrapped.
- `JSON.parse` in `importRecipes`: ✓ wrapped, message surfaced.
- `localStorage.setItem` in `persist`: ✓ wrapped, user-visible toast.
- `URL.createObjectURL` in export: happy path only; failure is unlikely (only in exotic browsers).

### State management

- Single source of truth: the `recipes` array in the inline module. `currentFilter`, `currentSearch`, `editingId`, `viewingId`, `lastFocusedBeforeModal` are the ancillary state pieces. All serialize cleanly — only `recipes` is persisted.
- No global pollution (module scope).

## Known gaps (deliberately not fixed in this pass)

1. **Imported recipes are not field-level schema-validated.** XSS is handled at render time, but a malicious or malformed JSON could still set unexpected fields. Low risk for a family tool; worth adding a simple whitelist-shape validator before accepting anonymous imports.
2. **Touch targets on card icon buttons (edit/delete) are ~16 px.** Below the 44 px guideline. Would need a card redesign to enlarge without breaking the layout.
3. **No visual regression tests.** The palette could break silently. Consider adding a Playwright screenshot baseline if the look becomes load-bearing.
4. **Focus trap does not handle programmatically opened modals in an order other than the visible DOM.** Good enough for the current 3 modals (add/edit, view, dead review).
5. **Dead `progressModal` and `reviewModal` markup** remains in `index.html`. Safe to delete in a cleanup pass.
6. **`image` field from JSON-LD extraction is unused** in the card grid. `build/public/recipes.json` already carries hero images; adding them to cards is a future enhancement, not a bug.
7. **No service worker / offline cache.** The page works offline once loaded (everything is inlined) but there's no install prompt or icon.
8. **Mobile screenshot sweep is manual.** Tests cover desktop viewport only.

## Summary

- Phase 1 patches from the agent prompt are complete, with one documented deviation (the 187-recipe seed is preserved as real data, not sample content).
- Phase 2 audit: 8 categories checked, 8 gaps documented (above) rather than silently skipped.
- Tests still 53/53 green after the refactor.
- No new dependencies. Still vanilla HTML/CSS/JS on GitHub Pages.
