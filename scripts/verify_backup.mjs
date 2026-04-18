#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { verifyBackupPayload } from '../src/server/backup.js';

const [, , filePath] = process.argv;

if (!filePath) {
  console.error('Usage: node scripts/verify_backup.mjs ./backups/latest.json');
  process.exit(1);
}

const raw = await readFile(filePath, 'utf8');
const payload = JSON.parse(raw);
const summary = verifyBackupPayload(payload);

console.log(
  JSON.stringify(
    {
      file: filePath,
      ...summary,
    },
    null,
    2
  )
);
