import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadQueue, saveQueue, clearQueue,
  loadVersions, saveVersions,
  enqueuePut, pendingCount, pendingStores,
  pushQueue, pullAll,
} from '../../src/stores-remote.js';

function makeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    _raw: () => Object.fromEntries(data),
  };
}

function makeFakeApi({ serverVersions = {}, serverPayloads = {}, failStore = null, conflictStore = null } = {}) {
  const calls = [];
  return {
    calls,
    getStore: async (store) => {
      calls.push({ op: 'get', store });
      if (failStore === store) throw Object.assign(new Error('net'), { status: 0, code: 'NETWORK_ERROR' });
      if (!(store in serverVersions)) {
        const err = new Error('not found');
        err.status = 404;
        throw err;
      }
      return { store, version: serverVersions[store], payload: serverPayloads[store] };
    },
    putStore: async (store, { version, payload }) => {
      calls.push({ op: 'put', store, version, payload });
      if (failStore === store) throw Object.assign(new Error('net'), { status: 0, code: 'NETWORK_ERROR' });
      if (conflictStore === store) {
        const err = new Error('conflict');
        err.status = 409;
        err.details = { data: { store, version: serverVersions[store] ?? 7, payload: serverPayloads[store] ?? { srv: true } } };
        throw err;
      }
      const nextVersion = (serverVersions[store] ?? 0) + 1;
      serverVersions[store] = nextVersion;
      serverPayloads[store] = payload;
      return { store, version: nextVersion };
    },
  };
}

describe('stores-remote — queue', () => {
  let storage;
  beforeEach(() => { storage = makeStorage(); });

  it('starts empty', () => {
    expect(loadQueue(storage)).toEqual([]);
    expect(pendingCount(storage)).toBe(0);
    expect(pendingStores(storage)).toEqual([]);
  });

  it('enqueuePut dedupes per store', () => {
    enqueuePut('meal_plan', { a: 1 }, storage);
    enqueuePut('meal_plan', { a: 2 }, storage);
    enqueuePut('pantry', { p: 1 }, storage);
    const q = loadQueue(storage);
    expect(q).toHaveLength(2);
    const mp = q.find((e) => e.store === 'meal_plan');
    expect(mp.payload).toEqual({ a: 2 });
    expect(pendingStores(storage).sort()).toEqual(['meal_plan', 'pantry']);
  });

  it('rejects unknown stores silently', () => {
    enqueuePut('weird_store', { x: 1 }, storage);
    expect(loadQueue(storage)).toEqual([]);
  });

  it('clearQueue empties storage', () => {
    enqueuePut('pantry', { p: 1 }, storage);
    clearQueue(storage);
    expect(loadQueue(storage)).toEqual([]);
  });

  it('loadVersions / saveVersions round-trip', () => {
    saveVersions({ meal_plan: 3 }, storage);
    expect(loadVersions(storage)).toEqual({ meal_plan: 3 });
  });
});

describe('stores-remote — pushQueue', () => {
  let storage;
  beforeEach(() => { storage = makeStorage(); });

  it('drains queue on success and bumps versions', async () => {
    const api = makeFakeApi();
    enqueuePut('meal_plan', { e: 1 }, storage);
    enqueuePut('pantry', { p: 1 }, storage);
    const r = await pushQueue(api, { storage });
    expect(r.pushed.map((p) => p.store).sort()).toEqual(['meal_plan', 'pantry']);
    expect(loadQueue(storage)).toEqual([]);
    expect(loadVersions(storage).meal_plan).toBe(1);
  });

  it('stops on network error and leaves queue intact', async () => {
    const api = makeFakeApi({ failStore: 'pantry' });
    enqueuePut('meal_plan', { e: 1 }, storage);
    enqueuePut('pantry', { p: 1 }, storage);
    const r = await pushQueue(api, { storage });
    // meal_plan succeeded, pantry failed, subsequent entries would also remain
    expect(r.pushed.map((p) => p.store)).toEqual(['meal_plan']);
    expect(r.errors[0].store).toBe('pantry');
    expect(loadQueue(storage).map((e) => e.store)).toEqual(['pantry']);
  });

  it('uses resolveConflict on 409 and retries', async () => {
    const api = makeFakeApi({
      conflictStore: 'meal_plan',
      serverVersions: { meal_plan: 5 },
      serverPayloads: { meal_plan: { srv: 'v5' } },
    });
    enqueuePut('meal_plan', { local: 'mine' }, storage);
    const resolveConflict = async (_store, localPayload, serverPayload) => {
      // Merge: union-by-key.
      return { ...serverPayload, ...localPayload, merged: true };
    };
    // Rig the fake api to succeed on the retry.
    api.putStore = (async (orig) => {
      let callCount = 0;
      return async (store, params) => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('conflict');
          err.status = 409;
          err.details = { data: { store, version: 5, payload: { srv: 'v5' } } };
          throw err;
        }
        // Retry succeeds
        return { store, version: 6 };
      };
    })();
    api.putStore = await api.putStore;
    const r = await pushQueue(api, { storage, resolveConflict });
    expect(r.pushed).toHaveLength(1);
    expect(r.pushed[0].resolved).toBe(true);
    expect(loadQueue(storage)).toEqual([]);
  });

  it('drops 4xx non-409 errors', async () => {
    const api = {
      putStore: async () => {
        const e = new Error('bad');
        e.status = 400;
        throw e;
      },
    };
    enqueuePut('meal_plan', { e: 1 }, storage);
    const r = await pushQueue(api, { storage });
    expect(r.errors[0].status).toBe(400);
    // Dropped — queue now empty.
    expect(loadQueue(storage)).toEqual([]);
  });
});

describe('stores-remote — pullAll', () => {
  let storage;
  beforeEach(() => { storage = makeStorage(); });

  it('applies server state for all existing stores', async () => {
    const api = makeFakeApi({
      serverVersions: { meal_plan: 2, pantry: 4 },
      serverPayloads: { meal_plan: { e: 'srv' }, pantry: { p: 'srv' } },
    });
    const applied = [];
    const r = await pullAll(api, (store, data) => applied.push({ store, data }), { storage });
    expect(r.pulled.map((p) => p.store).sort()).toEqual(['meal_plan', 'pantry']);
    expect(applied.find((a) => a.store === 'meal_plan').data.version).toBe(2);
    expect(loadVersions(storage)).toEqual({ meal_plan: 2, pantry: 4 });
  });

  it('silently ignores 404 stores', async () => {
    const api = makeFakeApi({ serverVersions: { meal_plan: 1 }, serverPayloads: { meal_plan: {} } });
    const r = await pullAll(api, () => {}, { storage });
    expect(r.pulled.map((p) => p.store)).toEqual(['meal_plan']);
    expect(r.errors).toEqual([]);
  });
});
