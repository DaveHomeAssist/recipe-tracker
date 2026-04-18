# Custom Tagging System Spec

## Purpose

Replace the current comma-separated `recipe.tags` string with a first-class tagging system that supports:

- user-created tags
- consistent normalization and deduplication
- tag suggestions during recipe editing
- tag-based filtering in the library
- safe import/export and schema migration

This spec is written against the current app state:

- recipes are stored locally in `index.html`
- search and render currently consume `recipe.tags` as a plain string
- import validation currently accepts `tags` as a plain string in `src/recipe-schema.js`
- card and view rendering currently split tags with `String.split(',')`

## Goals

- Make tags a real domain object with stable identity.
- Let users create tags inline while adding or editing a recipe.
- Prevent accidental duplicates like `Quick`, `quick`, and ` quick `.
- Preserve backward compatibility with legacy exports that only contain `tags` as a string.
- Keep the implementation simple enough for the current no-backend, localStorage-first architecture.

## Non-goals

- Nested tags or hierarchies
- Shared cloud sync
- Per-tag permissions
- Automatic NLP tag generation
- Arbitrary custom colors in v1

## Current Problem

Today the app treats tags as a single text field:

- storage: `recipe.tags = "pasta, quick, date night"`
- render: split on commas at display time
- search: raw string match against the serialized tag text
- import: validator accepts a string and stores it unchanged

This creates predictable failure modes:

- duplicate tags with different casing or spacing
- no safe rename or delete operation across recipes
- no first-class tag filter state
- no place to store tag metadata
- import/export cannot distinguish canonical tags from free text

## Proposed Domain Model

Introduce a top-level tag catalog and recipe tag references.

### Tag

```js
{
  id: "tag_01J...",
  slug: "date-night",
  label: "Date Night",
  archived: false,
  createdAt: "2026-04-16T12:00:00.000Z",
  updatedAt: "2026-04-16T12:00:00.000Z"
}
```

### Recipe

```js
{
  id: "recipe_...",
  name: "Cacio e Pepe",
  // existing fields...
  tagIds: ["tag_01A", "tag_01B"]
}
```

### App state

Local app state becomes:

```js
{
  recipes: Recipe[],
  tags: Tag[]
}
```

`recipe.tags` becomes deprecated. It should not be the source of truth after migration.

## Storage

Keep recipes and tags in separate localStorage keys so each domain can evolve independently.

- `recipe_journal_v3`: recipes array, now with `tagIds`
- `recipe_journal_tags_v1`: tag catalog
- `recipe_journal_schema_version`: bump from `4` to `5`

If the implementation prefers one combined persisted object, that is acceptable, but the exported JSON format must still include both `recipes` and `tags`.

## Canonicalization Rules

Canonicalization must be deterministic and shared by create, import, migration, and search.

### Label rules

- trim leading and trailing whitespace
- collapse internal runs of whitespace to a single space
- preserve user-facing casing in `label`
- minimum length: 1
- maximum length: 24

### Slug rules

- derive from normalized label
- lowercase
- replace `&` with `and`
- replace any non-alphanumeric run with `-`
- collapse repeated `-`
- trim leading and trailing `-`

Examples:

- `Date Night` -> `date-night`
- `  quick  ` -> `quick`
- `Kid-Friendly` -> `kid-friendly`
- `Fish & Chips` -> `fish-and-chips`

### Uniqueness

- `slug` is the uniqueness boundary
- only one active tag may exist per slug
- creating `Quick` when `quick` already exists selects the existing tag instead of creating a second tag

## Limits

- max tags per recipe: `12`
- max total tags in library: `300`
- max tag label length: `24`

If a user or import exceeds a limit, fail the specific operation with a toast or validation error. Do not silently truncate tag lists.

## UI Spec

## 1. Add/Edit Recipe

Replace the single `#f-tags` comma-separated textbox with a tokenized input.

Behavior:

- existing assigned tags render as removable chips
- typing shows matching existing tags by prefix or substring
- `Enter`, `Tab`, or comma confirms the highlighted suggestion
- if there is no exact slug match, the entered text becomes a new tag
- selecting an existing tag does not duplicate it on the recipe
- backspace on empty input removes the last selected tag chip

Validation:

- empty submissions do nothing
- duplicate selections are ignored
- over-limit shows inline error

Accessibility:

- implement as a combobox with listbox semantics
- every removable chip has an accessible name like `Remove tag Date Night`
- keyboard-only flow must support create, select, and remove

## 2. Card UI

- card footer still shows at most 3 tag chips
- chips display canonical tag labels, not raw IDs
- if a recipe has more than 3 tags, show `+N` as the final chip

Example:

- `Quick`
- `Vegetarian`
- `Weeknight`
- `+2`

## 3. View Modal

- show all assigned tags as chips
- chip order uses the recipe’s stored `tagIds` order

## 4. Library Filtering

Add first-class tag filtering without replacing the existing cuisine filter.

Behavior:

- add a `Tags` control near search/filter controls
- opening the control shows all active tags with recipe counts
- selecting tags applies an `OR` match within tags
- tag filters combine with cuisine and text search via `AND`

Example:

- cuisine = `Italian`
- selected tags = `Quick`, `Weeknight`
- search = `lemon`

Result:

- recipes must be Italian
- and match `lemon` text search
- and contain at least one selected tag

Display:

- active tag filters render as removable chips near the search bar
- archived tags never appear in the picker by default

## 5. Tag Management

Add a lightweight `Manage Tags` surface. This can be a modal, sheet, or dedicated panel.

Required operations:

- rename tag
- archive tag
- unarchive tag
- delete tag

Rules:

- renaming a tag updates only the tag record, not every recipe payload
- archiving keeps the tag on existing recipes but hides it from create/filter suggestions unless explicitly viewing archived tags
- deleting a tag removes its `id` from all recipes after confirmation

Deletion confirmation copy must include the number of affected recipes.

## Data Access Boundaries

Add a dedicated tag module instead of spreading normalization logic through `index.html`.

Recommended modules:

- `src/tag-model.js`
- `src/tag-store.js`

`src/tag-model.js` responsibilities:

- normalize label
- create slug
- create tag records
- map `tagIds` to tag labels
- parse legacy comma-separated tags

`src/tag-store.js` responsibilities:

- create, rename, archive, delete tags
- assign and unassign tags on recipes
- resolve imported tags against the local catalog

UI code in `index.html` should call these helpers instead of building tag logic inline.

## Migration

Schema bump: `4 -> 5`

On first load of schema v5:

1. Load recipes from existing storage.
2. For each recipe, parse legacy `recipe.tags` using comma split.
3. Normalize each parsed label.
4. Build a unique tag catalog keyed by slug.
5. Replace each recipe’s `tags` string with `tagIds`.
6. Persist migrated recipes and the new tag catalog.
7. Mark schema version `5`.

Migration notes:

- empty or invalid tag fragments are dropped
- duplicate labels on the same recipe collapse to one tag
- recipe tag order preserves first appearance from the legacy string

Legacy examples:

- `" quick, Quick , weeknight "` -> `["quick", "weeknight"]`
- `""` -> `[]`
- `"main,, dinner"` -> `["main", "dinner"]`

## Search Behavior

Search must continue matching tag labels, but through the catalog rather than raw string fields.

Implementation rule:

- derive a search haystack from resolved tag labels
- do not depend on deprecated `recipe.tags`

## Import/Export Spec

## Export format

New export format:

```json
{
  "schemaVersion": 5,
  "exportedAt": "2026-04-16T12:00:00.000Z",
  "tags": [
    {
      "id": "tag_01A",
      "slug": "quick",
      "label": "Quick",
      "archived": false,
      "createdAt": "2026-04-16T12:00:00.000Z",
      "updatedAt": "2026-04-16T12:00:00.000Z"
    }
  ],
  "recipes": [
    {
      "id": "recipe_01A",
      "name": "Cacio e Pepe",
      "tagIds": ["tag_01A"]
    }
  ]
}
```

## Import compatibility

The importer must accept both:

- legacy exports with `recipe.tags` string and no top-level `tags`
- v5 exports with top-level `tags` and recipe `tagIds`

Import rules:

- merge tags by `slug`, not by imported `id`
- remap imported `tagIds` to local tag IDs after slug resolution
- if a v5 recipe references a missing tag ID, drop that reference and continue
- if a legacy record contains `tags`, promote them into the catalog during import

`src/recipe-schema.js` should evolve to validate:

- top-level `tags` array when present
- `recipe.tagIds` as an array of strings when present
- legacy `recipe.tags` string for backward compatibility

## Conflict Rules

These rules prevent imports and local edits from creating inconsistent state.

- Tag merge identity is `slug`.
- Recipe tag assignment identity is tag `id`.
- Renaming a tag changes `label` and `slug`, but keeps `id`.
- If a rename collides with an existing slug, the UI must block it and surface a clear error.
- Deleting a tag removes it from all recipes in one transaction before persist.

## Rendering Rules

- all rendered tag labels must be escaped with the existing escaping pipeline
- IDs and slugs are never shown to users
- archived tags still render on recipes that already reference them

## Testing

## Unit tests

Add tests for:

- label normalization
- slug generation
- duplicate prevention by slug
- legacy tag parsing
- migration from `tags` string to `tagIds`
- import tag remapping by slug
- rename collision rejection
- delete removes references from recipes

## Integration tests

Add tests for:

- card rendering resolves `tagIds` to labels
- search matches resolved tag labels
- filter returns recipes matching selected tags
- archived tags do not appear in picker results

## E2E tests

Add tests for:

- create a brand-new tag from the add/edit form
- assign an existing tag to another recipe
- filter library by one tag and by multiple tags
- rename a tag and verify all recipes reflect the new label
- delete a tag and verify it disappears from recipes
- import a legacy file with `tags` strings and verify migration on import

## Rollout Plan

### Phase 1

- add tag model and migration
- preserve current display using resolved labels
- keep existing search behavior working through adapters

### Phase 2

- replace `#f-tags` with tokenized tag picker
- add tag filter UI

### Phase 3

- add tag management surface
- add import/export v5 support
- add full test coverage

## Open Decisions

These need a product call before implementation starts:

- Should archived tags be visible in the recipe form when editing an older recipe that still uses them.
- Should tag filter matching be `OR` only, or should the UI also support `match all selected tags`.
- Should there be a small fixed color palette in v1, or should chips stay visually neutral.

## Implementation split: MVP now / Full domain later

This spec describes the end-state design. It is explicitly **deferred architecture** — the full catalog, `tagIds`, combobox, and management UI should not be built until a shared backend exists (see `NOTION_BACKEND_SPEC.md`). Building a client-only tag catalog in localStorage and then migrating it to a server-backed source of truth is double work.

### MVP (implement now, no schema bump needed)

Normalize tags at write time and import time. Keep `recipe.tags` as a comma-separated string.

1. **Normalize on write.** When saving a recipe (add, edit, import), process the `tags` field:
   - split on commas
   - trim each fragment
   - collapse internal whitespace runs to a single space
   - title-case each fragment (`quick` → `Quick`, `DATE NIGHT` → `Date Night`)
   - deduplicate case-insensitively per recipe (keep the first occurrence)
   - drop empty fragments
   - rejoin with `, `
2. **Normalize on import.** Apply the same function inside `validateRecipe` in `src/recipe-schema.js`.
3. **Normalize the existing seed.** Run the normalizer across the 187 inlined recipes once so the shipped corpus is clean from first load.
4. **No schema bump.** Storage shape does not change. Export format does not change. `tags` remains a string.

This fixes: duplicate casing, inconsistent whitespace, trailing commas, and import inconsistency. It does not fix: rename across recipes, tag-based filtering, or archive/delete.

### Full domain (implement after shared persistence)

Everything in this spec above the "Implementation split" heading is the target architecture for when the backend exists:

- top-level tag catalog with `id`, `slug`, `label`, `archived`
- `recipe.tagIds` replaces `recipe.tags` as the stored relationship
- tokenized combobox in the add/edit form
- tag filter picker in the library UI
- tag management surface (rename, archive, delete with cascade)
- export/import evolution to v5 with top-level `tags` array
- schema migration `5` from string tags to `tagIds`

These should be implemented server-side from the start, as domain objects in the Postgres schema, not as a temporary localStorage-only catalog.

### Sequencing

```
now           →  shared persistence  →  full tagging
MVP normalize    backend + API          catalog, tagIds, combobox,
on write/import  (SHARED_PERSISTENCE)   filter picker, management UI
```

## Recommendation

For now: ship the MVP normalizer (~20 lines in a pure function, called from persist and validateRecipe). It is cheap, safe, and immediately improves data quality without architectural commitment.

For later: this spec is the target. Implement it inside the shared backend, not on top of localStorage.
