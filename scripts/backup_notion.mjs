#!/usr/bin/env node
// D9: Continuous backup of the Notion recipe database to durable non-git
// storage. Runs nightly via GitHub Actions (.github/workflows/backup.yml).
//
// Destination is pluggable via env:
//   BACKUP_DESTINATION=local   -> writes to ./backups/YYYY-MM-DD.json
//   BACKUP_DESTINATION=s3      -> writes to s3://$BACKUP_BUCKET/YYYY-MM-DD.json
//   BACKUP_DESTINATION=blob    -> writes to Vercel Blob (placeholder)
//
// Rationale for non-git storage (not a git branch):
//   - the public repo should never hold family data
//   - a forked repo would replicate the backup with the data
//   - retention + versioning are native to S3/R2/Blob

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { queryAllRecipes } from '../src/server/notion-api.js';
import { log } from '../src/server/logger.js';

const now = new Date();
const stamp = now.toISOString().slice(0, 10); // YYYY-MM-DD
const filename = `recipes-${stamp}.json`;

const main = async () => {
  const recipes = await queryAllRecipes();
  const payload = {
    schemaVersion: 4,
    exportedAt: now.toISOString(),
    source: 'notion-backup',
    count: recipes.length,
    recipes,
  };
  const body = JSON.stringify(payload, null, 2);

  const destination = (process.env.BACKUP_DESTINATION || 'local').toLowerCase();
  switch (destination) {
    case 'local': {
      const dir = process.env.BACKUP_LOCAL_DIR || './backups';
      mkdirSync(dir, { recursive: true });
      const path = join(dir, filename);
      writeFileSync(path, body + '\n', 'utf8');
      log.info('backup.wrote', { destination, path, count: recipes.length, bytes: body.length });
      return;
    }
    case 's3': {
      const bucket = process.env.BACKUP_BUCKET;
      if (!bucket) throw new Error('Missing BACKUP_BUCKET for s3 destination');
      // AWS SDK import kept lazy so local runs don't require the dep.
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: process.env.BACKUP_REGION || 'us-east-1',
        // Credentials via standard AWS env (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
        // or IAM role on the runner.
      });
      const key = `${process.env.BACKUP_PREFIX || 'recipes'}/${filename}`;
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json; charset=utf-8',
      }));
      log.info('backup.wrote', { destination, bucket, key, count: recipes.length, bytes: body.length });
      return;
    }
    case 'blob': {
      // Vercel Blob SDK, lazy imported.
      const { put } = await import('@vercel/blob');
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (!token) throw new Error('Missing BLOB_READ_WRITE_TOKEN for blob destination');
      const blob = await put(filename, body, {
        access: 'private',
        contentType: 'application/json',
        token,
      });
      log.info('backup.wrote', { destination, url: blob.url, count: recipes.length, bytes: body.length });
      return;
    }
    default:
      throw new Error(`Unknown BACKUP_DESTINATION: ${destination}`);
  }
};

main().catch((err) => {
  log.error('backup.failed', { destination: process.env.BACKUP_DESTINATION || 'local' }, err);
  process.exit(1);
});
