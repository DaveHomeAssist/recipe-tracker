# Our Recipe Journal

A shared family recipe journal. Single-file static web app, no backend, no build tooling. Hosted on GitHub Pages at https://davehomeassist.github.io/recipe-tracker/.

## What it does

- 187 family recipes seeded from a Firefox bookmarks export (see `build/`).
- Search across names, ingredients, tags, locations, notes.
- Filter by cuisine (chips auto-generated from the data).
- Add, edit, delete recipes. Delete has a 6-second undo toast.
- Star ratings, prep/cook time, servings, source URL, free-form notes.
- Export / Import the full library as JSON for backup or sync between devices.
- Keyboard and screen-reader accessible: skip link, focus trap in modals, labeled icon buttons, keyboard-operable star rating.

## Running locally

Just open `index.html` in a browser — or serve it:

```bash
python3 -m http.server 8787
# then visit http://127.0.0.1:8787/
```

## Architecture

```
index.html              single-file app, inlines CSS and a small module script
src/
  recipe-lib.js         pure: escapeHtml, safeUrl, dedupeByUrl
  recipe-render.js      pure: filtered, renderCardHtml, renderGridHtml, statsFor
build/                  one-shot extractor + (planned) Vercel proxy, not served
tests/
  unit/                 Vitest (jsdom) — helpers
  integration/          Vitest (jsdom) — render pipeline + stored XSS
  e2e/                  Playwright (chromium) — real browser flows
TEST_REPORT.md          53/53 passing, last run 2026-04-15
CHANGELOG.md            user-facing changes
AUDIT.md                Phase 2 audit findings and known gaps
```

### Storage

- Key: `recipe_journal_v3`
- Shape: a JSON array of recipe objects.
- Export wraps the array in `{ schemaVersion: 3, exportedAt: <ISO8601>, recipes: [...] }`.
- Import accepts either the wrapped shape or a bare array, refuses newer schema versions, and offers Merge (dedupe by URL) or Replace on conflict.

### Security

- All `innerHTML` sinks route through `escapeHtml()` (`src/recipe-lib.js`).
- Source URLs validated by `safeUrl()` — only `http(s):` schemes reach `href`.
- The Vitest integration suite injects adversarial recipes (`<img onerror>`, stored XSS via localStorage) and asserts the rendered DOM is inert.
- The Playwright E2E suite repeats the stored-XSS check in a real browser with a `window.__xssFired` sentinel.

## Testing

```bash
npm install
npx playwright install chromium   # one-time, downloads the browser binary
npx vitest run                    # unit + integration (~5 s)
npx playwright test               # E2E (~20 s, auto-starts local server)
```

To run E2E against the live Pages site:

```bash
PW_BASE_URL=https://davehomeassist.github.io/recipe-tracker npx playwright test
```

## URL-based recipe extraction

There is **no** live URL importer in the shipped site. The `build/` folder contains a Node-based extractor (`build/scripts/extract-all.js`) that pulls JSON-LD + OG-meta from a bookmarks list; it was used once to generate the 187-recipe seed and is kept for re-runs.

A browser-facing importer would need a serverless proxy to get around CORS and host blocks. The contract (when that ships) is:

- `POST <CONFIG.extractorEndpoint>` with `{ url: string }`
- Returns `{ name, cuisine, source, ingredients, instructions, prepTime, cookTime, servings, tags, notes, image, url }`
- Frontend will show a review modal before saving

Until that endpoint exists, the Add Recipe form is the only entry point.

## License

Private. For family use.
