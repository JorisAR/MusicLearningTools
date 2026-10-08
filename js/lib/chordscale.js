// Chord-scale suggestions: which scale fits over a chord, given the song's key.
// Dm9 in C → D Dorian, Bø7 → B Locrian, G7alt → G Altered, Fmaj7 in C → F Lydian …

import { SCALES, MODE_LADDER, pitchClass, mod12, pretty } from './theory.js';
import { chordQuality } from './chords.js';

// Semitones from a mode's root down to its parent major scale's root.
const MODE_OFFSET = { lydian: 5, major: 0, mixolydian: 7, dorian: 2, minor: 9, phrygian: 4, locrian: 11 };

/** Root pitch class of the major scale the song's key lives in (D dorian → C). */
function parentMajorPc(key, keyScale) {
  const pc = pitchClass(key);
  if (keyScale in MODE_OFFSET) return mod12(pc - MODE_OFFSET[keyScale]);
  return SCALES[keyScale]?.family === 'minor' ? mod12(pc + 3) : pc;
}

/**
 * @returns {{ root: string, scale: string, name: string, why: string }}
 */
export function chordScale(chord, key = 'C', keyScale = 'major') {
  const has = (tok) => chord.tones.some((t) => t.token === tok);
  const q = chordQuality(chord);
  const degree = mod12(chord.rootPc - parentMajorPc(key, keyScale)); // position in the parent major key
  let scale = 'major';
  let why = '';

  switch (q) {
    case 'dominant':
      if (has('#9') || has('b13')) (scale = 'altered'), (why = 'altered tensions');
      else if (has('b9')) (scale = 'dimHalfWhole'), (why = '♭9 on a dominant');
      else if (has('#11')) (scale = 'lydianDominant'), (why = '♯11 on a dominant');
      else if (degree !== 7 && degree !== 10) (scale = 'lydianDominant'), (why = 'non-diatonic dominant');
      else (scale = 'mixolydian'), (why = 'dominant 7th');
      break;
    case 'sus7':
    case 'sus':
      scale = 'mixolydian';
      why = 'sus chord';
      break;
    case 'minor7':
    case 'minor':
      if (has('b6') || has('b13')) (scale = 'minor'), (why = '♭6 in the chord');
      else if (has('6') || has('13')) (scale = 'dorian'), (why = 'natural 6 in the chord');
      else if (degree === 4 && !has('9') && !has('11')) (scale = 'phrygian'), (why = 'iii chord of the key');
      else if (degree === 4) (scale = 'minor'), (why = 'iii chord with a natural 9');
      else if (degree === 9) (scale = 'minor'), (why = 'vi chord of the key');
      else (scale = 'dorian'), (why = degree === 2 ? 'ii chord of the key' : 'minor 7th');
      break;
    case 'minor-major7':
      scale = 'melodicMinor';
      why = 'minor with a major 7th';
      break;
    case 'half-dim':
      scale = 'locrian';
      why = 'half-diminished';
      break;
    case 'dim':
    case 'dim7':
      scale = 'dimWholeHalf';
      why = 'diminished';
      break;
    case 'aug':
      scale = 'wholeTone';
      why = 'augmented';
      break;
    default: // major, major7
      if (has('#11') || has('#4')) (scale = 'lydian'), (why = '♯11 in the chord');
      else if (degree === 5) (scale = 'lydian'), (why = 'IV chord of the key');
      else (scale = 'major'), (why = degree === 0 ? 'I chord of the key' : 'major chord');
  }
  const name = `${pretty(chord.root)} ${modeName(scale)}`;
  return { root: chord.root, scale, name, why };
}

function modeName(id) {
  if (id === 'major') return 'Ionian (major)';
  if (id === 'minor') return 'Aeolian (minor)';
  return SCALES[id].name;
}

export const isMode = (id) => MODE_LADDER.includes(id);
