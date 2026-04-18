import { validateImport } from '../recipe-schema.js';

export const BACKUP_SCHEMA_VERSION = 4;

export const buildBackupPayload = (recipes, now = new Date()) => {
  const normalizedRecipes = Array.isArray(recipes) ? recipes : [];
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    source: 'notion-backup',
    count: normalizedRecipes.length,
    recipes: normalizedRecipes,
  };
};

export const verifyBackupPayload = (payload) => {
  const validated = validateImport(payload);
  if (!validated.ok) {
    const error = new Error(`Backup file rejected: ${validated.error}`);
    error.code = 'BACKUP_INVALID';
    throw error;
  }

  if (validated.dropped > 0) {
    const error = new Error(`Backup contains ${validated.dropped} invalid recipe rows`);
    error.code = 'BACKUP_INVALID';
    throw error;
  }

  const declaredCount = Number(payload?.count);
  if (Number.isFinite(declaredCount) && declaredCount !== validated.recipes.length) {
    const error = new Error(
      `Backup count mismatch: declared ${declaredCount}, validated ${validated.recipes.length}`
    );
    error.code = 'BACKUP_COUNT_MISMATCH';
    throw error;
  }

  return {
    ok: true,
    total: validated.total,
    restorableCount: validated.recipes.length,
    dropped: validated.dropped,
    exportedAt: typeof payload?.exportedAt === 'string' ? payload.exportedAt : '',
    source: typeof payload?.source === 'string' ? payload.source : '',
  };
};
