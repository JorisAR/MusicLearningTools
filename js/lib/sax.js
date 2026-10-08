// Saxophone transposition and fingerings.
// Fingerings are for WRITTEN pitch and are the same for every saxophone; only the
// transposition differs. Alto is the reference instrument.

import { SHARP_NAMES, FLAT_NAMES, mod12 } from './theory.js';

export const SAXES = {
  alto: { label: 'Alto sax (E♭)', short: 'Alto', semis: 9 }, // written a major 6th above concert
  tenor: { label: 'Tenor sax (B♭)', short: 'Tenor', semis: 14 }, // major 9th above
  soprano: { label: 'Soprano sax (B♭)', short: 'Soprano', semis: 2 }, // major 2nd above
  bari: { label: 'Baritone sax (E♭)', short: 'Bari', semis: 21 }, // octave + major 6th above
};

export const WRITTEN_LOW = 58; // B♭3
export const WRITTEN_HIGH = 90; // F♯6 (above: altissimo)

export const toWritten = (concert, sax) => concert + SAXES[sax].semis;
export const toConcert = (written, sax) => written - SAXES[sax].semis;

export function noteLabel(midi, preferFlats = true) {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[mod12(midi)] + (Math.floor(midi / 12) - 1);
}

// Key names used by the diagram.
//  Left hand:  oct (thumb), palmD, palmEb, palmF, frontF, L1, bis, L2, L3, gs (G♯ pinky), lowCs, lowB, lowBb
//  Right hand: R1, R2, R3, sideE, sideC, sideBb, sideFs, lowC, lowEb
const STACK = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
const low = {
  58: [...STACK, 'lowBb'],
  59: [...STACK, 'lowB'],
  60: [...STACK, 'lowC'],
  61: [...STACK, 'lowCs'],
  62: [...STACK],
  63: [...STACK, 'lowEb'],
  64: ['L1', 'L2', 'L3', 'R1', 'R2'],
  65: ['L1', 'L2', 'L3', 'R1'],
  66: ['L1', 'L2', 'L3', 'R2'],
  67: ['L1', 'L2', 'L3'],
  68: ['L1', 'L2', 'L3', 'gs'],
  69: ['L1', 'L2'],
  70: ['L1', 'bis'],
  71: ['L1'],
  72: ['L2'],
  73: [],
};

const FINGERINGS = { ...low };
// Second octave: same as the first, plus the octave key (D5 … C♯6).
for (let m = 74; m <= 85; m++) FINGERINGS[m] = ['oct', ...low[m - 12]];
// Palm-key register.
FINGERINGS[86] = ['oct', 'palmD'];
FINGERINGS[87] = ['oct', 'palmD', 'palmEb'];
FINGERINGS[88] = ['oct', 'palmD', 'palmEb', 'sideE'];
FINGERINGS[89] = ['oct', 'palmD', 'palmEb', 'palmF', 'sideE'];
FINGERINGS[90] = ['oct', 'palmD', 'palmEb', 'palmF', 'sideE', 'sideFs'];

/** Keys pressed for a written midi note, or null if outside the normal range. */
export function fingering(written) {
  return FINGERINGS[written] ?? null;
}

// Alternate fingerings worth knowing (written pitch).
export const ALTERNATES = {
  70: [{ name: '“1 and 1”', keys: ['L1', 'R1'] }, { name: 'Side B♭', keys: ['L1', 'sideBb'] }],
  82: [{ name: '“1 and 1”', keys: ['oct', 'L1', 'R1'] }, { name: 'Side B♭', keys: ['oct', 'L1', 'sideBb'] }],
  72: [{ name: 'Side C', keys: ['L1', 'sideC'] }],
  84: [{ name: 'Side C', keys: ['oct', 'L1', 'sideC'] }],
  89: [{ name: 'Front F', keys: ['oct', 'L1', 'frontF'] }],
};
