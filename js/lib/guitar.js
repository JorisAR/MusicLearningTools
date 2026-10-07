// Guitar-specific data and helpers: tunings, fretboard math, CAGED shapes.
// Strings are indexed low to high: 0 = low E … 5 = high e.

import { mod12 } from './theory.js';

export const TUNINGS = {
  standard: { name: 'Standard', notes: ['E', 'A', 'D', 'G', 'B', 'e'], midi: [40, 45, 50, 55, 59, 64] },
};

export const STRING = { E: 0, A: 1, D: 2, G: 3, B: 4, e: 5 };

// ---------------------------------------------------------------------------
// CAGED shapes
//
// Each shape is defined relative to a root note on its `anchor` string.
// `win` gives, per string (low E → high e), the fret window [lo, hi] relative
// to that root fret. Any scale note inside the window belongs to the shape.
//
// Major and minor versions share the same anchor, so toggling major ↔ minor
// keeps you in the same area of the neck (E shape ↔ Em shape, etc.).
// Tweak these numbers if you prefer different fingerings — everything else
// (pentatonics, labels, playback) derives from them.
// ---------------------------------------------------------------------------

const all = (lo, hi) => Array.from({ length: 6 }, () => [lo, hi]);
const withString = (base, s, range) => base.map((w, i) => (i === s ? range : w));

export const CAGED_ORDER = ['C', 'A', 'G', 'E', 'D']; // ascending the neck

export const CAGED_SHAPES = {
  major: {
    C: { anchor: STRING.A, win: all(-3, 0) },
    A: { anchor: STRING.A, win: withString(all(-1, 2), STRING.B, [0, 3]) },
    G: { anchor: STRING.E, win: all(-4, 0) },
    E: { anchor: STRING.E, win: all(-1, 2) },
    D: { anchor: STRING.D, win: all(-1, 3) },
  },
  minor: {
    C: { anchor: STRING.A, win: all(-3, 1) },
    A: { anchor: STRING.A, win: all(0, 3) },
    G: { anchor: STRING.E, win: withString(all(-3, 0), STRING.B, [-2, 1]) },
    E: { anchor: STRING.E, win: all(-1, 3) },
    D: { anchor: STRING.D, win: all(0, 3) },
  },
};

export function shapeLabel(id, family) {
  return family === 'minor' ? `${id}m` : id;
}

/**
 * All placements of a CAGED shape on the visible neck.
 * Returns [{ id, root, windows: [[lo,hi] × 6], min, max }] with absolute frets.
 */
export function shapeInstances(rootPc, family, id, numFrets, tuning = TUNINGS.standard) {
  const shape = CAGED_SHAPES[family][id];
  const first = mod12(rootPc - tuning.midi[shape.anchor]);
  const out = [];
  // Start an octave low so shapes whose root sits "behind the nut" still show their open-string part.
  for (let r = first - 12; r <= numFrets + 12; r += 12) {
    const windows = shape.win.map(([lo, hi]) => [r + lo, r + hi]);
    const min = Math.min(...windows.map((w) => w[0]));
    const max = Math.max(...windows.map((w) => w[1]));
    // Keep partial shapes at either end of the neck, as long as at least two frets are visible.
    if (max < 1 || min > numFrets - 1) continue;
    out.push({ id, root: r, windows, min: Math.max(0, min), max: Math.min(numFrets, max) });
  }
  return out;
}

export function allShapeInstances(rootPc, family, numFrets, tuning) {
  return CAGED_ORDER.flatMap((id) => shapeInstances(rootPc, family, id, numFrets, tuning)).sort(
    (a, b) => a.min - b.min,
  );
}

export function inInstance(inst, s, f) {
  const [lo, hi] = inst.windows[s];
  return f >= lo && f <= hi;
}

export function midiAt(s, f, tuning = TUNINGS.standard) {
  return tuning.midi[s] + f;
}
