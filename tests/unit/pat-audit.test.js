// D7: fail the build if a Notion PAT pattern leaks into anything served to
// the browser. This is defense in depth — the PAT lives only in serverless
// env vars, but this guards against an accidental hardcoded token or env
// var interpolation into a client-facing file.
//
// Notion PATs match: `secret_` followed by ~43 chars of URL-safe alphabet,
// or the newer `ntn_` prefix. Both are worth catching.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

// Files the browser can load: HTML, client-side JS modules, manifests,
// service worker, favicon, root README. NOT api/, NOT src/server/,
// NOT .env*, NOT tests/, NOT node_modules/, NOT scripts/.
const CLIENT_FACING_PATHS = [
  'index.html',
  'manifest.webmanifest',
  'service-worker.js',
  'favicon.svg',
];

const CLIENT_DIRS = ['src'];
const SERVER_ONLY_DIRS_IN_SRC = ['server']; // src/server/ is server-only, skip it

// Notion PAT patterns
// - legacy: `secret_` + 43 chars from [A-Za-z0-9]
// - new:    `ntn_`    + 43+ chars from URL-safe base64-ish alphabet
const PAT_PATTERNS = [
  /\bsecret_[A-Za-z0-9]{43}\b/,
  /\bntn_[A-Za-z0-9_-]{40,}\b/,
];

const walkClientFiles = () => {
  const files = [];
  for (const p of CLIENT_FACING_PATHS) {
    const full = join(REPO_ROOT, p);
    try { if (statSync(full).isFile()) files.push(full); } catch {}
  }
  for (const dir of CLIENT_DIRS) {
    const full = join(REPO_ROOT, dir);
    try { statSync(full); } catch { continue; }
    const stack = [full];
    while (stack.length) {
      const cur = stack.pop();
      for (const entry of readdirSync(cur, { withFileTypes: true })) {
        const childPath = join(cur, entry.name);
        if (entry.isDirectory()) {
          // Skip server-only subdirectory
          if (cur === full && SERVER_ONLY_DIRS_IN_SRC.includes(entry.name)) continue;
          stack.push(childPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = extname(entry.name);
        if (['.js', '.mjs', '.html', '.css', '.json', '.svg'].includes(ext)) {
          files.push(childPath);
        }
      }
    }
  }
  return files;
};

describe('Notion PAT leak audit', () => {
  const clientFiles = walkClientFiles();

  it('enumerates at least one client-facing file (sanity check)', () => {
    expect(clientFiles.length).toBeGreaterThan(0);
  });

  it.each(clientFiles)('no Notion PAT pattern in %s', (filePath) => {
    const content = readFileSync(filePath, 'utf8');
    for (const pattern of PAT_PATTERNS) {
      const match = content.match(pattern);
      expect(
        match,
        `Potential Notion PAT leak in ${filePath}: ${match ? match[0].slice(0, 20) + '...' : ''}`
      ).toBeNull();
    }
  });

  it('server files are excluded from the walk (server may legitimately reference env var names)', () => {
    const serverFile = clientFiles.find((f) => f.includes('/src/server/'));
    expect(serverFile).toBeUndefined();
  });
});
