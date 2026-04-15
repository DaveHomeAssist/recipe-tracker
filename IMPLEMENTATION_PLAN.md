# Implementation Plan — Remaining Gaps

**Source:** `AUDIT.md` known-gaps section.
**Strategy:** Split by ability. Codex handles deterministic, well-specified, pattern-applying work where `npx vitest run && npx playwright test` is the contract. Claude (Opus) keeps the design calls, security-sensitive code, and anywhere judgment about what *not* to do matters.

## Executive summary

Eight gaps, grouped into three tracks. **Track A (this week)** lands the trivial cleanups and image support — low risk, immediately visible. **Track B (next)** hardens imports and adds mobile + visual regression tests — the risk/coverage story. **Track C (when it's worth it)** ships a service worker and rethinks touch targets on cards.

Claude owns 3 items (the design + security calls). Codex owns 4 items (the spec-driven grind). One item (#2 Touch targets) is genuinely split: Claude writes the visual spec, Codex implements it.

Each item lists its dependencies, files affected, the test fixture that defines "done," and an estimated commit size. Work items can run in parallel when dependencies allow.

## Track A — Cleanup + quick wins (estimated 1 session)

### A1. Delete dead `progressModal` and `reviewModal` markup
- **Owner:** Codex
- **Size:** ~1 commit, ~50 line deletion in `index.html`
- **Why it's a Codex job:** Mechanical. Grep-verify nothing references the IDs, delete the blocks, re-run tests.
- **Spec:**
  - Remove `<div class="modal-overlay" id="progressModal">…</div>` and `<div class="modal-overlay" id="reviewModal">…</div>` from `index.html`.
  - Remove the unused `prog-modal`, `prog-list`, `prog-item`, `prog-url`, `prog-status`, `spin`, `review-modal`, `ext-badge`, `source-chip`, and related `s-pending`/`s-loading`/`s-done`/`s-error` CSS rules.
  - Remove `rvQueue`, `rvIdx`, `rvRating`, `openReview`, `advanceReview`, `setRvStars`, and their event listeners from the inline module.
  - Leave the existing `escapeHtml` / `safeUrl` / `filtered` / `renderGridHtml` imports untouched.
- **Done when:**
  - `grep -c 'progressModal\|reviewModal\|rvQueue\|prog-modal' index.html` returns 0.
  - `npx vitest run && npx playwright test` → 53/53 green.
- **Risk:** low. No live feature depends on this code.

### A2. Render hero images on recipe cards (with lazy loading)
- **Owner:** Claude designs (card layout + placeholder), Codex implements
- **Size:** ~2 commits, mid-size changes to `src/recipe-render.js` + `index.html` CSS + new integration test
- **Why split:** the design question (where does the image go, aspect ratio, placeholder for the 52/187 recipes without images, CSS layout) needs Claude; the implementation and tests are Codex.
- **Claude's output:** a mini design spec in this doc under "A2 design spec" below, with CSS selectors named and a picture of the card layout.
- **Codex's spec:**
  - Extend `src/recipe-render.js:renderCardHtml` to output a `<div class="card-image">` wrapper with `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="">` when the recipe has `image`, otherwise a palette-tinted `<div class="card-image card-image-empty"></div>` placeholder.
  - Pass the image URL through `safeUrl()` — drop non-http(s) URLs silently.
  - `alt` is always empty (`alt=""`) because the recipe name is already on the card; images are decorative in this UI.
  - Source: the existing `image` field already on every recipe in `build/public/recipes.json`. Re-run the seed migration: add a small function that on first load merges `image` from `build/public/recipes.json` into existing seeded recipes where missing. Gated by `SCHEMA_VERSION` bump to 4.
  - Add CSS per the design spec.
  - Add an integration test: `renderCardHtml({image: 'javascript:alert(1)'})` produces no `<img>` tag. `renderCardHtml({image: 'https://example.com/x.jpg'})` produces `<img src="https://example.com/x.jpg" loading="lazy" alt="">`.
- **Done when:**
  - Cards for the 135 json-ld recipes render images; the 52 meta/bookmark-only records show the placeholder.
  - `npx vitest run && npx playwright test` → all green, plus the new integration test.
  - Lighthouse "loading lazy" warning is gone.
- **Risk:** medium — the image fetch loads ~135 external images from third-party hosts. Lazy loading plus `referrerpolicy=no-referrer` handles the privacy bit; broken image URLs will silently 404 which is acceptable.

**A2 design spec (written by Claude, read by Codex):**
- Image goes at the top of the card, above the existing `.card-body`.
- Aspect ratio `4 / 3`, `object-fit: cover`, `border-radius: 10px 10px 0 0` to match the card corner.
- Placeholder uses `background: linear-gradient(135deg, var(--parchment), var(--cream))` with a centered `🍳` emoji at `opacity: 0.25, font-size: 3rem`.
- `.card-banner` (the cuisine color strip) moves to sit *below* the image, becoming a 4 px accent at the top of `.card-body` instead of above the image.
- Cards without images use the placeholder so the grid layout doesn't jitter.

## Track B — Hardening + coverage (estimated 1-2 sessions)

### B1. Field-level schema validation for imported recipes
- **Owner:** Claude
- **Size:** 1 commit, new `src/recipe-schema.js` + callsite change in `index.html`
- **Why Claude:** security-sensitive. The risk is a malformed JSON import corrupting render state or silently overwriting existing recipes. Needs a judgment call on strictness: "reject if invalid" vs. "coerce and keep."
- **Spec:**
  - New module `src/recipe-schema.js` exporting `validateRecipe(raw)` and `validateImport(payload)`.
  - `validateRecipe` whitelists these fields with types: `id`(string|number), `name`(string, required, min 1 char), `cuisine`(string), `source`(string), `location`(string), `ingredients`(string), `instructions`(string), `preptime`(string), `cooktime`(string), `servings`(string), `tags`(string), `notes`(string), `url`(string, passed through `safeUrl`), `date`(string), `rating`(number 0-5), `image`(string, passed through `safeUrl`).
  - Unknown fields are stripped. Missing optional fields default to `''`. `name` missing → record dropped with a warning.
  - `validateImport` accepts `{recipes: [...]}` or a bare array, runs each through `validateRecipe`, returns `{ok: true, recipes, dropped: N}` or `{ok: false, error: string}`.
  - Update `importRecipes` in `index.html` to call `validateImport` before the merge/replace branch. Show `"Dropped N invalid recipes"` in the toast when `dropped > 0`.
- **Done when:**
  - New unit tests in `tests/unit/schema.test.js` cover: valid record passes unchanged, missing `name` drops record, unknown field `__proto__` stripped, `url: "javascript:alert(1)"` coerced to empty string, `rating: 99` clamped to 5, `rating: "three"` coerced to 0, bare array accepted, wrong top-level type rejected.
  - `npx vitest run && npx playwright test` → all green.
- **Risk:** low. Pure function, covered by tests before it touches live import.

### B2. Mobile E2E coverage (320 px + 375 px)
- **Owner:** Codex
- **Size:** 1 commit, new `tests/e2e/mobile.spec.js` + `playwright.config.js` projects addition
- **Why Codex:** deterministic Playwright config work.
- **Spec:**
  - Add two Playwright projects to `playwright.config.js`: `mobile-320` (viewport 320x568) and `mobile-375` (viewport 375x667).
  - New `tests/e2e/mobile.spec.js` with tests that run against the mobile projects:
    1. Toolbar does not horizontally overflow: `await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)`.
    2. Add Recipe button is clickable without horizontal scroll (check `boundingBox().x >= 0 && x + width <= viewport.width`).
    3. Opening the Add form modal does not overflow: `.modal` `boundingBox.width <= viewport.width`.
    4. Filter chips wrap (second row) — at 320 px there should be more than one `offsetTop` among `.filter-btn` elements.
  - Do NOT run the existing `tests/e2e/recipes.spec.js` against mobile projects (they already work at desktop). Keep mobile focused.
- **Done when:**
  - `npx playwright test` runs the new mobile project tests in addition to the existing 7.
  - All pass.
- **Risk:** low.

### B3. Visual regression baseline (Playwright screenshots)
- **Owner:** Codex
- **Size:** 1 commit, new `tests/visual.spec.js` + baseline PNGs in `tests/visual.spec.js-snapshots/`
- **Why Codex:** mechanical setup.
- **Spec:**
  - New `tests/visual.spec.js` with 4 snapshot tests: full grid (desktop), view modal open, add form modal, filter-applied grid (Italian).
  - Use `await expect(page).toHaveScreenshot({ fullPage: true, maxDiffPixelRatio: 0.02 })`.
  - Mask the animation-delay on cards by forcing `document.querySelectorAll('.card').forEach(c => c.style.animation = 'none')` before each screenshot.
  - Freeze fonts: use `@font-face { font-display: block }` via a pre-navigation stylesheet injection, or `page.waitForFunction(() => document.fonts.ready)`.
  - Commit the baseline PNGs generated by the first run.
- **Done when:**
  - `npx playwright test tests/visual.spec.js` → passes after baselines are committed.
  - Intentional palette changes cause the tests to fail loudly (verify with a one-line local tweak, then revert).
- **Risk:** medium — font rendering differs across platforms, so CI/local baseline drift is likely. If the baselines thrash, fall back to `maxDiffPixels: 500`.

## Track C — Larger architectural work (estimated 2-3 sessions)

### C1. Touch targets on card icon buttons (44 px minimum)
- **Owner:** Claude (design), Codex (CSS + a11y test)
- **Size:** 1-2 commits depending on redesign scope
- **Why split:** the design call is the work. Three options:
  - **(a) Inline enlarge:** grow `.icon-btn` to 44x44, push `.card-footer` to a taller row. Simple but eats 28 px of card height.
  - **(b) Hover-reveal menu:** put edit/delete behind a kebab menu that opens on tap/hover. Saves space but adds a click on every action.
  - **(c) Swipe-to-delete:** mobile-only horizontal swipe reveals destructive action. iOS native feel. More code.
- **Claude's recommendation:** (a) for simplicity. Users delete rarely and the extra row height is acceptable for a family tool.
- **Codex's spec (given recommendation (a)):**
  - `.icon-btn { width: 44px; height: 44px; padding: 0; display: grid; place-items: center; font-size: 1.15rem; }`
  - `.card-footer { padding: 10px 16px 14px; }` (was `8px 20px 14px`)
  - At `max-width: 540px`, keep the same size (no mobile-specific override).
  - Add a Playwright mobile test asserting `.icon-btn` `boundingBox.width >= 44 && height >= 44` at 375 px viewport.
- **Done when:**
  - Mobile visual regression (B3) test re-baselined.
  - New touch-target test passes.
  - All existing tests green.
- **Risk:** medium — grid layout might jitter if card height increases. Test visually in the iteration.

### C2. Service worker + offline install prompt
- **Owner:** Claude
- **Size:** 2-3 commits across `service-worker.js`, `index.html`, and `manifest.webmanifest`
- **Why Claude:** architectural choices. Cache strategy (cache-first? network-first?), versioning, update flow on a multi-device family, and the user-visible update-available UX all need judgment.
- **Spec (Claude will iterate, not final):**
  - New `service-worker.js` using cache-first for `/`, `/index.html`, `/src/*.js`, and the Google Fonts CSS.
  - Cache name includes a version string bumped on each deploy.
  - On `activate`, delete old caches.
  - On `fetch`, serve from cache, then network-update in the background (stale-while-revalidate).
  - New `manifest.webmanifest` with the SVG favicon, warm palette, `display: standalone`.
  - `index.html` adds `<link rel="manifest">` and a small module that calls `navigator.serviceWorker.register('./service-worker.js')` and listens for `updatefound` to show a "New version available — refresh" toast.
  - Cache bust on SW update by reloading after the new worker activates (with user consent via the toast).
- **Done when:**
  - Chrome DevTools "Add to Home Screen" flow works.
  - Loading the page offline (after one warm cache) renders the grid.
  - E2E test: load the page, close network, reload — still 187 cards.
- **Risk:** high — service workers are easy to get wrong and hard to debug. Needs careful versioning, and a kill switch in case a broken worker is cached. Start with an unregister escape hatch documented in README.

## Skipped / deferred

- **#2 from AUDIT gaps** (touch targets) is now C1 above.
- **#4 from AUDIT gaps** (focus trap ordering) — not worth the rework given only 3 modals exist. Revisit if modal count grows.

## Running order

```
Track A  ─┬─ A1 (Codex)  ─┐
          └─ A2 (Claude spec, then Codex) ─┐
                                           │
Track B  ─┬─ B1 (Claude)  ─────────────────┼─ independent, any order
          ├─ B2 (Codex)   ─────────────────┤
          └─ B3 (Codex)   ─────────────────┘
                                           │
Track C  ─┬─ C1 (Claude + Codex) ──┐       │
          └─ C2 (Claude)     ──────┴───────┴─ after A complete
```

Track A blocks nothing. Track B depends only on A1 (smaller diff surface for B3 baselines). Track C depends on Track A being shipped and Track B tests being in place so we don't break them invisibly.

## Ownership table

| ID | Item | Owner | Size | Depends on |
|---|---|---|---|---|
| A1 | Delete dead progress/review modals | Codex | S | — |
| A2 | Hero image rendering with placeholders | Claude spec + Codex impl | M | A1 |
| B1 | Import schema validation | Claude | M | — |
| B2 | Mobile E2E (320/375) | Codex | S | — |
| B3 | Visual regression baseline | Codex | M | A1, A2 |
| C1 | 44 px touch targets on card buttons | Claude design + Codex impl | M | B3 |
| C2 | Service worker + offline cache | Claude | L | A complete |

Total Claude lift: ~2 design specs, B1 (~200 lines), C2 architecture.
Total Codex lift: A1, A2 impl, B2, B3, C1 impl.

## Contract

Every commit in this plan must leave `npx vitest run && npx playwright test` green before push. No exceptions. If a test needs updating, update it in the same commit that changed the behavior.
