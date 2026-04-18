# Phase D Deployment Checklist

Use this after the backend hardening work is merged or when validating a preview deployment for `codex/notion-backend`.

## 1. Provision the deployment target

- Link the repo to the correct Vercel project or create a new one for `recipe-tracker`.
- Confirm the production domain/origin that will call the API.
- If GitHub Actions is the backup runner, confirm the repo-level workflow is enabled.

## 2. Set required runtime env vars

### Backend auth and Notion

- `NOTION_ACCESS_TOKEN`
- `NOTION_DATA_SOURCE_ID`
- `FAMILY_ACCESS_CODE`
- `SESSION_SECRET`
- `ALLOWED_ORIGINS`

### Backup destination

Pick one destination:

- Blob:
  - `BACKUP_DESTINATION=blob`
  - `BLOB_READ_WRITE_TOKEN`

- S3:
  - `BACKUP_DESTINATION=s3`
  - `BACKUP_BUCKET`
  - `BACKUP_REGION`
  - `BACKUP_PREFIX` optional
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`

### Optional tuning

- `RATE_LIMIT_RETRY_MAX`
- `RATE_LIMIT_BASE_DELAY_MS`

## 3. Validate live API behavior

Run these checks against the deployed API:

1. `GET /api/v1/health`
   - expect `200`
   - confirm `notion=configured`

2. `POST /api/v1/session`
   - submit the family access code
   - expect JSON with `token`, `issuedAt`, `expiresAt`

3. `GET /api/v1/recipes`
   - send `Authorization: Bearer <token>`
   - expect `200` and recipe list

4. `POST /api/v1/log/client-error`
   - send a sample payload from an allowed origin
   - confirm a `client.error` structured log lands in runtime logs

5. CORS rejection
   - repeat one request from a disallowed browser origin
   - expect `403 CORS_FORBIDDEN`

## 4. Validate backup path

### GitHub Actions path

- Ensure `.github/workflows/backup.yml` is enabled.
- Trigger it manually with `workflow_dispatch`.
- Confirm:
  - `scripts/backup_notion.mjs` succeeds
  - `scripts/verify_backup.mjs backups/latest.json` succeeds
  - non-local destinations receive the exported file

### Restore smoke test

- Download one produced backup artifact or object.
- Run:

```bash
node scripts/verify_backup.mjs /path/to/recipes-YYYY-MM-DD.json
```

- Confirm the payload validates with zero dropped rows.

## 5. Phase gate before migration

Do not start Phase M until all of the following are true:

- API deployment is reachable from the intended frontend origin
- session issuance and authenticated recipe reads work in production
- client-error logs are visible in runtime logs
- one real backup run has succeeded against the chosen storage target
- one backup file has been manually restore-verified

## 6. Immediate next phase after signoff

- Implement `M0` write freeze
- validate canonical export for `M1`
- run import dry run and parity tooling for `M6`
