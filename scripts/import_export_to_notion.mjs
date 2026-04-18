import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { createRecipe } from '../src/server/recipes-service.js';
import { validateImport } from '../src/recipe-schema.js';

const [, , filePath] = process.argv;

if (!filePath) {
  console.error('Usage: node scripts/import_export_to_notion.mjs ./recipe-journal-export.json');
  process.exit(1);
}

const raw = await readFile(filePath, 'utf8');
const payload = JSON.parse(raw);
const validated = validateImport(payload);

if (!validated.ok) {
  console.error(`Import file rejected: ${validated.error}`);
  process.exit(1);
}

let added = 0;
for (const recipe of validated.recipes) {
  await createRecipe(recipe);
  added++;
  if (added % 25 === 0) {
    console.log(`Imported ${added}/${validated.recipes.length} recipes...`);
  }
}

console.log(
  JSON.stringify(
    {
      imported: added,
      dropped: validated.dropped,
      total: validated.total,
    },
    null,
    2
  )
);
