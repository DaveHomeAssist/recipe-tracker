#!/usr/bin/env node
// Retry records where extractedFrom === 'none'. Strips the bad records from
// recipes.json, rewrites a bookmarks list for just those, and re-runs the
// main extractor against it with concurrency=1 and longer timeouts.

'use strict';
const fs = require('fs');
const { spawnSync } = require('child_process');

const recipes = JSON.parse(fs.readFileSync('public/recipes.json', 'utf8'));
const failures = recipes.filter(r => r.extractedFrom === 'none');
const keepers = recipes.filter(r => r.extractedFrom !== 'none');
console.error(`retrying ${failures.length} failed records`);

const retryBookmarks = failures.map(r => ({
  url: r.url,
  title: r.bookmarkTitle || r.name,
  folder: r.folder,
  addDate: r.addedAt ? Math.floor(new Date(r.addedAt).getTime() / 1000) : null,
}));

fs.writeFileSync('retry-bookmarks.json', JSON.stringify(retryBookmarks, null, 2));
fs.writeFileSync('public/recipes.json', JSON.stringify(keepers, null, 2) + '\n');

const res = spawnSync('node', [
  'scripts/extract-all.js',
  '--in', 'retry-bookmarks.json',
  '--out', 'public/recipes.json',
  '--concurrency', '1',
], { stdio: 'inherit' });

fs.unlinkSync('retry-bookmarks.json');
process.exit(res.status || 0);
