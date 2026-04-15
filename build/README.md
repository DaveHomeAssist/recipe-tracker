# Our Recipe Journal

A shared family recipe journal built from a Firefox bookmarks export. Static
site on GitHub Pages, two small Vercel serverless functions for "add later"
workflows, no database.

## What's in this repo

```
public/                static site (served by GitHub Pages)
  index.html
  styles.css
  recipes.json         187-recipe corpus, pre-extracted
  js/
    recipes.js         types, validation, pure helpers
    state.js           centralized store + localStorage persistence
    render.js          DOM rendering (dumb UI layer)
    api.js             fetch wrappers for /api/extract and /api/save
    app.js             bootstrap + event wiring
api/                   Vercel serverless functions
  extract.js           POST /api/extract  { url } → Recipe
  save.js              POST /api/save     { recipes } → commits to the repo
  _lib/
    parse.js           shared JSON-LD + meta parser (pure, no network)
scripts/               one-time + maintenance scripts
  parse-bookmarks.js   Netscape bookmark HTML → bookmarks.json
  extract-all.js       bulk recipe extractor (used to build recipes.json)
  retry-failures.js    re-run extraction for records where extractedFrom='none'
bookmarks.json         parsed bookmark list (187 URLs from the "Recipes" folder)
```

## Architecture at a glance

- **Single source of truth**: `public/recipes.json` is the corpus. User
  additions live in localStorage under `recipe_journal_v3` and are merged
  with the corpus at load time. Dedupe is by URL.
- **Signal chain**: raw HTML → `parseRecipeHtml()` → `validateRecipe()` →
  `render.js` (with HTML escaping). Raw scraped data never touches the DOM.
- **Types without TypeScript**: `public/js/recipes.js` declares the `Recipe`
  shape as a JSDoc typedef. Every producer/consumer runs objects through
  `validateRecipe()` which coerces unknown input into the canonical shape.
- **Optimistic updates**: edits go to localStorage first, the UI re-renders
  immediately, then `/api/save` fires in the background. Failures surface as
  a toast but never lose data.
- **"Add later" pipeline**: user pastes URL → `POST /api/extract` scrapes it
  (JSON-LD first, Wayback fallback) → review modal prefills → save →
  `POST /api/save` commits the updated `recipes.json` back to this repo →
  GitHub Pages redeploys within ~60 seconds.

## Corpus quality

Of the 187 bookmarks:

- **159** full JSON-LD recipes (complete ingredients, method, times, image)
- **19** OG-meta only (name + image + description — usually listicle pages)
- **9** bookmark-only (host blocks scraping AND no Wayback snapshot)

173/187 have a hero image. The 9 bookmark-only records still show as cards
with the original title and a link to the source — they're marked with an
"incomplete" badge. Filling them in is a one-click edit in the UI.

## Deploy

### 1. Push to a new GitHub repo

```bash
cd recipe-tracker
git init
git add .
git commit -m "Initial commit"
gh repo create dave/recipe-tracker --public --source=. --push
```

### 2. Turn on GitHub Pages

In the repo settings → Pages → **Source**: Deploy from a branch → branch
`main`, folder `/public`. Save. Wait ~60 seconds for the first build.
Site URL: `https://dave.github.io/recipe-tracker/`.

### 3. Deploy the two API functions to Vercel

```bash
npm i -g vercel     # once
vercel              # in the repo root; choose "link to existing or create new"
```

Vercel auto-detects `api/*.js` as serverless functions. You'll get a URL
like `https://recipe-tracker-abc123.vercel.app`.

Set these environment variables in the Vercel dashboard
(**Settings → Environment Variables**):

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | A fine-grained PAT with Contents: read+write on **this repo only** |
| `GITHUB_REPO` | `dave/recipe-tracker` |
| `GITHUB_BRANCH` | `main` (default) |
| `GITHUB_FILE_PATH` | `public/recipes.json` (default) |
| `ALLOW_ORIGIN` | `https://dave.github.io` (your Pages origin) |
| `SHARED_SECRET` | Optional — any random string. If set, the frontend must send it. |

Create the PAT at <https://github.com/settings/personal-access-tokens>.
Scope it to the single `recipe-tracker` repo and grant only "Contents:
read and write". No other permissions.

### 4. Wire the frontend to the backend

Edit `public/index.html` (or add an inline script) to set the API base:

```html
<script>window.RECIPE_API_BASE = 'https://recipe-tracker-abc123.vercel.app';</script>
```

Place it before the `<script type="module" src="js/app.js">` tag. Commit and
push — GitHub Pages will rebuild.

If you'd rather keep the static site completely offline, leave `RECIPE_API_BASE`
unset. The "Extract" button will still work IF you run the site locally
with same-origin functions, but on Pages without a backend the "add later"
feature degrades to "manual entry only". Export/Import JSON buttons always work.

## Running locally

```bash
# Parse the original Firefox bookmark export (already done, committed)
node scripts/parse-bookmarks.js "/path/to/recipe bookmarks.html" > bookmarks.json

# Re-extract everything from scratch (already done, committed)
node scripts/extract-all.js --in bookmarks.json --out public/recipes.json

# Retry any records where extractedFrom === 'none'
node scripts/retry-failures.js

# Serve the static site on :8080
npm run dev
```

The extractor is resumable: it merges with the existing `recipes.json` and
only fetches URLs it hasn't seen. To force a re-extract of a record, delete
it from the output file and re-run.

## Production-readiness notes

- **Security**:
  - All HTML insertion goes through `escapeHtml()` in `render.js`. No raw
    string interpolation into the DOM.
  - External links use `rel="noopener noreferrer"` and `target="_blank"`.
  - Images get `referrerpolicy="no-referrer"` to avoid leaking referer to
    third-party hosts.
  - The save endpoint enforces: CORS origin allowlist, optional shared
    secret, 2MB payload cap, array-of-objects validation.
  - The GitHub PAT is fine-grained and scoped to one repo; compromise of the
    Vercel env vars cannot affect anything else.
- **Accessibility**:
  - Modals have `role="dialog"`, `aria-modal="true"`, focus trap, Escape to
    close, focus restoration on close.
  - Cards are keyboard-navigable (Tab + Enter/Space).
  - All icon buttons have `aria-label`.
  - Search input has `aria-label`, live region on the toast (`aria-live="polite"`).
  - Colour contrast checked for small text on cream backgrounds.
- **Resilience**:
  - Extraction: 3 retries + Wayback Machine fallback.
  - Frontend: load errors surface in the empty state, not a silent fail.
  - Sync: optimistic updates with retry toast on failure.
- **Not yet production**: the 9 unrecoverable records. These are bookmark-
  only cards and will stay that way until someone either (a) pastes the
  ingredients manually via the Edit modal, or (b) writes a one-off scraper
  for allrecipes.com that handles their Cloudflare challenge.

## Adding a recipe as an end user

1. Click **Add a recipe** and fill in the form manually, OR
2. Paste a URL into the import strip at the top, click **Extract**. The form
   opens prefilled with whatever the scraper found. Review, edit, save.

Saves persist to localStorage immediately. If the backend is configured, a
background sync commits the updated `recipes.json` to the repo (and the
site redeploys).

## License

Private / unlicensed. For family use.
