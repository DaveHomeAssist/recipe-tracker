# Audit - Recipe Tracker

Date: 2026-04-19
Scope: current repo state after data-integrity and session-auth hardening

## Executive assessment

The codebase is in materially better shape than the older audit recorded. The previously noted gaps around image rendering, service-worker absence, mobile readiness, and visual polish are no longer the primary risks. The highest-value remaining issues are operational:

- production image backfill has not yet been run against live data
- the backup workflow is fixed in code but still blocked on missing GitHub secrets
- one workspace cleanup decision is still open for the older local snapshot

## Security and auth

Current state:

- browser auth now uses the session-token flow documented in `SECURITY.md`
- `/api` recipe routes now require bearer-session auth instead of raw family-code headers
- the client stores the scoped session object in `localStorage`
- a one-time legacy family-code migration path remains so existing devices can exchange a stored code for a session and then clear it
- request bodies now enforce a byte limit before JSON parsing and return `413 PAYLOAD_TOO_LARGE` when exceeded

Residual risk:

- sessions remain JS-accessible because this project intentionally uses `localStorage`, not `HttpOnly` cookies
- `src/server/require-family-code.js` still exists as legacy code, though it is no longer the active recipe-route auth path

## Data integrity

Current state:

- sync/import now match no-URL recipes using fallback keys instead of URL-only matching
- queued remote writes are removed from the persisted queue as each write succeeds
- invalid `date` values are rejected before reaching Notion writes

Residual risk:

- production still needs a real sync run to prove the shipped photo backfill behaves correctly against live Notion data

## UX and frontend quality

Current state:

- anticipatory UX features are present
- microinteractions are present
- mobile refinements are present
- image rendering is present
- the remote-mode regression path has browser coverage

Residual risk:

- no new frontend-critical issues were identified in this pass

## Testing and verification

Verified on 2026-04-19:

- `npm run test:unit` -> 131 passed
- `npm run test:integration` -> 43 passed
- `npx playwright test tests/e2e/remote.spec.js` -> 1 passed

## Operational blockers

1. Production image backfill
- Live dataset still shows `40 / 187` recipes without images until a production sync is run and verified.

2. Backup activation
- `.github/workflows/backup.yml` now validates and fails clearly, but it still cannot complete without:
  - `NOTION_ACCESS_TOKEN`
  - `NOTION_DATA_SOURCE_ID`

3. Workspace cleanup
- The older snapshot at `10-active-projects/recipes-2026-04` still needs an explicit keep/archive/remove decision.

## Conclusion

The repo’s main engineering risks have shifted from code correctness to operational execution. The next important work is not another refactor; it is running the live image backfill, provisioning backup secrets, and keeping the remaining docs and workspace inventory consistent with the current source of truth.
