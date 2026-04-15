# Changelog

All notable user-facing changes to Our Recipe Journal.

## 2026-04-15 — Test harness, Phase 1 patches, a11y pass

### Added
- **Export / Import JSON.** Two toolbar buttons. Export downloads `recipe-journal-YYYY-MM-DD.json` with `schemaVersion`, `exportedAt`, and the full recipe array. Import accepts the same file shape, validates the schema version, and offers Merge (dedupes by URL, keeps existing records) or Replace (confirmed).
- **Undo on delete.** Deleting a recipe no longer fires a blocking confirm dialog. It removes the card immediately and shows a 6-second "<name> deleted — Undo" toast. Clicking Undo restores the recipe in its original position.
- **Test suite.** 25 unit tests (Vitest + jsdom) on `escapeHtml`, `safeUrl`, `dedupeByUrl`. 21 integration tests on the pure render pipeline including adversarial XSS payloads and localStorage round-trips. 7 Playwright E2E tests against a local static server covering load, filter, search, click-to-view, manual add + reload persistence, console cleanliness, and stored XSS. 53 tests, all green. See `TEST_REPORT.md`.
- **Skip-to-main-content link** at the top of the body.
- **Focus trap + focus restoration** on every modal.
- **`aria-label`** on icon-only buttons (edit, delete, close).
- **`role`, `aria-modal`** on dialogs; `role="list"` and `role="listitem"` on the recipe grid.
- **Keyboard-operable star rating** via `tabindex=0` + Enter/Space handlers.
- **`<head>` SEO + social essentials:** `<meta name="description">`, `<meta name="theme-color">`, `<link rel="canonical">`, inline SVG favicon in the warm palette, Open Graph `og:type|title|description|url|site_name`, Twitter Card, JSON-LD `WebApplication` structured data.
- **Schema version constant** `SCHEMA_VERSION = 3` for export/import compatibility.
- **Auto-generated cuisine filter chips** from the data (with the hardcoded 12-cuisine list as fallback when the library is small).

### Changed
- **"Add Manually" → "Add Recipe"** and visually promoted as the primary toolbar CTA (larger padding, soft drop shadow).
- **Import banner copy removed.** The "link-based extraction needs a backend" apology is gone; the toolbar is now the only entry point until a backend is wired up.
- **Refactored inline helpers into ES modules.** `escapeHtml`, `safeUrl`, `dedupeByUrl` now live in `src/recipe-lib.js`; `filtered`, `renderCardHtml`, `renderGridHtml`, `statsFor`, `stars` in `src/recipe-render.js`. The inline `<script>` became `<script type="module">` importing from both. Tests import the same modules the browser runs — no drift possible.
- **`loadRecipes()` and `persist()` now catch errors** from `JSON.parse` and `localStorage.setItem`. A failed save surfaces a toast asking the user to export for safety rather than silently dropping data.
- **Search field** is now `<input type="search">` with an associated `<label>` and `aria-label`.

### Fixed
- Removed the hidden-but-still-present broken Anthropic extract modal handlers (progress / review modals are now dead markup only and can be pruned later).

### Unchanged (by design)
- The 187-recipe seed is kept as-is. The earlier website review mistakenly called it "40 pre-loaded samples" — it's the full family corpus extracted from `build/bookmarks.json`, not demo data. Replacing it with an opt-in loader would delete your actual recipes.
- No build tooling introduced. Still vanilla HTML/CSS/JS served from GitHub Pages.
- `localStorage` schema v3 preserved.
