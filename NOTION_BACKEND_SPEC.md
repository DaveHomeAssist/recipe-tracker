# Notion Backend Spec

## Purpose

Replace browser-local recipe persistence with a shared backend backed by Notion so recipe edits are consistent across devices, browser profiles, and family members.

This spec is for the current repo state:

- frontend is a static app centered in [index.html](/Users/daverobertson/Documents/Claude/Projects/Recipe%20Tracker/index.html)
- current persistence is browser `localStorage` under `recipe_journal_v3`
- current schema marker is `recipe_journal_schema_version = 4`
- current import/export shape is `{ schemaVersion: 4, exportedAt, recipes }`

This is the canonical shared-persistence spec for the repo. Delete older journal or
Postgres variants rather than keeping competing backend plans in parallel.

## Recommendation

Use Notion as the source of truth, but only behind a server-side API.

Architecture:

- browser -> app API -> Notion API
- Notion integration secret stays server-side only
- frontend never calls Notion directly

Recommended deployment for this repo:

- move hosting from GitHub Pages to Vercel
- keep the frontend effectively static
- add serverless API routes in the same repo

This avoids client-side secrets and avoids CORS entirely because frontend and API share one origin.

Fallback deployment:

- keep frontend on GitHub Pages
- deploy the API separately
- explicitly configure CORS

## Goals

- shared recipe state across all instances and profiles
- minimal product change to the existing UI
- server-side validation before writes reach Notion
- offline read fallback from cached snapshots
- simple family access control without embedding secrets in the frontend

## Non-goals

- multi-family tenancy
- realtime collaborative cursors or presence
- offline queued writes
- full database-grade transactions
- first-class tag catalog in v1

## Key Constraints

These Notion constraints drive the design:

- Notion uses bearer-token authentication and the token must be kept server-side
- the integration must be granted access to the specific page/database/data source
- the Notion API is rate limited to an average of roughly 3 requests per second per integration
- current API versions expose data source endpoints for row querying
- Notion page updates are not conditional transactions, so strict optimistic locking is not guaranteed

## Chosen Model

Single family, single workspace, single data source.

No request-level `journalId` abstraction in v1.

Keep one dormant server-side constant only:

- `JOURNAL_PREFIX = 'journal_family'`

That leaves a cheap re-entry point for future multi-family work without leaking
tenant routing into the v1 API.

One Notion data source holds all recipe pages. Each page represents one recipe.

## High-Level Architecture

### Server responsibilities

- authenticate family users
- validate request payloads
- translate app recipes to Notion page properties
- read/write Notion pages
- apply retry and backoff for Notion rate limits
- expose a stable app-facing API contract

### Client responsibilities

- render in-memory recipe state
- read cached snapshot on boot
- fetch remote state from API
- send create/edit/delete/import operations to API
- show offline and conflict errors

### Notion responsibilities

- canonical shared storage
- optional manual admin visibility inside the Notion UI

## Deployment

## Preferred: Same-origin on Vercel

Repo layout target:

```text
index.html
src/
  server/
    journal.js
api/
  v1/
    session.js
    recipes/
      index.js
      [id].js
    import.js
    health.js
```

Behavior:

- `GET /` serves the app
- `GET /api/v1/recipes` reads from Notion
- all secrets live in Vercel env vars

## Fallback: GitHub Pages + separate API

If frontend stays on GitHub Pages:

- frontend origin: `https://davehomeassist.github.io`
- API origin: separate Vercel project or other host
- server must return:
  - `Access-Control-Allow-Origin: https://davehomeassist.github.io`
  - `Access-Control-Allow-Headers: Authorization, Content-Type`
  - `Vary: Origin`
  - `403 CORS_FORBIDDEN` for non-matching browser origins

Do not use `*` for origin.

## Authentication

Do not put any shared bearer token in the frontend.

### MVP auth model

Use one family access code entered in the UI and exchanged for a scoped signed session token.

Flow:

1. user opens the app
2. if no valid local session token, show a simple access-code form
3. client `POST`s the code to `/api/v1/session`
4. server compares the code to a stored secret
5. server returns `{ token, expiresAt, issuedAt, scope }`
6. client stores that object in `localStorage` under `recipe_journal_session`
7. subsequent API calls send `Authorization: Bearer <token>`

This is intentionally simple. The token is JS-readable because `localStorage` is JS-readable by definition. That XSS tradeoff is accepted and documented in `SECURITY.md` rather than hidden behind inaccurate `httpOnly` language.

### Session model

- storage key: `recipe_journal_session`
- expiry: 24 hours
- token payload: signed session containing `family_access = true`, `scope = recipe_journal`
- logout route clears the stored token on the client

## Notion Data Model

One Notion data source named `Recipes`.

Each recipe is a page in that data source.

### Property schema

| App field | Notion property name | Type | Notes |
|---|---|---|---|
| `id` | `App ID` | `rich_text` | stable app-level ID, not page ID |
| `name` | `Name` | `title` | required |
| `cuisine` | `Cuisine` | `select` | current cuisine list |
| `source` | `Source` | `rich_text` | optional |
| `location` | `Location` | `rich_text` | optional |
| `preptime` | `Prep Time` | `rich_text` | optional |
| `cooktime` | `Cook Time` | `rich_text` | optional |
| `servings` | `Servings` | `rich_text` | optional |
| `tags` | `Tags` | `rich_text` | keep as normalized string in v1 |
| `url` | `Source URL` | `url` | sanitized to http(s) only |
| `image` | `Image URL` | `url` | sanitized to http(s) only |
| `date` | `Date Tried` | `date` | optional |
| `rating` | `Rating` | `number` | 0-5 |
| `notes` | `Notes` | `rich_text` | chunked if long |
| `ingredients` | `Ingredients` | `rich_text` | chunked if long |
| `instructions` | `Instructions` | `rich_text` | chunked if long |
| `version` | `Version` | `number` | best-effort conflict detection |
| `deleted` | `Deleted` | `checkbox` | soft-delete marker for app logic |
| `lastSyncedAt` | `Last Synced At` | `date` | optional ops/debug field |

### Why `App ID`

Use an app-generated stable ID instead of relying on the Notion page ID.

Reasons:

- app IDs stay stable if migration ever moves off Notion
- import/export already expects app-owned recipe identity
- easier adapter boundary

### Why keep `tags` as `rich_text`

Do not build first-class tag entities in this Notion phase.

For this backend:

- normalize tags on write/import
- store a canonical comma-separated string
- revisit true tag objects after shared persistence exists

## Property Encoding Rules

Notion property values have limits, especially around rich text content.

Adapter rules:

- split long `rich_text` values into chunks of at most 2000 characters per rich-text item
- limit total rich-text items per property to stay well under Notion request limits
- reject or truncate pathological payloads before writing to Notion, matching app validation behavior

Long free-text fields in this app are still expected to fit comfortably within these limits.

## API Contract

All routes are under `/api/v1`.

All write routes require a valid bearer session token.

All responses are JSON except `DELETE`, which returns `204`.

## `POST /api/v1/session`

Create a family session.

Request:

```json
{
  "accessCode": "family-shared-code"
}
```

Response `200`:

```json
{
  "authenticated": true,
  "token": "<signed token>",
  "scope": "recipe_journal",
  "issuedAt": "2026-04-18T00:00:00.000Z",
  "expiresAt": "2026-04-19T00:00:00.000Z"
}
```

Errors:

- `401 INVALID_ACCESS_CODE`

## `DELETE /api/v1/session`

Client logout acknowledgement. The client clears the stored token locally.

Response `204`

## `GET /api/v1/recipes`

Return all active recipes.

Response `200`:

```json
{
  "data": [
    {
      "id": "recipe_01H...",
      "name": "Cacio e Pepe",
      "cuisine": "Italian",
      "source": "Trattoria",
      "location": "Rome",
      "ingredients": "pecorino\nblack pepper",
      "instructions": "toss with starchy water",
      "preptime": "10 min",
      "cooktime": "20 min",
      "servings": "2",
      "tags": "classic, pasta",
      "notes": "family favorite",
      "url": "https://example.com",
      "image": "https://example.com/hero.jpg",
      "date": "2026-04-16",
      "rating": 5,
      "version": 3,
      "notionPageId": "1f0..."
    }
  ],
  "meta": {
    "source": "notion",
    "fetchedAt": "2026-04-16T12:00:00.000Z"
  }
}
```

Behavior:

- only rows with `Deleted = false` and pages not in trash are returned
- result ordering defaults to recipe name ascending or last edited descending; choose one and keep it stable
- for the current library size, return the full set in one response

## `POST /api/v1/recipes`

Create a recipe.

Request:

```json
{
  "name": "Cacio e Pepe",
  "cuisine": "Italian",
  "tags": "classic, pasta"
}
```

Response `201`:

```json
{
  "data": {
    "id": "recipe_01H...",
    "version": 1
  }
}
```

Behavior:

- validate using the same whitelist shape as `src/recipe-schema.js`
- normalize tags before storage
- set `Deleted = false`
- set `Version = 1`

## `PATCH /api/v1/recipes/:id`

Update a recipe.

Request:

```json
{
  "name": "Updated Name",
  "rating": 4,
  "version": 3
}
```

Response `200`:

```json
{
  "data": {
    "id": "recipe_01H...",
    "version": 4
  }
}
```

Behavior:

- look up the recipe by `App ID`
- read current `Version`
- if request `version` does not match current `Version`, return `409`
- otherwise update the page and set `Version = current + 1`

Important limitation:

- this is best-effort conflict detection only
- Notion does not provide conditional page updates, so simultaneous writes can still race
- if strict concurrency becomes mandatory, Notion is the wrong primary store

## `DELETE /api/v1/recipes/:id`

Soft delete a recipe.

Request:

```json
{
  "version": 4
}
```

Response `204`

Behavior:

- best-effort version check as above
- set `Deleted = true`
- optionally also trash the Notion page if you decide Notion UI cleanup matters more than easy recovery

Recommended v1 choice:

- keep page untrashed
- use only `Deleted = true`

This makes recovery easier and avoids app/backend ambiguity around trash state.

## `POST /api/v1/import`

Import recipes into Notion.

Request:

```json
{
  "mode": "merge",
  "payload": {
    "schemaVersion": 4,
    "exportedAt": "2026-04-16T12:00:00.000Z",
    "recipes": []
  }
}
```

Response `200`:

```json
{
  "data": {
    "added": 12,
    "updated": 0,
    "duplicatesSkipped": 3,
    "dropped": 1
  }
}
```

Behavior:

- accept existing export shape or bare array for backward compatibility
- run `validateImport`
- normalize IDs and tags
- `merge` dedupes by normalized URL first, then by name/source fallback if URL missing
- `replace` requires an explicit second confirmation flag in the request

## `GET /api/v1/health`

Response `200`:

```json
{
  "ok": true,
  "notion": "reachable"
}
```

## Error Contract

All non-2xx errors return:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "This recipe was changed on another device.",
    "details": [],
    "requestId": "req_123"
  }
}
```

Codes:

- `UNAUTHORIZED`
- `INVALID_ACCESS_CODE`
- `VALIDATION_FAILED`
- `NOT_FOUND`
- `VERSION_CONFLICT`
- `IMPORT_INVALID`
- `RATE_LIMITED`
- `UPSTREAM_NOTION_ERROR`
- `INTERNAL_ERROR`

## Environment Variables

## Required server env vars

- `NOTION_ACCESS_TOKEN`
  - internal integration token
- `NOTION_VERSION`
  - pin the Notion API version, e.g. `2026-03-11`
- `NOTION_DATA_SOURCE_ID`
  - ID of the `Recipes` data source
- `FAMILY_ACCESS_CODE`
  - shared access code used at login
- `SESSION_SECRET`
  - signing secret for the bearer session token

## Optional server env vars

- `ALLOWED_ORIGIN`
  - only needed for cross-origin deployment
- `RATE_LIMIT_RETRY_MAX`
  - default `3`
- `RATE_LIMIT_BASE_DELAY_MS`
  - default `500`
- `SNAPSHOT_CACHE_TTL_MS`
  - server-side response cache if added later
- `LOG_LEVEL`

## Frontend config

If same-origin on Vercel:

- no public backend secret
- frontend uses relative `/api/v1/...` URLs

If cross-origin:

- `window.CONFIG.apiBaseUrl` or equivalent public config

Do not expose any Notion token or family access code in frontend config.

## Notion Integration Setup

1. Create an internal integration in the family Notion workspace.
2. Grant at least:
   - read content
   - update content
   - insert content
3. Create a parent page for the app backend docs/admin.
4. Create a `Recipes` database/data source under that page.
5. Add the property schema listed above.
6. Share the data source with the integration.
7. Copy the data source ID into `NOTION_DATA_SOURCE_ID`.

## Client Refactor

Add these modules:

- `src/recipe-api.js`
- `src/recipe-store.js`
- `src/recipe-cache.js`
- `src/auth.js`

### `src/recipe-api.js`

Responsibilities:

- `getRecipes()`
- `createRecipe(recipe)`
- `updateRecipe(id, patch)`
- `deleteRecipe(id, version)`
- `importRecipes(mode, payload)`
- normalized error parsing

### `src/recipe-store.js`

Responsibilities:

- source of truth for in-memory recipe state
- startup flow: cache -> remote fetch
- mutation orchestration
- revert optimistic UI when writes fail

### `src/recipe-cache.js`

Responsibilities:

- local snapshot cache of last known good remote library
- store `fetchedAt`
- clear cache on schema breaks

### `src/auth.js`

Responsibilities:

- check session status
- submit access code
- logout

## Startup and Offline Behavior

### First load, online

1. app boots
2. if unauthenticated, show access-code prompt
3. once authenticated, fetch `/api/v1/recipes`
4. cache the returned library locally
5. render from remote

### Returning load, online

1. read cached snapshot
2. render cache immediately
3. fetch remote state
4. replace local in-memory state with remote response

### Returning load, offline

1. read cached snapshot
2. render cache
3. show `Offline: showing last synced recipes`

### First load, offline, no cache

This is a hard error state.

Do not fall back to the old seeded 187-recipe bundle once shared persistence is enabled.

Show:

- `Cannot load recipes. You’re offline and this device has never synced.`

This avoids showing stale seed data that looks authoritative but is no longer the shared source of truth.

### Offline writes

Not supported in v1.

If offline:

- block create/edit/delete/import
- show `Offline: changes can’t be saved right now`

## Tag Handling for This Backend

Until a true tag domain exists:

- normalize tags on every write and import
- trim whitespace
- lowercase for canonical storage
- remove per-recipe duplicates
- join as comma-separated string

Example:

- input: `Quick,  quick , Weeknight`
- stored: `quick, weeknight`

This addresses the current tag duplication problem without overbuilding the data model before shared persistence ships.

## Migration from localStorage

Migration must be one-way and explicit.

## Phase 1: Prepare Notion backend

- create the Notion integration
- create the `Recipes` data source
- deploy the API with env vars configured
- verify `/api/v1/health`

## Phase 2: Create canonical export

Choose one canonical current library.

Recommended procedure:

1. open the current production app on the device believed to have the most complete data
2. export JSON using the existing export button
3. archive that file as the migration source of truth

## Phase 3: One-time import script

Add a Node script, for example:

- `scripts/import_export_to_notion.mjs`

Responsibilities:

- read an exported JSON file
- run `validateImport`
- normalize tags and IDs
- create Notion pages in batches with retry/backoff
- log added/dropped counts

CLI shape:

```bash
node scripts/import_export_to_notion.mjs ./recipe-journal-2026-04-16.json
```

## Phase 4: Client switch-over

- add new client API/store modules
- replace direct `localStorage` persistence in `index.html`
- keep localStorage only as snapshot cache

Critical rule:

- once shared persistence is enabled, remove the boot-time legacy seed fallback path

## Phase 5: Safety window

For one release, keep:

- export button
- import capability
- cached local snapshot

This provides an operational escape hatch if the Notion backend misbehaves.

## Rate Limiting and Retries

Server-side Notion adapter must:

- serialize or narrowly limit write concurrency
- retry on `429` using `Retry-After`
- use exponential backoff for transient 5xx upstream failures

Recommended write concurrency:

- `1-2` in-flight writes maximum

For a family app, correctness matters more than throughput.

## Webhooks

Not required for v1.

Recommended later use:

- subscribe to page/content update events
- invalidate any server-side caches
- optionally surface `Library changed elsewhere` prompts in the app

Do not block launch on webhook support.

## Testing

## Unit

- Notion property mapper round-trips recipe objects
- tag normalization
- rich-text chunking
- bearer session token helpers

## Integration

- API route tests with mocked Notion client
- create/update/delete/import flows
- first-load offline hard-error path
- cached returning-load offline path

## E2E

- login with access code
- create a recipe, reload another browser context, see it
- edit a recipe, reload another browser context, see it
- delete a recipe, reload another browser context, see it removed
- block writes while offline

## Risks

- Notion is not a high-throughput transactional database
- strict optimistic concurrency is not enforceable with Notion alone
- long-text property limits need careful adapter code
- Notion-side manual edits can drift from app expectations unless the schema is kept disciplined

## Future Exit Strategy

Store app-owned IDs and keep the API contract stable.

That way, if Notion becomes a bottleneck, the backend can later swap to Postgres without forcing a frontend rewrite.

## Final Recommendation

Ship shared persistence for this repo as:

- single-family, single-data-source Notion backend
- same-origin serverless API in front of Notion
- access-code login exchanged for a 24-hour scoped bearer token
- local snapshot cache for offline read only
- no request-level journal abstraction beyond the dormant `JOURNAL_PREFIX`
- no client-side Notion secrets
- no seed fallback after cutover

This is the smallest concrete design that makes the app shared across profiles and devices while staying aligned with the current repo and Notion’s actual constraints.
