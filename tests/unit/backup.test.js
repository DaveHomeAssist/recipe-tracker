import { describe, expect, it } from 'vitest';

import { BACKUP_SCHEMA_VERSION, buildBackupPayload, verifyBackupPayload } from '../../src/server/backup.js';

describe('backup payloads', () => {
  it('builds a timestamped backup envelope around recipes', () => {
    const now = new Date('2026-04-18T12:00:00.000Z');
    const payload = buildBackupPayload([{ id: '1', name: 'Pasta' }], now);

    expect(payload.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(payload.exportedAt).toBe('2026-04-18T12:00:00.000Z');
    expect(payload.source).toBe('notion-backup');
    expect(payload.count).toBe(1);
    expect(payload.recipes).toHaveLength(1);
  });

  it('verifies a fully restorable backup payload', () => {
    const payload = buildBackupPayload([{
      id: '1',
      name: 'Pasta',
      cuisine: 'Italian',
      ingredients: 'Noodles',
      instructions: 'Boil',
      tags: ['weeknight'],
    }]);

    expect(verifyBackupPayload(payload)).toMatchObject({
      ok: true,
      restorableCount: 1,
      dropped: 0,
      source: 'notion-backup',
    });
  });

  it('fails when the declared count does not match the validated rows', () => {
    const payload = {
      ...buildBackupPayload([{ id: '1', name: 'Pasta' }]),
      count: 2,
    };

    expect(() => verifyBackupPayload(payload)).toThrow(/count mismatch/i);
  });

  it('fails when any recipe row is invalid', () => {
    const payload = buildBackupPayload([{ id: '1', cuisine: 'Italian' }]);

    expect(() => verifyBackupPayload(payload)).toThrow(/invalid recipe rows/i);
  });
});
