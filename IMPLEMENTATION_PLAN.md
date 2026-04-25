# Implementation Plan

Updated: 2026-04-19
Project: `recipe-tracker`

## Current status

The app has already shipped the major UX and frontend quality work that older planning notes treated as missing:

- anticipatory UX and local preference persistence
- tactile microinteractions
- mobile-readiness refinements
- regression coverage for the current UI
- Notion photo backfill logic
- Notion `Cuisine` select mapping
- backup workflow validation and fail-fast config checks
- data-integrity hardening for sync dedupe, replay safety, and date validation
- session-token auth alignment and JSON body-size enforcement

The remaining work is now mostly operational, not architectural.

## Phase 1 - Production image backfill

Status: Blocked on live access

### Goal
- Run the already-shipped sync/backfill logic against production so live recipes with missing photos get updated in Notion.

### Milestones
- Trigger live sync from the deployed app.
- Verify several formerly missing-photo recipes in Notion.
- Recount live missing-image rows and capture before/after totals.

### Owner
- Dave for live execution and verification
- Codex for follow-up debugging if production behavior diverges

### Exit criteria
- Live missing-image count drops from the current `40 / 187`, or the remaining set is confirmed to be true source-data gaps.

## Phase 2 - Completed hardening work

Status: Completed 2026-04-19

### Delivered
- No-URL sync/import dedupe now uses fallback matching.
- Queued remote writes no longer replay already-applied operations after partial failure.
- Invalid recipe dates are rejected before Notion writes.
- Browser client now exchanges the family access code for a scoped session token and uses bearer auth for `/api` routes.
- Oversized JSON payloads now fail with `413 PAYLOAD_TOO_LARGE`.

### Verification
- `npm run test:unit`
- `npm run test:integration`
- `npx playwright test tests/e2e/remote.spec.js`

## Phase 3 - Backup activation

Status: Blocked on secrets

### Goal
- Move the repaired backup workflow from configuration-valid to fully operational.

### Milestones
- Set `NOTION_ACCESS_TOKEN`
- Set `NOTION_DATA_SOURCE_ID`
- Set destination-specific backup secrets if using `blob` or `s3`
- Run `Nightly Notion backup` manually and verify completion

### Owner
- Dave for GitHub secret provisioning
- Codex for any workflow follow-up

## Phase 4 - Documentation cleanup

Status: In progress

### Goal
- Keep repo documentation aligned with the shipped codebase and the real remaining blockers.

### Milestones
- Refresh `AUDIT.md`
- Keep `implementation_plan.txt` current as the working plan
- Decide whether to keep, archive, or remove `10-active-projects/recipes-2026-04`

### Owner
- Codex for repo docs
- Dave for workspace retention decision

## Next action order

1. Run production sync/backfill and verify Notion photos.
2. Configure GitHub backup secrets and execute the backup workflow.
3. Resolve the old snapshot retention decision.
