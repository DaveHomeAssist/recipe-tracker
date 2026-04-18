# Security Model — Recipe Tracker

Written 2026-04-16 for the Phase D Notion backend. Scope: single-family deployment, static frontend on GitHub Pages, serverless API backed by a private Notion database.

## Threat model (in scope)

| Actor | Capability | Mitigation |
|---|---|---|
| Public internet | Read any client-bundled asset | No secrets in client bundle (D7 audit test). Access code gates all writes. |
| Stolen session token | Full write access until expiry | 24-hour session window. Scoped bearer token stored in `localStorage`. Access code required for a fresh session. |
| Malicious import file | Corrupt local data, attempt XSS | Schema validation at both client and server (`validateRecipe`/`validateImport`). `escapeHtml` on every `innerHTML` sink. `safeUrl` on every `href`/`src`. |
| Leaked Notion PAT | Full read/write of the family journal | PAT lives only in serverless env vars. Build-time audit test (`tests/unit/pat-audit.test.js`) fails if the PAT pattern appears in any client-facing file. |
| Cross-origin browser write | Third-party site tries to call the API from an untrusted origin | CORS allowlist reflects only explicit origins and rejects mismatches with `403 CORS_FORBIDDEN`. |
| Timing side-channel on access code | Character-by-character brute force | Access code comparison uses `crypto.timingSafeEqual` (`api/v1/session.js`). Session HMAC signature uses the same. |
| Notion rate limit (3 req/s per integration) | Degraded UX; write failures | Exponential backoff + Retry-After respect in `src/server/notion-api.js`. Max retries configurable via `RATE_LIMIT_RETRY_MAX`. |

## Threat model (out of scope)

- Targeted compromise of a family member's device (physical access, OS compromise)
- Notion itself being compromised (upstream trust assumption)
- DDoS against the serverless endpoint (Vercel/Cloudflare tier limits are our first defense)
- Multi-tenant isolation — v1 is explicitly single-family, no `journalId` routing on requests (`JOURNAL_PREFIX` is a dormant constant, not a live authz boundary)

## Session token

- **Storage:** `localStorage` key `recipe_journal_session`.
- **Shape:** `{ token, expiresAt, issuedAt, scope }`.
- **Transport:** `Authorization: Bearer <token>` on every authenticated API call.
- **Signed:** HMAC-SHA256 over a base64url-encoded JSON payload `{familyAccess, scope, exp, iat}`. Secret is `SESSION_SECRET` env var.
- **Scope:** `recipe_journal`.
- **Lifetime:** 24 hours from issue. No silent renewal — the user re-enters the access code to get a fresh token.
- **Rotation:** Every successful `POST /api/v1/session` issues a new token and overwrites the stored one.
- **Revocation:** `DELETE /api/v1/session` is client-driven logout only. There is no server-side denylist — if the `SESSION_SECRET` rotates, all existing tokens become invalid.
- **Tradeoff:** This token is intentionally JS-accessible because D4 chose `localStorage`, not cookies. If an XSS lands, the token can be exfiltrated. We accept that risk for this small family deployment and mitigate it with aggressive output escaping, URL sanitization, schema validation, a 24-hour expiry, and no client-side Notion secret.

## Access code

- Single shared code per family, configured via `FAMILY_ACCESS_CODE` env var.
- Never stored in the client bundle.
- Compared in constant time against the stored value.
- Rotation procedure: set a new value in Vercel/Cloudflare env, redeploy, tell the family the new code. All existing sessions survive until their 24-hour expiry.

## CORS

- `ALLOWED_ORIGINS` env var is a comma-separated list.
- Server reflects the request's `Origin` header only if it exactly matches an entry.
- `Access-Control-Allow-Headers: Authorization, Content-Type`.
- `Vary: Origin` always paired when CORS headers are emitted.
- Never uses `*`. Empty allowlist → no CORS headers emitted and no cross-origin rejection logic runs (same-origin deploy path).
- When an allowlist exists and the request `Origin` is not present in it, the API returns `403 CORS_FORBIDDEN`.
- Legacy singular `ALLOWED_ORIGIN` is honored for backward compatibility.

## Input validation

- Every write route calls `validateRecipe` or `validateImport` from `src/recipe-schema.js` (same module client uses — defense in depth, no drift).
- Unknown fields are stripped. `javascript:`/`data:` URLs are coerced to empty string. Rating clamped to 0–5. Strings truncated at 100 KB. Imports capped at 10,000 recipes. `name` is required or the record is dropped.

## Backup and rollback

- **D9 (implemented in repo):** `.github/workflows/backup.yml` runs `scripts/backup_notion.mjs` nightly and immediately verifies the exported payload via `scripts/verify_backup.mjs`.
- Destination stays non-git storage (`BACKUP_DESTINATION=blob|s3`) so family data never lands in the public repo. `local` mode is only for smoke tests and artifact inspection.
- This still must be provisioned in the real repo and verified against the chosen storage target before any Phase M migration writes occur.
- **Rollback path** from `MIGRATION_ROLLBACK.md`: flip `APP_CONFIG.syncMode = 'local'`, redeploy. The local 187-recipe seed and any unsaved localStorage data resume.

## What we do NOT promise

- Strict optimistic locking. Notion pages are not conditional transactions; two devices editing the same recipe in the same second can race. We mitigate with `version` fields and a last-write-wins + server-timestamp check UI (planned in Phase R per `MULTI_DEVICE_POLICY.md`).
- Offline writes. Phase R goes online-only for mutations. The cached snapshot is read-only when the backend is unreachable.
- Multi-family tenancy. Spinning up a second journal requires flipping the `resolveDataSourceId` helper from single-env-var to a map — intentional 20-line change, not silently supported.

## Reporting

No public reporting channel — this is a family app. Security concerns go directly to Dave Robertson.
