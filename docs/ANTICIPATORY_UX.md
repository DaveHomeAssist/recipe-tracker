# Recipe Journal anticipatory UX

## Problem

Returning readers currently repeat the work of finding the recipe or filtered view they were using. Existing feedback is uneven across the public library and inspector.

## Outcome

Help a reader continue a recent recipe or search with explicit, dismissible suggestions stored only in the current browser. Give key controls immediate feedback under 200 ms without making motion decorative or necessary for understanding.

## Smallest useful slice

- Show one dismissible Continue card for the most recently opened recipe.
- Suggest matching recipe titles alongside recent searches.
- Restore the library scroll position on the same device.
- Persist only recipe IDs, search and filter state, scroll position and timestamps.
- Add consistent hover, press, success, error and reduced-motion states.

## Exclusions

- No backend profile, analytics, cross-device synchronization or behavioral scoring.
- No storage of family codes, authentication tokens, grocery data, names, health data or network identity.
- No automatic inspector opening, cuisine selection or recipe ranking.
- No drag interaction until the product has a real reorderable surface.

## Acceptance

- A reopened library can continue a recent recipe, dismiss the suggestion and restore a saved scroll position.
- Search suggestions come only from local recipe titles and recent successful searches.
- Family readers can use safe local preferences without storing or gaining edit credentials.
- Public embedded and anonymous reader modes ignore existing family preferences and credentials.
- Phone, iPad and desktop layouts have no horizontal overflow and retain 44 px controls.
- All new motion is 180 ms or less and becomes effectively immediate under reduced motion.
- Recipe-only printing, inspector Back behavior and the anonymous edit boundary remain unchanged.
