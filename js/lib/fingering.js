// Guitar fingering for single-note lines.
// Models the fretting hand as a *position* p: frets p..p+3 (one finger per fret, with a
// one-fret stretch up). A dynamic program chooses positions that minimise shifts; each note
// is then played on the string that fits the position best. Open strings fit any position.

import { TUNINGS } from './guitar.js';

/**
 * @param pitches  midi numbers in playing order
 * @param opts     { lock: fret | null, maxFret, tuning }
 * @returns        [{ s, f, pos } | null] per note (null = out of the guitar's range)
 */
export function fingerMelody(pitches, { lock = null, maxFret = 19, tuning = TUNINGS.standard } = {}) {
  const cands = pitches.map((p) => {
    const out = [];
    tuning.midi.forEach((open, s) => {
      const f = p - open;
      if (f >= 0 && f <= maxFret) out.push({ s, f });
    });
    return out;
  });
  const positions = [];
  for (let p = 1; p <= maxFret - 3; p++) positions.push(p);

  // Cheapest way to play a note in position p (Infinity if it doesn't fit).
  const fitCost = (list, p) => {
    let best = Infinity;
    for (const c of list) {
      let cost;
      if (c.f === 0) cost = 0.15;
      else if (c.f >= p && c.f <= p + 3) cost = 0;
      else if (c.f === p + 4 || c.f === p - 1) cost = 0.9; // stretch
      else continue;
      best = Math.min(best, cost);
    }
    return best;
  };
  // Lower positions are easier to read and reach; the high register costs a little more.
  const posCost = (p) => (lock != null && p !== lock ? 6 : 0) + (p > 9 ? 0.4 : 0) + p * 0.06;
  const shift = (q, p) => (q === p ? 0 : 1.5 + 0.3 * Math.abs(q - p));

  // Viterbi over positions; notes outside the range are skipped.
  const idx = cands.map((l, i) => (l.length ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return pitches.map(() => null);
  let dp = positions.map((p) => fitCost(cands[idx[0]], p) + posCost(p));
  const back = [];
  for (let k = 1; k < idx.length; k++) {
    const list = cands[idx[k]];
    const row = [];
    const ptr = [];
    positions.forEach((p, pi) => {
      const here = fitCost(list, p) + posCost(p);
      let best = Infinity;
      let arg = 0;
      positions.forEach((q, qi) => {
        const v = dp[qi] + shift(q, p);
        if (v < best) (best = v), (arg = qi);
      });
      row[pi] = best + here;
      ptr[pi] = arg;
    });
    dp = row;
    back[k] = ptr;
  }
  // Backtrack positions.
  const pos = new Array(idx.length);
  let pi = dp.indexOf(Math.min(...dp));
  for (let k = idx.length - 1; k >= 0; k--) {
    pos[k] = positions[pi];
    if (k > 0) pi = back[k][pi];
  }

  // Choose the string for each note within its position.
  const result = pitches.map(() => null);
  let prevS = null;
  idx.forEach((i, k) => {
    const p = pos[k];
    const score = (c) => {
      const inPos = c.f === 0 ? 0.15 : c.f >= p && c.f <= p + 3 ? 0 : c.f === p + 4 || c.f === p - 1 ? 0.9 : 10 + Math.abs(c.f - p);
      return inPos + (prevS == null ? 0 : Math.abs(c.s - prevS) * 0.05);
    };
    const c = [...cands[i]].sort((a, b) => score(a) - score(b))[0];
    result[i] = { ...c, pos: p };
    prevS = c.s;
  });
  return result;
}
