// Chord symbols → chord tones → playable guitar voicings → voice-led progressions.
// Pure functions, no DOM. See tests/chords.test.js for examples.

import { pitchClass, mod12, spellDegree, degreeSemitones, KEYS, FLAT_NAMES } from './theory.js';
import { TUNINGS } from './guitar.js';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * parseChord('Cmaj9') → {
 *   symbol, root: 'C', rootPc, bass: null | 'D', bassPc,
 *   tones: [{ token: '1'|'3'|'b7'|'9'…, pc, name, role: 'root'|'essential'|'optional' }]
 * }
 * Returns null when the symbol can't be understood.
 */
export function parseChord(input) {
  let s = String(input).trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\s+/g, '');
  if (!s) return null;

  let bass = null;
  const slash = /^(.+?)\/([A-Ga-g][#b]?)$/.exec(s); // "6/9" is not a slash chord: bass must be a note
  if (slash) {
    s = slash[1];
    bass = slash[2][0].toUpperCase() + slash[2].slice(1);
  }

  const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(s);
  if (!m) return null;
  const root = m[1].toUpperCase() + m[2];
  const q = parseQuality(m[3]);
  if (!q) return null;

  const rootPc = pitchClass(root);
  const tones = q.map(({ token, role }) => ({
    token,
    role,
    pc: mod12(rootPc + degreeSemitones(token)),
    name: spellDegree(root, token),
  }));

  let bassPc = null;
  if (bass) {
    bassPc = pitchClass(bass);
    if (bassPc === rootPc) {
      bass = null; // "C/C" is just C
      bassPc = null;
    }
  }
  return { symbol: formatSymbol(root, m[3], bass), root, rootPc, bass, bassPc, tones };
}

function formatSymbol(root, quality, bass) {
  return `${root}${quality}${bass ? `/${bass}` : ''}`;
}

// Quality grammar, consumed left to right. Covers common jazz/pop spellings.
function parseQuality(q) {
  const f = { minor: false, dim: false, half: false, aug: false, maj: false, num: 0, six: false, sus: null, alt: false };
  const adds = [];
  const alts = [];
  const omit = new Set();

  const rules = [
    [/^(no|omit)(3|5)/, (x) => omit.add(x[2])],
    [/^(maj|Maj|MAJ|ma|M|Δ|△|\^)/, () => (f.maj = true)],
    [/^(ø|Ø)7?/, () => (f.half = true)],
    [/^(dim|°|o)/, () => (f.dim = true)],
    [/^(min|mi|m|-)/, () => (f.minor = true)],
    [/^(aug|\+)/, () => (f.aug = true)],
    [/^(6\/9|69)/, () => ((f.six = true), adds.push('9'))],
    [/^(13|11|9|7)/, (x) => (f.num = Math.max(f.num, +x[0]))],
    [/^6/, () => (f.six = true)],
    [/^sus(2|4)?/, (x) => (f.sus = x[1] || '4')],
    [/^add([b#]?)(2|4|6|9|11|13)/, (x) => adds.push(x[1] + x[2])],
    [/^alt/, () => (f.alt = true)],
    [/^([b#])(5|9|11|13)/, (x) => alts.push(x[1] + x[2])],
    [/^[(),]/, () => {}],
  ];

  let rest = q;
  while (rest.length) {
    let matched = false;
    for (const [re, fn] of rules) {
      const x = re.exec(rest);
      if (x) {
        fn(x);
        rest = rest.slice(x[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }

  // "maj" alone is a major triad; "mM7" / "m(maj7)" is minor-major.
  const tones = new Map(); // token → role
  tones.set('1', 'root');

  const third = f.sus === '2' ? '2' : f.sus === '4' ? '4' : f.minor || f.dim || f.half ? 'b3' : '3';
  let fifth = f.dim || f.half ? 'b5' : f.aug ? '#5' : '5';
  for (const a of alts) if (a === 'b5' || a === '#5') fifth = a;

  const hasSeventh = f.num >= 7 || f.half || (f.dim && f.num >= 7);
  let seventh = null;
  if (hasSeventh) seventh = f.maj ? '7' : f.dim && !f.half ? 'bb7' : 'b7';

  if (f.alt) {
    // Altered dominant: 3, b7 and the altered tensions; the fifth is replaced by b5/#5.
    tones.set('3', 'essential');
    tones.set('b7', 'essential');
    tones.set('#9', 'essential');
    tones.set('b13', 'optional');
    tones.set('b9', 'optional');
    tones.set('#11', 'optional');
    return [...tones].map(([token, role]) => ({ token, role }));
  }

  // Extensions implied by 9/11/13.
  const ext = [];
  if (f.num >= 9) ext.push('9');
  if (f.num >= 11) ext.push('11');
  if (f.num >= 13) ext.push('13');
  // Altered extensions replace their natural versions.
  const altFor = (n) => alts.find((a) => a.slice(1) === n);
  const extTokens = ext.map((e) => altFor(e) || e);
  const top = extTokens[extTokens.length - 1];

  const isTriad = !hasSeventh && !f.six && !ext.length;
  // Dominant/major 11 chords traditionally drop the 3rd; major/dominant 13 chords drop the 11.
  const drop3 = f.num === 11 && !f.minor && !f.sus;
  const drop11 = f.num === 13 && !f.minor;

  if (!omit.has('3') && !drop3) tones.set(third, 'essential');
  if (!omit.has('5')) tones.set(fifth, fifth !== '5' || isTriad ? 'essential' : 'optional');
  if (seventh) tones.set(seventh, 'essential');
  if (f.six) tones.set('6', 'essential');
  for (const e of extTokens) {
    if (e === '11' && drop11) continue;
    tones.set(e, e === top || e !== e.replace(/^[b#]/, '') ? 'essential' : 'optional');
  }
  for (const a of alts) if (!tones.has(a) && a !== 'b5' && a !== '#5') tones.set(a, 'essential');
  for (const a of adds) tones.set(a, 'essential');
  if (f.dim && f.num >= 7 && !f.half) tones.set('b5', 'essential');
  return [...tones].map(([token, role]) => ({ token, role }));
}

// Interval names for notes outside the chord (e.g. a slash bass).
const GENERIC_TOKENS = ['1', 'b9', '9', 'b3', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'];

/** Label for a pitch class relative to a chord: '1' → 'R', otherwise the chord-tone token. */
export function toneLabel(chord, pc) {
  const t = chord.tones.find((x) => x.pc === pc);
  const token = t ? t.token : GENERIC_TOKENS[mod12(pc - chord.rootPc)];
  return token === '1' ? 'R' : token;
}

/** Role of a pitch class for colouring: root | guide (3rd/7th/6th) | color (extensions) | fifth | bass */
export function toneKind(chord, pc) {
  const t = chord.tones.find((x) => x.pc === pc);
  if (!t) return 'bass';
  if (t.token === '1') return 'root';
  const n = +t.token.replace(/\D/g, '');
  if (n === 3 || n === 7 || n === 6 || t.token === '2' || t.token === '4') return 'guide'; // 2/4 = sus
  if (n === 5) return t.token === '5' ? 'fifth' : 'color';
  return 'color';
}

export function noteNameFor(chord, pc) {
  const t = chord.tones.find((x) => x.pc === pc);
  if (t) return t.name;
  if (chord.bassPc === pc) return chord.bass;
  return spellDegree(chord.root, GENERIC_TOKENS[mod12(pc - chord.rootPc)]);
}

// ---------------------------------------------------------------------------
// Voicing search
// ---------------------------------------------------------------------------

const STRING_NAMES = ['6th', '5th', '4th', '3rd', '2nd', '1st'];

/**
 * All playable voicings for a chord, best first.
 * opts: { bass: 'root' | 'any', allowOpen, maxFret, maxSpan, minNotes, maxNotes }
 * A voicing: { frets: [-1|fret × 6], notes: [{ s, f, midi, pc }], key, score, tags, bassString, center, top }
 */
export function findVoicings(chord, opts = {}) {
  const {
    tuning = TUNINGS.standard,
    bass = 'root',
    allowOpen = true,
    maxFret = 15,
    maxSpan = 3,
    minNotes = 3,
    maxNotes = 6,
  } = opts;
  const strings = tuning.midi.length;
  const allowed = new Set(chord.tones.map((t) => t.pc));
  if (chord.bassPc != null) allowed.add(chord.bassPc);
  const requiredBass = chord.bassPc ?? (bass === 'root' ? chord.rootPc : null);
  const essentials = chord.tones
    .filter((t) => t.role === 'essential' || (t.role === 'root' && (bass === 'root' || chord.bassPc != null)))
    .map((t) => t.pc);
  const optionals = chord.tones.filter((t) => t.role === 'optional' || (t.role === 'root' && bass !== 'root'));

  const found = new Map();
  const frets = new Array(strings).fill(-1);

  for (let p = 1; p <= maxFret; p++) {
    const hi = Math.min(maxFret, p + maxSpan);
    // Candidate frets per string within this window (plus open strings).
    const options = tuning.midi.map((open) => {
      const o = [-1];
      if (allowOpen && allowed.has(mod12(open))) o.push(0);
      for (let f = p; f <= hi; f++) if (allowed.has(mod12(open + f))) o.push(f);
      return o;
    });

    const walk = (s, sounding) => {
      if (s === strings) {
        if (sounding >= minNotes) {
          const v = evaluate(frets, chord, { tuning, essentials, optionals, requiredBass, bass });
          if (v && !found.has(v.key)) found.set(v.key, v);
        }
        return;
      }
      for (const f of options[s]) {
        if (f >= 0) {
          if (sounding >= maxNotes) continue;
          // The first sounding string is the bass.
          if (sounding === 0 && requiredBass != null && mod12(tuning.midi[s] + f) !== requiredBass) continue;
        }
        frets[s] = f;
        walk(s + 1, sounding + (f >= 0 ? 1 : 0));
      }
      frets[s] = -1;
    };
    walk(0, 0);
  }

  return [...found.values()].sort((a, b) => a.score - b.score);
}

function evaluate(frets, chord, { tuning, essentials, optionals, requiredBass, bass }) {
  const notes = [];
  frets.forEach((f, s) => {
    if (f >= 0) notes.push({ s, f, midi: tuning.midi[s] + f, pc: mod12(tuning.midi[s] + f) });
  });
  const n = notes.length;
  const first = notes[0].s;
  const last = notes[n - 1].s;

  // At most one muted string inside the voicing.
  const innerMutes = last - first + 1 - n;
  if (innerMutes > 1) return null;

  // Fingering: ≤ 4 fretted notes, or a barre on the lowest fret.
  const fretted = notes.filter((x) => x.f > 0);
  const minF = fretted.length ? Math.min(...fretted.map((x) => x.f)) : 0;
  const maxF = fretted.length ? Math.max(...fretted.map((x) => x.f)) : 0;
  let barre = false;
  if (fretted.length > 4) {
    const atMin = fretted.filter((x) => x.f === minF);
    const barreFrom = atMin[0].s;
    // Everything above the barre's lowest string must be at/above the barre fret (no open strings under it).
    const ok = notes.every((x) => x.s < barreFrom || x.f >= minF);
    if (!ok || fretted.length - atMin.length + 1 > 4) return null;
    barre = true;
  }

  const pcs = new Set(notes.map((x) => x.pc));
  for (const pc of essentials) if (!pcs.has(pc)) return null;

  // ---- scoring (lower is better) ----
  let score = 0;
  score += Math.abs(n - 4) * (n < 4 ? 0.6 : 0.9);
  score += (n - pcs.size) * 1.0; // doubled notes
  for (const t of optionals) if (!pcs.has(t.pc)) score += t.token === '5' ? 0.15 : t.role === 'root' ? 0 : 0.4;
  score += (maxF - minF) * 0.35;
  score += innerMutes * 0.8;
  const opens = notes.filter((x) => x.f === 0).length;
  score += opens * 0.15;
  if (opens && minF > 4) score += 1.5;
  if (barre) score += 0.4;
  if (minF > 12) score += 0.6;

  // Muddy low intervals.
  if (n >= 2 && notes[1].midi - notes[0].midi < 3 && notes[0].midi < 52) score += 1.2;
  for (let i = 1; i < n; i++) if (notes[i].midi - notes[i - 1].midi === 1 && notes[i - 1].midi < 55) score += 0.6;

  // Colourful top note sings.
  const topTone = chord.tones.find((t) => t.pc === notes[n - 1].pc);
  if (topTone && topTone.token !== '1' && topTone.token !== '5') score -= 0.3;

  // Rootless/inversion mode: prefer guide tones in the bass.
  if (bass !== 'root' && requiredBass == null) {
    const kind = toneKind(chord, notes[0].pc);
    if (kind === 'fifth') score += 0.5;
    if (kind === 'color') score += 0.8;
  }

  const center = fretted.length ? fretted.reduce((a, x) => a + x.f, 0) / fretted.length : 0;
  return {
    frets: [...frets],
    notes,
    key: frets.map((f) => (f < 0 ? 'x' : f)).join('.'),
    score: Math.round(score * 100) / 100,
    bassString: first,
    center,
    minFret: minF,
    maxFret: maxF,
    top: notes[n - 1].midi,
    tags: classify(notes, chord, barre),
  };
}

function classify(notes, chord, barre) {
  const tags = [];
  const midis = notes.map((x) => x.midi);
  const distinct = new Set(notes.map((x) => x.pc)).size;
  const n = notes.length;
  if (n === 4 && distinct === 4) {
    const [a, b, c, d] = midis;
    const closeSpan = (arr) => {
      const s = [...arr].sort((x, y) => x - y);
      return s[s.length - 1] - s[0] < 12;
    };
    if (d - a < 12) tags.push('Close');
    else if (closeSpan([b, c, d, a + 12]) && a + 12 > c) tags.push('Drop 2');
    else if (closeSpan([b, c, d, a + 12]) && a + 12 > b && a + 12 < c) tags.push('Drop 3');
    else if (closeSpan([c, d, a + 12, b + 12])) tags.push('Drop 2 & 4');
    else tags.push('Spread');
  } else if (n === 3) {
    const kinds = notes.map((x) => toneKind(chord, x.pc));
    tags.push(kinds[0] === 'root' && kinds.filter((k) => k === 'guide').length === 2 ? 'Shell' : '3-note');
  } else if (n >= 5) tags.push(barre ? 'Barre' : 'Full');
  else tags.push(`${n}-note`);
  if (chord.bassPc == null && notes[0].pc !== chord.rootPc) tags.push(chord.tones.some((t) => t.pc === notes[0].pc) ? 'Rootless' : 'Inversion');
  return tags;
}

export function bassStringLabel(v, chord) {
  const what = chord.bassPc != null ? 'Bass' : v.notes[0].pc === chord.rootPc ? 'Root' : 'Bass';
  return `${what} on ${STRING_NAMES[v.bassString]} string`;
}

/** Group voicings by bass string, keeping the best `perGroup` of each. */
export function groupByBassString(voicings, perGroup = 6) {
  const groups = new Map();
  for (const v of voicings) {
    const g = groups.get(v.bassString) || [];
    if (g.length < perGroup) g.push(v);
    groups.set(v.bassString, g);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([s, list]) => ({ string: s, list }));
}

// ---------------------------------------------------------------------------
// Progressions
// ---------------------------------------------------------------------------

/** Split "Dm9 | G13 Cmaj9, A7#9" into chord tokens; returns [{ text, chord|null }]. */
export function parseProgression(text) {
  return String(text)
    .split(/[\s|,]+/)
    .filter((t) => t && !/^[-–—]+$/.test(t))
    .map((t) => ({ text: t, chord: parseChord(t) }));
}

const REGIONS = { low: 2.5, mid: 7, high: 11 };

function transitionCost(a, b) {
  const move = Math.abs(a.center - b.center);
  const top = Math.min(7, Math.abs(a.top - b.top));
  // Fingers that can stay put on the same string & fret.
  let stay = 0;
  for (const x of a.notes) if (b.frets[x.s] === x.f && x.f > 0) stay++;
  return move * 0.6 + top * 0.22 - stay * 0.3;
}

/**
 * Pick one voicing per chord so the hand stays close and the top voice moves smoothly.
 * candidates: voicing[][] (per chord), locks: Map<index, voicing key>, region: 'auto'|'low'|'mid'|'high'
 * Returns { path: voicing[], ranked: voicing[][] } — ranked[i] lists chord i's options, best fit first.
 */
export function planProgression(candidates, { locks = new Map(), region = 'auto' } = {}) {
  const N = candidates.length;
  if (!N) return { path: [], ranked: [] };
  const node = (v) => v.score + (REGIONS[region] != null ? Math.abs(v.center - REGIONS[region]) * 0.35 : 0);
  const allowed = (i, v) => !locks.has(i) || locks.get(i) === v.key;

  // Forward and backward passes (raw = without applying chord i's own lock).
  const fwd = [];
  const bwd = [];
  for (let i = 0; i < N; i++) {
    fwd[i] = candidates[i].map((v) => {
      if (i === 0) return node(v);
      let best = Infinity;
      candidates[i - 1].forEach((u, k) => {
        if (!allowed(i - 1, u)) return;
        best = Math.min(best, fwd[i - 1][k] + transitionCost(u, v));
      });
      return node(v) + best;
    });
  }
  for (let i = N - 1; i >= 0; i--) {
    bwd[i] = candidates[i].map((v) => {
      if (i === N - 1) return node(v);
      let best = Infinity;
      candidates[i + 1].forEach((w, k) => {
        if (!allowed(i + 1, w)) return;
        best = Math.min(best, bwd[i + 1][k] + transitionCost(v, w));
      });
      return node(v) + best;
    });
  }

  const ranked = candidates.map((list, i) =>
    list
      .map((v, j) => ({ v, total: fwd[i][j] + bwd[i][j] - node(v) }))
      .filter((x) => Number.isFinite(x.total))
      .sort((a, b) => a.total - b.total)
      .map((x) => x.v),
  );

  // Walk the best path: choose each chord given the previous choice.
  const path = [];
  for (let i = 0; i < N; i++) {
    let best = null;
    let bestCost = Infinity;
    candidates[i].forEach((v, j) => {
      if (!allowed(i, v)) return;
      const cost = (i ? transitionCost(path[i - 1], v) : 0) + bwd[i][j];
      if (cost < bestCost) (bestCost = cost), (best = v);
    });
    path.push(best ?? ranked[i][0] ?? null);
  }
  return { path, ranked };
}

// ---------------------------------------------------------------------------
// Fun: random chords & progressions
// ---------------------------------------------------------------------------

export const PROGRESSIONS = [
  { name: 'ii – V – I', romans: ['ii:m9', 'V:13', 'I:maj9'] },
  { name: 'Minor ii – V – i', romans: ['ii:m7b5', 'V:7b9', 'i:m9'] },
  { name: 'I – vi – ii – V turnaround', romans: ['I:maj7', 'VI:7#9', 'ii:m9', 'V:13'] },
  { name: 'iii – VI – ii – V', romans: ['iii:m7', 'VI:7b13', 'ii:m9', 'V:7alt'] },
  { name: 'Slash-chord lift', romans: ['I:maj9', 'IV/V', 'I:6/9', 'bVII/I'] },
  { name: 'Fusion vamp', romans: ['i:m11', 'bII:maj7#11'] },
  { name: 'Neo-soul cycle', romans: ['IV:maj9', 'iii:m9', 'vi:m11', 'V:9sus4'] },
  { name: 'Backdoor', romans: ['iv:m9', 'bVII:13', 'I:maj9'] },
  { name: 'Lydian float', romans: ['I:maj7#11', 'II/I', 'I:maj9', 'II/I'] },
  { name: 'Tritone sub', romans: ['ii:m9', 'bII:7#11', 'I:6/9'] },
  { name: 'Dorian vamp', romans: ['i:m9', 'IV:13'] },
  { name: 'Coltrane-ish', romans: ['I:maj7', 'bIII:7', 'bVI:maj7', 'VII:7', 'III:maj7', 'V:7', 'I:maj7'] },
];

const ROMAN = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };

const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

function romanRoot(key, roman) {
  const m = /^([b#]?)([ivIV]+)$/.exec(roman);
  const acc = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
  const pc = mod12(pitchClass(key) + ROMAN[m[2].toUpperCase()] + acc);
  // Flat keys and flattened degrees read better with flat names (Gb, not F#).
  return FLAT_KEYS.has(key) || acc < 0 ? FLAT_NAMES[pc] : KEYS[pc];
}

/** Render a roman-numeral template in a key: 'ii:m9' → 'Dm9', 'IV/V' → 'F/G' (in C). */
export function realize(template, key) {
  return template.romans.map((r) => {
    const slash = /^([b#]?[ivIV]+)\/([b#]?[ivIV]+)$/.exec(r);
    if (slash) return `${romanRoot(key, slash[1])}/${romanRoot(key, slash[2])}`;
    const [num, quality = ''] = r.split(':');
    return romanRoot(key, num) + quality;
  });
}

export const CHORD_LIBRARY = [
  { group: 'Major', qualities: ['maj7', '6', 'maj9', '6/9', 'maj7#11', 'add9'] },
  { group: 'Dominant', qualities: ['7', '9', '13', '7b9', '7#9', '7alt', '7sus4', '9sus4', '13#11'] },
  { group: 'Minor', qualities: ['m7', 'm6', 'm9', 'm11', 'm(maj7)', 'm7b5', 'dim7'] },
  { group: 'Slash & sus', qualities: ['sus2', 'sus4', '/2', '/b7'] },
];

/** Symbol for a library quality in a root: '/2' means "triad over the 2nd" (C/D). */
export function librarySymbol(root, quality) {
  if (quality.startsWith('/')) {
    const token = quality.slice(1);
    return `${root}/${spellDegree(root, token === '2' ? '9' : token)}`;
  }
  return root + quality;
}

export function randomChord(rng = Math.random) {
  const group = CHORD_LIBRARY[Math.floor(rng() * CHORD_LIBRARY.length)];
  const q = group.qualities[Math.floor(rng() * group.qualities.length)];
  const root = KEYS[Math.floor(rng() * 12)];
  return librarySymbol(root, q);
}

export function randomProgression(rng = Math.random) {
  const t = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)];
  const key = KEYS[Math.floor(rng() * 12)];
  return { name: t.name, key, chords: realize(t, key) };
}
