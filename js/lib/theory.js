// Pure music-theory helpers. No DOM, no guitar specifics.
// Pitch classes are integers 0–11 with C = 0.

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Keys offered in pickers, using the spelling most guitarists expect.
export const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

export const mod12 = (n) => ((n % 12) + 12) % 12;

export function pitchClass(name) {
  const letter = name[0].toUpperCase();
  let pc = LETTER_PC[letter];
  for (const ch of name.slice(1)) {
    if (ch === '#' || ch === '♯') pc++;
    if (ch === 'b' || ch === '♭') pc--;
  }
  return mod12(pc);
}

/** 'b3' → { num: 3, acc: -1 }, '#11' → { num: 11, acc: 1 } */
export function parseDegree(token) {
  const m = /^([b#]*)(\d+)$/.exec(token);
  if (!m) throw new Error(`Bad degree: ${token}`);
  const acc = [...m[1]].reduce((a, c) => a + (c === '#' ? 1 : -1), 0);
  return { num: +m[2], acc };
}

/** Semitones above the root for a degree token: '3' → 4, 'b7' → 10, '#11' → 6 */
export function degreeSemitones(token) {
  const { num, acc } = parseDegree(token);
  return mod12(MAJOR_STEPS[(num - 1) % 7] + acc);
}

/** Spell a degree from a root with correct letter: spellDegree('A', 'b3') → 'C', ('Eb', '3') → 'G' */
export function spellDegree(rootName, token) {
  const { num } = parseDegree(token);
  const rootPc = pitchClass(rootName);
  const pc = mod12(rootPc + degreeSemitones(token));
  const letter = LETTERS[(LETTERS.indexOf(rootName[0].toUpperCase()) + num - 1) % 7];
  let diff = mod12(pc - LETTER_PC[letter]);
  if (diff > 6) diff -= 12;
  if (Math.abs(diff) > 2) return SHARP_NAMES[pc];
  return letter + (diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff));
}

// ---------------------------------------------------------------------------
// Scales
//
// degrees  – the scale written as degree tokens (intervals are derived)
// compare  – default scale to compare against in "show changes"
// signature – the degrees that give the scale its colour
// mood     – one-line description shown in the UI
// ---------------------------------------------------------------------------

const S = (name, degrees, extra) => ({ name, degrees, intervals: degrees.map(degreeSemitones), ...extra });

export const SCALES = {
  // Modes of the major scale, brightest → darkest.
  lydian: S('Lydian', ['1', '2', '3', '#4', '5', '6', '7'], {
    compare: 'major',
    signature: ['#4'],
    mood: 'Dreamy and floating, a little sci-fi. The ♯4 is the magic.',
  }),
  major: S('Major', ['1', '2', '3', '4', '5', '6', '7'], {
    compare: 'minor',
    signature: ['3', '7'],
    mood: 'Bright, resolved, home. (Ionian mode.)',
  }),
  mixolydian: S('Mixolydian', ['1', '2', '3', '4', '5', '6', 'b7'], {
    compare: 'major',
    signature: ['b7'],
    mood: 'Major with swagger. The ♭7 gives it a bluesy rock edge.',
  }),
  dorian: S('Dorian', ['1', '2', 'b3', '4', '5', '6', 'b7'], {
    compare: 'minor',
    signature: ['6'],
    mood: 'Minor but hopeful. The natural 6 lifts it; funk and fusion live here.',
  }),
  minor: S('Natural minor', ['1', '2', 'b3', '4', '5', 'b6', 'b7'], {
    compare: 'major',
    signature: ['b3', 'b6'],
    mood: 'Sad, serious, cinematic. (Aeolian mode.)',
  }),
  phrygian: S('Phrygian', ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'], {
    compare: 'minor',
    signature: ['b2'],
    mood: 'Dark and Spanish-tinged. The ♭2 leans right on the root.',
  }),
  locrian: S('Locrian', ['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7'], {
    compare: 'minor',
    signature: ['b5'],
    mood: 'Unstable and tense. With a ♭5 there’s no solid home chord.',
  }),

  // Pentatonic & blues
  majorPentatonic: S('Major pentatonic', ['1', '2', '3', '5', '6'], {
    compare: 'minorPentatonic',
    signature: [],
    mood: 'Open, singable, country-ish. Major without the half steps.',
  }),
  minorPentatonic: S('Minor pentatonic', ['1', 'b3', '4', '5', 'b7'], {
    compare: 'majorPentatonic',
    signature: [],
    mood: 'The rock & blues workhorse.',
  }),
  blues: S('Blues', ['1', 'b3', '4', 'b5', '5', 'b7'], {
    compare: 'minorPentatonic',
    signature: ['b5'],
    mood: 'Minor pentatonic plus the ♭5 “blue note”. Bend it, don’t sit on it.',
  }),

  // Minor family
  harmonicMinor: S('Harmonic minor', ['1', '2', 'b3', '4', '5', 'b6', '7'], {
    compare: 'minor',
    signature: ['7'],
    mood: 'Minor with a leading tone. Neoclassical shred and old-world drama.',
  }),
  melodicMinor: S('Melodic minor', ['1', '2', 'b3', '4', '5', '6', '7'], {
    compare: 'minor',
    signature: ['6', '7'],
    mood: '“Jazz minor”: smooth and sophisticated, parent of many fusion sounds.',
  }),

  // Jazz & fusion colours
  lydianDominant: S('Lydian dominant', ['1', '2', '3', '#4', '5', '6', 'b7'], {
    compare: 'mixolydian',
    signature: ['#4', 'b7'],
    mood: 'Bright and bluesy at once. Great over 7th chords that don’t resolve.',
  }),
  phrygianDominant: S('Phrygian dominant', ['1', 'b2', '3', '4', '5', 'b6', 'b7'], {
    compare: 'phrygian',
    signature: ['b2', '3'],
    mood: 'Flamenco, surf and metal: ♭2 with a major 3rd.',
  }),
  altered: S('Altered', ['1', 'b9', '#9', '3', 'b5', 'b13', 'b7'], {
    compare: 'mixolydian',
    signature: ['b9', '#9', 'b5', 'b13'],
    mood: 'Every tension at once over a dominant chord. Resolve it!',
  }),
  dimHalfWhole: S('Diminished (half-whole)', ['1', 'b9', '#9', '3', '#11', '5', '13', 'b7'], {
    compare: 'mixolydian',
    signature: ['b9', '#9', '#11'],
    mood: 'Symmetrical tension over 7♭9 chords. The pattern repeats every 3 frets.',
  }),
  wholeTone: S('Whole tone', ['1', '2', '3', '#4', '#5', 'b7'], {
    compare: 'mixolydian',
    signature: ['#4', '#5'],
    mood: 'Weightless and dreamlike: every step is the same size.',
  }),
};

// Derived fields every scale gets.
for (const sc of Object.values(SCALES)) {
  const has = (t) => sc.degrees.includes(t);
  sc.family = sc.intervals.includes(4) ? 'major' : 'minor';
  const third = sc.degrees.find((d) => parseDegree(d).num === 3);
  const fifth = has('5') ? '5' : sc.degrees.find((d) => parseDegree(d).num === 5);
  const seventh = sc.degrees.find((d) => parseDegree(d).num === 7);
  sc.triad = ['1', third, fifth].filter(Boolean).map(degreeSemitones);
  sc.seventh = [...sc.triad, ...(seventh ? [degreeSemitones(seventh)] : [])];
}

export const MODE_LADDER = ['lydian', 'major', 'mixolydian', 'dorian', 'minor', 'phrygian', 'locrian'];

export const SCALE_GROUPS = [
  { label: 'Modes (bright → dark)', ids: MODE_LADDER },
  { label: 'Pentatonic & blues', ids: ['majorPentatonic', 'minorPentatonic', 'blues'] },
  { label: 'Minor family', ids: ['harmonicMinor', 'melodicMinor'] },
  { label: 'Jazz & fusion', ids: ['lydianDominant', 'phrygianDominant', 'altered', 'dimHalfWhole', 'wholeTone'] },
];

/** Map of pitch class → { pc, name, degree, interval } for a scale in a key. */
export function spellScale(keyName, scaleId) {
  const scale = SCALES[scaleId];
  const rootPc = pitchClass(keyName);
  const map = new Map();
  scale.degrees.forEach((degree, i) => {
    const pc = mod12(rootPc + scale.intervals[i]);
    map.set(pc, { pc, name: spellDegree(keyName, degree), degree, interval: scale.intervals[i] });
  });
  return map;
}

export function noteName(pc, preferFlats = false) {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

/** Pretty accidentals for display: 'Bb' → 'B♭', 'b3' → '♭3', 'F#' → 'F♯'. */
export function pretty(s) {
  return String(s)
    .replace(/#/g, '♯')
    .replace(/b(?=\d)/g, '♭') // degrees & alterations: b3, 7b9
    .replace(/([A-G])b/g, '$1♭') // note names: Bb, Ebmaj7
    .replace(/b♭|♭b/g, '♭♭'); // double flats: bb7, Bbb
}
