#!/usr/bin/env node
// Parse Firefox Netscape bookmark export and emit a JSON array of
// { url, title, folder, addDate } for everything inside the "Recipes" folder.
//
// Usage: node scripts/parse-bookmarks.js <path-to-bookmarks.html> > bookmarks.json

const fs = require('fs');

const path = process.argv[2];
if (!path) {
  console.error('usage: parse-bookmarks.js <bookmarks.html>');
  process.exit(1);
}
const html = fs.readFileSync(path, 'utf8');

// Tokenize into <H3>…</H3>, <A …>…</A>, <DL>, </DL> events in document order.
const tokenRe = /<H3[^>]*>([^<]*)<\/H3>|<A\s+([^>]*)>([^<]*)<\/A>|<DL><p>|<\/DL>/gi;
const stack = []; // folder names, deepest last
const out = [];
let m;
while ((m = tokenRe.exec(html)) !== null) {
  const frag = m[0];
  if (/^<H3/i.test(frag)) {
    // Next <DL> will open that folder; push a pending marker.
    stack.push({ name: m[1].trim(), pending: true });
  } else if (/^<DL/i.test(frag)) {
    // Activate the most recent pending folder, if any.
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].pending) { stack[i].pending = false; break; }
    }
  } else if (/^<\/DL>/i.test(frag)) {
    // Close the deepest active folder.
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!stack[i].pending) { stack.splice(i, 1); break; }
    }
  } else if (/^<A/i.test(frag)) {
    const attrs = m[2];
    const title = m[3].trim();
    const hrefMatch = attrs.match(/HREF="([^"]+)"/i);
    const dateMatch = attrs.match(/ADD_DATE="(\d+)"/i);
    if (!hrefMatch) continue;
    const folderPath = stack.filter(f => !f.pending).map(f => f.name);
    // Only keep links whose folder path includes "Recipes".
    if (!folderPath.some(n => /^Recipes$/i.test(n))) continue;
    out.push({
      url: hrefMatch[1],
      title,
      folder: folderPath.join(' / '),
      addDate: dateMatch ? Number(dateMatch[1]) : null,
    });
  }
}

// Dedupe by URL, keep first occurrence.
const seen = new Set();
const deduped = out.filter(r => {
  if (seen.has(r.url)) return false;
  seen.add(r.url);
  return true;
});

process.stdout.write(JSON.stringify(deduped, null, 2) + '\n');
console.error(`parsed ${deduped.length} unique recipe links (from ${out.length} total)`);
