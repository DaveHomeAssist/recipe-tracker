// Offline-first sync queue for the three non-recipe stores.
// Pattern mirrors src/recipe-remote.js but simpler because stores are
// single-document (one blob per store, last-write-wins with version).
//
// Responsibilities:
//  - enqueuePut(store, payload) -> marks a pending write in localStorage
//  - pushQueue(api) -> drains pending writes to the server
//  - pullAll(api, apply) -> fetches server-side latest for all three stores
//  - conflict handling: on 409, api returns server {version, payload}; we
//    invoke the provided resolver to merge client+server, then retry.
//
// This module is pure-ish: it operates on any `api` object that implements
// getStore(key) and putStore(key, {version, payload}). Tests pass a fake.

import { STORE_KEYS } from './stores-api.js';

const QUEUE_KEY = 'stores_write_queue_v1';
const VERSION_KEY = 'stores_version_v1'; // tracks the server version we last synced for each store

const getStore = () =>
  globalThis.localStorage &&
  typeof globalThis.localStorage.getItem === 'function' &&
  typeof globalThis.localStorage.setItem === 'function'
    ? globalThis.localStorage
    : null;

export function loadQueue(storage) {
  const s = storage || getStore();
  if (!s) return [];
  try {
    const raw = s.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function saveQueue(queue, storage) {
  const s = storage || getStore();
  if (!s) return queue;
  s.setItem(QUEUE_KEY, JSON.stringify(queue));
  return queue;
}

export function clearQueue(storage) {
  const s = storage || getStore();
  if (!s || typeof s.removeItem !== 'function') return;
  s.removeItem(QUEUE_KEY);
}

export function loadVersions(storage) {
  const s = storage || getStore();
  if (!s) return {};
  try {
    const raw = s.getItem(VERSION_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export function saveVersions(versions, storage) {
  const s = storage || getStore();
  if (!s) return versions;
  s.setItem(VERSION_KEY, JSON.stringify(versions || {}));
  return versions;
}

// ---- Queue operations ----

// Enqueue a write. Dedupe by store: only the most recent payload wins —
// older pending writes for the same store are dropped.
export function enqueuePut(store, payload, storage) {
  if (!STORE_KEYS.includes(store)) return loadQueue(storage);
  const q = loadQueue(storage);
  const filtered = q.filter((e) => e.store !== store);
  filtered.push({
    store,
    payload,
    enqueuedAt: new Date().toISOString(),
  });
  return saveQueue(filtered, storage);
}

export function pendingCount(storage) {
  return loadQueue(storage).length;
}

export function pendingStores(storage) {
  return [...new Set(loadQueue(storage).map((e) => e.store))];
}

// ---- Sync operations ----
// pushQueue drains the queue against the given api.
// On success: removes entry, bumps version.
// On 409 (stale): calls resolveConflict(store, local, server) -> newPayload,
//   then retries with server's version.
// On network error: stops early, leaves remaining entries in queue.
// Returns { pushed: [...], conflicts: [...], errors: [...] }.

export async function pushQueue(api, { storage = null, resolveConflict = null } = {}) {
  const queue = loadQueue(storage);
  const versions = loadVersions(storage);
  const pushed = [];
  const conflicts = [];
  const errors = [];
  const remaining = [];
  let stopped = false;

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    if (stopped) { remaining.push(entry); continue; }
    const localVersion = Number(versions[entry.store]) || 0;
    try {
      const res = await api.putStore(entry.store, {
        version: localVersion,
        payload: entry.payload,
      });
      versions[entry.store] = Number(res?.version) || localVersion + 1;
      pushed.push({ store: entry.store, version: versions[entry.store] });
    } catch (err) {
      if (err?.status === 409 && err?.details) {
        // Server's latest came back as details: { version, payload }
        const server = err.details?.data || err.details;
        if (resolveConflict && server && 'payload' in server) {
          try {
            const merged = await resolveConflict(entry.store, entry.payload, server.payload);
            const res2 = await api.putStore(entry.store, {
              version: Number(server.version) || 0,
              payload: merged,
            });
            versions[entry.store] = Number(res2?.version) || (Number(server.version) + 1);
            pushed.push({ store: entry.store, version: versions[entry.store], resolved: true });
            continue;
          } catch (err2) {
            conflicts.push({ store: entry.store, error: err2.message });
            remaining.push(entry);
            continue;
          }
        }
        conflicts.push({ store: entry.store, server });
        remaining.push(entry);
      } else if (err?.status === 0 || err?.code === 'NETWORK_ERROR') {
        // Stop on first network error so we don't burn through the queue.
        errors.push({ store: entry.store, error: err.message });
        remaining.push(entry);
        stopped = true;
      } else {
        errors.push({ store: entry.store, error: err.message, status: err.status });
        // On 4xx (other than 409), drop the entry — it's likely bad data.
        if (err?.status >= 400 && err?.status < 500 && err?.status !== 409) {
          // Dropped.
        } else {
          remaining.push(entry);
        }
      }
    }
  }

  saveQueue(remaining, storage);
  saveVersions(versions, storage);
  return { pushed, conflicts, errors };
}

// pullAll fetches server state for every store and applies it via the
// provided apply(store, {version, payload}) callback. Silent on any single-
// store 404 (treated as "not yet created on server").
export async function pullAll(api, apply, { storage = null } = {}) {
  const versions = loadVersions(storage);
  const pulled = [];
  const errors = [];
  for (const store of STORE_KEYS) {
    try {
      const data = await api.getStore(store);
      if (!data) continue;
      versions[store] = Number(data.version) || 0;
      if (typeof apply === 'function') apply(store, data);
      pulled.push({ store, version: versions[store] });
    } catch (err) {
      if (err?.status === 404) continue;
      errors.push({ store, error: err.message, status: err.status });
    }
  }
  saveVersions(versions, storage);
  return { pulled, errors };
}
