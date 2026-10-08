// Tiny reactive store + Preact hook, and the song store with undo/redo.
// Only the *last* song is cached in the browser (by design: no local library).

import { useEffect, useReducer } from '../vendor/preact-htm.js';
import { normalizeSong } from './model.js';

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? next(state) : next;
      subs.forEach((f) => f(state));
    },
    patch(p) {
      this.set({ ...state, ...p });
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

/** Re-render a component when the store changes (optionally only when `select(state)` changes). */
export function useStore(store, select = (s) => s) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    let last = select(store.get());
    return store.subscribe((s) => {
      const next = select(s);
      if (next !== last) {
        last = next;
        force();
      }
    });
  }, [store]);
  return select(store.get());
}

export const LAST_SONG_KEY = 'mlt-song-last';

export function loadLastSong() {
  try {
    const raw = localStorage.getItem(LAST_SONG_KEY);
    return raw ? normalizeSong(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Song store: { song } with update(fn) that clones, applies fn to the draft, and records undo.
 * Rapid edits with the same `coalesce` key (typing) merge into one undo step.
 */
export function createSongStore(song) {
  const store = createStore({ song, canUndo: false, canRedo: false });
  const past = [];
  const future = [];
  let lastKey = null;
  let lastTime = 0;
  let saveTimer = null;

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(LAST_SONG_KEY, JSON.stringify(store.get().song));
      } catch {}
    }, 300);
  };
  const publish = (s) => {
    store.set({ song: s, canUndo: past.length > 0, canRedo: future.length > 0 });
    save();
  };

  return {
    ...store,
    get song() {
      return store.get().song;
    },
    update(fn, coalesce = null) {
      const now = Date.now();
      const cur = store.get().song;
      const draft = structuredClone(cur);
      fn(draft);
      const next = normalizeSong(draft);
      // Same key within a second (typing) merges into one undo step; 'take:' keys always merge.
      const merge = coalesce && coalesce === lastKey && (now - lastTime < 1000 || coalesce.startsWith('take:'));
      if (!merge) {
        past.push(cur);
        if (past.length > 100) past.shift();
      }
      future.length = 0;
      lastKey = coalesce;
      lastTime = now;
      publish(next);
    },
    replace(song) {
      past.push(store.get().song);
      future.length = 0;
      lastKey = null;
      publish(normalizeSong(song));
    },
    undo() {
      if (!past.length) return;
      future.push(store.get().song);
      lastKey = null;
      publish(past.pop());
    },
    redo() {
      if (!future.length) return;
      past.push(store.get().song);
      lastKey = null;
      publish(future.pop());
    },
  };
}
