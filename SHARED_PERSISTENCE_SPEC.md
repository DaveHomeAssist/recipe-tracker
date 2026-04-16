# Shared Persistence Spec

## Purpose

Make recipe changes persist across devices, browser profiles, and family members.

Today the app stores recipes only in browser `localStorage`, so each device/profile has its own independent copy. This spec replaces that model with a shared remote source of truth while preserving the current static frontend and offline-friendly UX.

## Recommendation

Build a small REST API backed by Postgres and keep the frontend mostly static.

Recommended stack for this repo:

- frontend: current static app on GitHub Pages or Vercel
- backend: small serverless API
- database: Postgres
- auth: simple shared family access token for MVP, real user auth later

If you want the cleanest hosted path, Supabase is the fastest fit:

- Postgres included
- auth available when needed
- REST/Edge Functions possible
- easy local-to-hosted progression

## Goals

- One shared recipe library across all instances and profiles
- Minimal disruption to the current frontend architecture
- Safe create/edit/delete/import behavior with server validation
- Offline read support after initial sync
- Clear migration path from local-only storage

## Non-goals

- Multi-family tenancy in v1
- Rich collaborative presence
- Full CRDT or operational transform syncing
- Complex per-user permissions

## Current State

Current persistence model:

- recipes load from `localStorage` key `recipe_journal_v3`
- updates call `persist()` in [index.html](/Users/daverobertson/Documents/Claude/Projects/Recipe%20Tracker/index.html:390)
- export/import JSON is the only cross-device sync mechanism
- service worker caches the app shell, not shared data

Current consequence:

- deleting a recipe on one device does not affect another device or profile

## Target Model

Move to this ownership model:

- source of truth: remote database
- session cache: in-memory client state
- offline cache: local snapshot for read fallback only
- mutation path: client -> API -> database -> updated client state

`localStorage` should stop being the primary database. It can remain as a cache layer.

## Data Model

The current recipe shape is already close to usable. Add a few fields required for shared sync.

### Recipe

```json
{
  "id": "recipe_01J...",
  "journalId": "journal_family_01",
  "name": "Cacio e Pepe",
  "cuisine": "Italian",
  "source": "Trattoria",
  "location": "Rome",
  "ingredients": "pecorino\nblack pepper",
  "instructions": "toss with starchy water",
  "preptime": "10 min",
  "cooktime": "20 min",
  "servings": "2",
  "tags": "pasta, classic",
  "notes": "family favorite",
  "url": "https://example.com",
  "image": "https://example.com/hero.jpg",
  "date": "2026-04-16",
  "rating": 5,
  "createdAt": "2026-04-16T12:00:00.000Z",
  "updatedAt": "2026-04-16T12:00:00.000Z",
  "deletedAt": null,
  "version": 1
}
```

### Journal

```json
{
  "id": "journal_family_01",
  "name": "Robertson Family Recipes",
  "createdAt": "2026-04-16T12:00:00.000Z",
  "updatedAt": "2026-04-16T12:00:00.000Z"
}
```

## Database Schema

Minimum schema:

### `journals`

- `id` text primary key
- `name` text not null
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

### `recipes`

- `id` text primary key
- `journal_id` text not null references `journals(id)`
- current recipe content fields
- `created_at` timestamptz not null
- `updated_at` timestamptz not null
- `deleted_at` timestamptz null
- `version` integer not null default `1`

Indexes:

- `recipes(journal_id, deleted_at)`
- `recipes(journal_id, updated_at desc)`
- optional unique index on `(journal_id, lower(url)) where url <> '' and deleted_at is null`

Use soft delete in v1. It makes accidental deletes recoverable and simplifies undo semantics.

## API Design

Style: REST, JSON, `/api/v1`

The app only needs a small contract.

### `GET /api/v1/journals/:journalId/recipes`

Returns the current active library.

Response `200`:

```json
{
  "data": [
    {
      "id": "recipe_01",
      "name": "Cacio e Pepe",
      "version": 3,
      "updatedAt": "2026-04-16T12:00:00.000Z"
    }
  ],
  "meta": {
    "journalId": "journal_family_01",
    "serverTime": "2026-04-16T12:00:00.000Z"
  }
}
```

### `POST /api/v1/journals/:journalId/recipes`

Creates a recipe.

Request:

```json
{
  "name": "Cacio e Pepe",
  "cuisine": "Italian",
  "tags": "pasta, classic"
}
```

Response `201`:

```json
{
  "data": {
    "id": "recipe_01",
    "version": 1,
    "createdAt": "2026-04-16T12:00:00.000Z",
    "updatedAt": "2026-04-16T12:00:00.000Z"
  }
}
```

### `PATCH /api/v1/journals/:journalId/recipes/:id`

Partially updates a recipe.

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
    "id": "recipe_01",
    "version": 4,
    "updatedAt": "2026-04-16T12:05:00.000Z"
  }
}
```

### `DELETE /api/v1/journals/:journalId/recipes/:id`

Soft deletes a recipe.

Request:

```json
{
  "version": 4
}
```

Response `204`

### `POST /api/v1/journals/:journalId/import`

Imports a wrapped export or bare recipe array.

Request:

```json
{
  "mode": "merge",
  "payload": {
    "schemaVersion": 4,
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

## Error Contract

All non-2xx responses use:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "The recipe was updated on another device.",
    "details": [],
    "requestId": "req_123"
  }
}
```

Primary error codes:

- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `VALIDATION_FAILED`
- `VERSION_CONFLICT`
- `IMPORT_INVALID`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

## Authentication

### MVP

Use one shared family journal token.

Client configuration:

- `API_BASE_URL`
- `JOURNAL_ID`
- `JOURNAL_TOKEN`

Client sends:

```http
Authorization: Bearer <JOURNAL_TOKEN>
```

This is not strong security, but it is enough for a private family app if the token is not embedded in a public repo.

### Later

Upgrade to user auth with shared journal membership:

- email magic links or passwordless auth
- one `journal_members` table
- role support if needed

## Conflict Handling

Use optimistic concurrency with `version`.

Rules:

- every recipe row has an integer `version`
- client includes current `version` on update/delete
- server rejects stale writes with `409 VERSION_CONFLICT`
- client reloads the server version and asks the user to retry

This is better than silent last-write-wins and still simple to implement.

## Client Architecture Changes

Do not keep all persistence logic inside `index.html`.

Add these modules:

- `src/recipe-api.js`
- `src/recipe-store.js`
- `src/recipe-cache.js`

### `src/recipe-api.js`

Responsibilities:

- fetch recipes from server
- create recipe
- update recipe
- delete recipe
- import library
- normalize error handling

### `src/recipe-store.js`

Responsibilities:

- own in-memory recipe state
- expose async actions to the UI
- coordinate optimistic UI updates
- recover from version conflicts
- keep render calls isolated from transport details

### `src/recipe-cache.js`

Responsibilities:

- read/write local snapshot cache
- track `lastSyncedAt`
- provide offline fallback data

## Client Behavior

### Initial load

1. Load cached snapshot from local storage if available.
2. Render immediately from cache or seeded data.
3. Fetch remote recipes.
4. Replace in-memory state with server data.
5. Update local snapshot cache.

### Create/update/delete

1. User acts in UI.
2. Store sends API request.
3. On success, store commits server-returned record and re-renders.
4. On failure, show toast and revert optimistic state if needed.

### Offline mode

For MVP:

- allow offline read from cache
- block writes while offline
- show `Offline: changes cannot be saved right now`

Do not build queued offline writes in v1. That adds substantial conflict complexity.

## Service Worker Changes

Keep the service worker focused on app shell caching.

Do:

- cache static assets
- optionally cache the latest successful recipes `GET` response for faster warm loads

Do not:

- cache mutation requests
- invent background sync for writes in v1

If API responses are cached, they must respect auth boundaries and be keyed carefully.

## Migration Plan

Migrate in phases.

### Phase 1: Shared backend

- create `journals` and `recipes` tables
- build API endpoints
- seed one shared family journal
- import the current 187 recipes into the database

### Phase 2: Client adapter

- add `recipe-api.js`, `recipe-store.js`, `recipe-cache.js`
- switch `loadRecipes()` to read cache + remote fetch
- switch `persist()` callsites to async store actions

### Phase 3: Import/export parity

- keep existing JSON export
- route import through backend
- preserve current validation rules on server and client

### Phase 4: Hardening

- add auth beyond shared token
- add conflict UI
- add soft-delete recovery surface

## Seeding and Backfill

Initial remote seed should come from one canonical export generated from the current app state, not by trusting arbitrary device localStorage.

Recommended procedure:

1. Load the current production library.
2. Export JSON.
3. Validate through the same schema validator.
4. Insert into the new shared journal.
5. Freeze that as the initial source of truth.

## Security Requirements

- never trust browser payloads; validate on server
- reuse the same whitelist model as `src/recipe-schema.js`
- only allow `http(s)` URLs
- require auth on every API route
- rate limit import and write endpoints
- do not expose the shared journal token in public client-side source if the app remains publicly hosted

That last point matters: if the frontend is a public static site, any embedded bearer token is effectively public. If you want real protection, you need actual user auth or a private deployment.

## Deployment Options

### Option A: Static frontend + hosted API

Best fit for the current repo.

- keep frontend static
- deploy API separately
- easiest migration

### Option B: Move app and API into one full-stack deployment

- simpler auth and environment handling
- larger refactor

For this codebase, Option A is the better first move.

## Testing

### Unit

- API client request/response handling
- store conflict recovery
- cache fallback behavior

### Integration

- load from cache, then refresh from remote
- create/update/delete with mocked API
- version conflict rollback

### E2E

- edit on device A, reload on device B, see update
- delete on device A, reload on device B, see removal
- offline load from cached snapshot
- offline write blocked with visible error

## Open Decisions

- whether MVP auth is acceptable as a shared token or must start with real accounts
- whether cross-device changes need realtime push or reload-based consistency is enough
- whether deletes should remain undo-only locally or also support server-side restore

## Final Recommendation

Implement shared persistence as:

- static frontend retained
- small REST API
- Postgres as source of truth
- optimistic concurrency via `version`
- local snapshot cache for offline read-only fallback
- shared family token only if you accept weak security, otherwise start with real auth

That is the smallest architecture that makes your mom’s delete show up for your dad reliably across devices and profiles without overbuilding the app.
