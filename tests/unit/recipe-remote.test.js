import { beforeEach, describe, expect, it } from 'vitest';

import {
  bootstrapRemoteRecipes,
  clearRemoteWriteQueue,
  deleteRemoteRecipe,
  loadRemoteWriteQueue,
  replayQueuedRemoteWrites,
  saveRemoteRecipe,
} from '../../src/recipe-remote.js';

describe('recipe remote fallback and replay', () => {
  beforeEach(() => {
    const store = new Map();
    const fakeStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: fakeStorage,
      configurable: true,
      writable: true,
    });
    clearRemoteWriteQueue();
  });

  it('falls back to local recipes when the network is down', async () => {
    const api = {
      getRecipes: async () => {
        throw { code: 'NETWORK_ERROR' };
      },
    };

    const state = await bootstrapRemoteRecipes({
      api,
      fallback: {
        recipes: [{ id: 'recipe_1', name: 'Soup' }],
        tagRegistry: {},
        fetchedAt: '2026-04-19T00:00:00.000Z',
      },
    });

    expect(state.offline).toBe(true);
    expect(state.recipes).toEqual([{ id: 'recipe_1', name: 'Soup' }]);
  });

  it('queues an upsert when a save fails offline', async () => {
    const api = {
      createRecipe: async () => {
        throw { code: 'NETWORK_ERROR' };
      },
    };

    const result = await saveRemoteRecipe({
      api,
      recipe: { id: 'recipe_1', name: 'Soup', tags: [] },
      previous: null,
    });

    expect(result.offline).toBe(true);
    expect(loadRemoteWriteQueue()).toMatchObject([
      {
        id: 'recipe_1',
        op: 'upsert',
      },
    ]);
  });

  it('drops a queued create when the same local-only recipe is deleted before replay', async () => {
    const api = {
      createRecipe: async () => {
        throw { code: 'NETWORK_ERROR' };
      },
      deleteRecipe: async () => {
        throw { code: 'NETWORK_ERROR' };
      },
    };

    await saveRemoteRecipe({
      api,
      recipe: { id: 'recipe_1', name: 'Soup', tags: [] },
      previous: null,
    });
    await deleteRemoteRecipe({
      api,
      recipe: { id: 'recipe_1', name: 'Soup', version: 1 },
    });

    expect(loadRemoteWriteQueue()).toEqual([]);
  });

  it('replays queued writes in order and clears the queue', async () => {
    const created = [];
    const api = {
      createRecipe: async (recipe) => {
        created.push(recipe);
        return recipe;
      },
      updateRecipe: async () => {
        throw new Error('update should not run');
      },
      deleteRecipe: async () => {
        throw new Error('delete should not run');
      },
      getRecipes: async () => created,
    };

    await saveRemoteRecipe({
      api: {
        createRecipe: async () => {
          throw { code: 'NETWORK_ERROR' };
        },
      },
      recipe: { id: 'recipe_1', name: 'Soup', tags: [] },
      previous: null,
    });

    const replay = await replayQueuedRemoteWrites({ api });

    expect(replay.applied).toBe(1);
    expect(created).toEqual([{ id: 'recipe_1', name: 'Soup', tags: [], version: 1 }]);
    expect(loadRemoteWriteQueue()).toEqual([]);
  });
});
