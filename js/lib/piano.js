// Piano chord voicings with smooth voice-leading.
//   default:  left hand = bass note, right hand = 3–4 chord tones voice-led close to the previous chord
//   rootless: left hand = jazz rootless voicing (3-7-9-… style), no root (the bass line has it)

import { mod12 } from './theory.js';

const PRIORITY = (t) => {
  const n = +t.token.replace(/\D/g, '');
  if (t.token === '1') return 9; // root is the bass's job
  if (n === 3 || n === 7 || t.token === 'bb7' || n === 6 || t.token === '2' || t.token === '4') return 1; // guide tones
  if (t.role === 'essential') return 2; // extensions & alterations
  if (n === 5) return 6;
  return 4;
};

/** Pick which pitch classes to voice (max `max`), most important first. */
function pickTones(chord, max, { includeRoot }) {
  const tones = [...chord.tones].sort((a, b) => PRIORITY(a) - PRIORITY(b));
  const out = [];
  for (const t of tones) {
    if (!includeRoot && t.token === '1') continue;
    if (out.length >= max) break;
    out.push(t.pc);
  }
  // Plain triads sound thin without the root.
  if (out.length < 3 && !out.includes(chord.rootPc)) out.push(chord.rootPc);
  return out;
}

/** All close-position stacks of `pcs` whose lowest note lies in [lo, hi]. */
function closeStacks(pcsIn, lo, hi) {
  const pcs = [...new Set(pcsIn)].sort((a, b) => a - b);
  const out = [];
  for (let bottom = lo; bottom <= hi; bottom++) {
    const start = pcs.indexOf(mod12(bottom));
    if (start === -1) continue;
    const notes = [bottom];
    for (let i = 1; i < pcs.length; i++) {
      const pc = pcs[(start + i) % pcs.length];
      let n = notes[notes.length - 1] + 1;
      while (mod12(n) !== pc) n++;
      notes.push(n);
    }
    out.push(notes);
  }
  return out;
}

function movement(a, b) {
  if (!b || !b.length) return 0;
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) d += Math.abs(a[i] - b[i]);
  return d + Math.abs(a.length - b.length) * 2;
}

function best(stacks, prev, center) {
  let pick = stacks[0];
  let cost = Infinity;
  for (const s of stacks) {
    const mean = s.reduce((x, y) => x + y, 0) / s.length;
    const c = movement(s, prev) + Math.abs(mean - center) * 0.35;
    if (c < cost) (cost = c), (pick = s);
  }
  return pick;
}

/**
 * @param chord parsed chord (see chords.js)
 * @param prev  previous result (for voice-leading) or null
 * @returns {{ lh: number[], rh: number[] }} midi notes
 */
export function pianoVoicing(chord, prev = null, { rootless = false } = {}) {
  if (rootless) {
    const pcs = pickTones(chord, 4, { includeRoot: false });
    const lh = best(closeStacks(pcs, 48, 60), prev?.lh, 56);
    return { lh, rh: [] };
  }
  const bassPc = chord.bassPc ?? chord.rootPc;
  let bass = 36 + mod12(bassPc - 0); // C2..B2
  if (bass > 43) bass -= 12; // keep it below G2
  const pcs = pickTones(chord, 4, { includeRoot: false });
  const rh = best(closeStacks(pcs, 52, 66), prev?.rh, 64);
  return { lh: [bass], rh };
}
