# Recipe Tracker — Test Report

**Generated:** 2026-04-15
**Scope:** Security-hardened helpers, render pipeline, and end-to-end user flows for the static Recipe Journal site.
**Result:** 53 / 53 passing (100%)

## Suite overview

| Layer | Runner | Environment | Tests | Pass | Fail | Duration |
|---|---|---|---|---|---|---|
| Unit | Vitest 2.1.9 | jsdom 25 | 25 | 25 | 0 | 67 ms |
| Integration | Vitest 2.1.9 | jsdom 25 | 21 | 21 | 0 | 164 ms |
| E2E | Playwright 1.49 | Chromium 131 (headless) | 7 | 7 | 0 | 22.3 s |
| **Total** | | | **53** | **53** | **0** | |

Unit + integration ran in a single Vitest invocation (`npx vitest run`). E2E ran against a local static server (`python3 -m http.server 8787`) booted automatically by `playwright.config.js`. To re-run against the live Pages URL set `PW_BASE_URL=https://davehomeassist.github.io/recipe-tracker` in the environment.

## Code under test

The helpers are published as ES modules so tests import the *same* code the browser executes — no duplication, no drift.

- `src/recipe-lib.js` — `escapeHtml`, `safeUrl`, `dedupeByUrl`
- `src/recipe-render.js` — `filtered`, `renderCardHtml`, `renderGridHtml`, `statsFor`, `stars`
- `index.html` — imports both modules; the inline `<script type="module">` is now a thin wrapper over state + event wiring

## Unit — tests/unit/lib.test.js

25 tests covering `escapeHtml`, `safeUrl`, and `dedupeByUrl`.

### escapeHtml (8 tests)
- Escapes all five reserved HTML characters (`& < > " '`)
- Passes plain text through unchanged
- Neutralizes an `<img src=x onerror=alert(1)>` payload so no tag survives (regex assertion, not substring — the literal string `onerror=` is permitted inside escaped text because it cannot start an element without an unescaped `<`)
- Coerces `null` / `undefined` to empty string
- Coerces numbers and booleans to their string form
- Handles already-escaped entities without breaking (`&amp;` → `&amp;amp;`)
- Survives unicode and emoji (`café 🍳`)
- Handles empty string

### safeUrl (11 tests)
- Accepts `http://` and `https://` (case-insensitive scheme)
- Trims surrounding whitespace before validating
- Rejects `javascript:`, `JavaScript:`, leading-space `javascript:`
- Rejects `data:`, `vbscript:`, `file:`
- Rejects protocol-relative `//host/path`
- Rejects relative paths (`/recipes/1`, `recipes/1`)
- Rejects empty string, `null`, `undefined`, whitespace-only

### dedupeByUrl (6 tests)
- Collapses duplicate URLs, first occurrence wins
- Case-insensitive URL equality, whitespace-trimmed
- Records with no URL are all preserved (no false merges)
- Identity on empty array
- Mix of URL and no-URL entries behaves correctly
- **Performance:** dedupes 10,000 records (50% duplicates) in well under 100 ms

## Integration — tests/integration/render.test.js

21 tests in a jsdom environment. Imports `renderGridHtml`, `filtered`, and `statsFor` directly so a passing test *proves* the production render path is safe.

### XSS safety (4 tests)
- An `<img src=x onerror=alert(1)>` in the `name` field produces zero `<img` tokens in the output — only `&lt;img src=x onerror=alert(1)&gt;`
- A `<script>alert(2)</script>` payload in `notes` is escaped; no script tag survives
- When the resulting HTML is injected into a real jsdom DOM with an `alert` spy installed, the payload creates **zero `<img>` elements**, fires **zero alerts**, and any `" onmouseover="` attribute-injection attempt lands inside a text node
- Adversarial content inside the recipe `id` cannot break out of the `data-id="…"` attribute (escaped `&quot;` guards the boundary)

### Filter + search combinations (10 tests)
- `filter=all, search=''` returns all recipes
- Cuisine filter narrows correctly (`Italian` → 1 of 4)
- Search matches across name, ingredients, tags, location, notes
- Filter AND search combine (e.g. `French` + `duck` → exactly the Duck Confit)
- Contradictory combinations return empty
- Search is case-insensitive (`PASTA`, `Pasta`, `pasta` all equivalent)
- Search tolerates `null`/`undefined` fields without throwing
- **Performance:** filters 10,000 recipes in under 50 ms

### localStorage round-trip (4 tests)
- Full recipe shape saves and reloads without data loss
- Unicode, emoji, line breaks, and embedded quotes all survive a round-trip
- Empty / malformed storage safely yields `[]`
- Round-trip then render of an adversarial payload: the stored XSS attempt remains escaped in the output HTML

Note: Vitest's jsdom environment ships a partially-stubbed `localStorage` whose methods throw. The suite installs a minimal `Map`-backed `Storage` shim in `beforeEach` so round-trip semantics are still exercised honestly.

### Stats (3 tests)
- Counts recipes, distinct cuisines, and non-empty locations
- Skips empty locations when counting

## E2E — tests/e2e/recipes.spec.js

7 tests run against a real headless Chromium loading the real `index.html` from a local static server.

1. **Loads and renders all 187 seeded cards.** Full corpus renders; stats bar shows "187". ~2.2 s from cold navigation.
2. **Clicking a card opens the view modal.** Modal gains `.open` class; `.view-title` matches the card's `.card-title`.
3. **Cuisine filter narrows the grid.** Italian chip reduces the card count below 187, and every visible `.card-cuisine` text content equals `"Italian"` (using `allTextContents`, not `innerText`, to defeat CSS `text-transform: uppercase`).
4. **Search narrows the grid and is case-insensitive.** `CHICKEN` yields between 1 and 186 results.
5. **Manual recipe add persists across reload.** Adds a uniquely-named recipe through the form modal, verifies the grid grows by one, searches for the unique name and confirms exactly one match, reloads the page, searches again, confirms the recipe survived. Deliberately does *not* clear localStorage between the two navigations.
6. **No console errors or uncaught exceptions on load.** Listens for `pageerror` and `console.error`; asserts an empty list after the grid renders.
7. **XSS hardening (adversarial persistence).** Pre-seeds localStorage with a recipe whose name is `<img src=x onerror="window.__xssFired=true">`, loads the page, asserts:
   - Exactly one card rendered
   - Zero `<img>` elements inside `.recipe-grid`
   - Card title's rendered text contains the literal string `<img` (proving it's text, not markup)
   - `window.__xssFired` is `undefined` — the onerror side-effect never executed

The test helper `freshPage()` navigates once, calls `localStorage.removeItem('recipe_journal_v3')` through `page.evaluate`, then navigates again so the seed block re-runs. This was reworked from an earlier `addInitScript`-based approach that ran on every navigation and corrupted the persistence test's `page.reload()` semantics.

## Reproducing locally

```bash
cd "Recipe Tracker"
npm install
npx playwright install chromium    # one-time, downloads the browser binary
npx vitest run                     # unit + integration (~5 s total)
npx playwright test                # E2E (~25 s, auto-starts local server)
```

To point E2E at the live Pages site instead of the local server:
```bash
PW_BASE_URL=https://davehomeassist.github.io/recipe-tracker npx playwright test
```

## What's not covered

Honest limits so nobody reads this as "everything tested":

- **Visual regression.** No screenshot diffs. The warm cream/terracotta palette could silently break and no test would catch it.
- **Mobile viewport.** Tests run at Playwright's default desktop viewport. No 320px or 375px coverage yet.
- **Focus management.** Modal focus trap, focus restoration on close, Escape key handling, and skip-to-main-content aren't covered here. Next up as part of the accessibility pass.
- **Image loading.** Recipe images aren't rendered in the current UI, so there's nothing to test there until image support ships.
- **`build/` extractor.** The Node-based bulk extractor at `build/scripts/extract-all.js` is network-dependent and has no test coverage. It's treated as a one-shot build tool.
- **Import / Export JSON.** Not implemented yet. Will ship with tests in the next pass.

## Appendix: raw runner output

### Vitest
```
 ✓ tests/unit/lib.test.js (25 tests) 67ms
 ✓ tests/integration/render.test.js (21 tests) 164ms

 Test Files  2 passed (2)
      Tests  46 passed (46)
```

### Playwright
```
Running 7 tests using 1 worker
  ✓  1 … loads and renders all 187 seeded cards (2.2s)
  ✓  2 … clicking a card opens the view modal with the recipe name (1.7s)
  ✓  3 … cuisine filter narrows the grid (2.2s)
  ✓  4 … search narrows the grid and is case-insensitive (1.5s)
  ✓  5 … adding a manual recipe persists across reload (3.8s)
  ✓  6 … no console errors or uncaught exceptions on load (1.1s)
  ✓  7 … XSS hardening: a manually added recipe with an <img onerror> name renders as text (1.1s)

  7 passed (22.3s)
```
