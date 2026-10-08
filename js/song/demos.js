// Starter songs: shown on the home page and used for "New song".
// Chords are written with the quick-entry syntax (see parseChordText in model.js).

import { createSong, createSection, parseChordText, makeMeter } from './model.js';

function section(name, meterArgs, text, drums, bass) {
  const meter = makeMeter(...meterArgs);
  const { chords, bars } = parseChordText(text, meter);
  return createSection({ id: name.toLowerCase(), name, meter, bars, chords, drums: { gen: { style: drums } }, bass: { gen: { style: bass } } });
}

export const DEMOS = [
  {
    id: 'ii-v-i',
    title: 'ii–V–I swing',
    blurb: 'The jazz workhorse in C, with a walking bass.',
    make: () =>
      createSong({
        title: 'ii–V–I swing',
        tempo: 132,
        swing: 0.3,
        key: 'C',
        sections: [section('A', [4, 4], 'Dm9 | G13 | Cmaj9 | A7b9', 'swing', 'walking')],
      }),
  },
  {
    id: 'fusion-78',
    title: 'Fusion in 7/8',
    blurb: 'Dorian vamp in 7/8 (2+2+3) into a lydian lift.',
    make: () =>
      createSong({
        title: 'Fusion in 7/8',
        tempo: 116,
        key: 'D',
        scale: 'dorian',
        sections: [
          section('Vamp', [7, 8, [2, 2, 3]], 'Dm9 | Dm9 | Ebmaj7#11 | Dm9', 'fusion', 'synco'),
          section('Lift', [4, 4], 'Bbmaj9 | C/D | Gm11 | A7alt', 'funk', 'root5'),
        ],
        arrangement: [
          { section: 'vamp', repeat: 2 },
          { section: 'lift', repeat: 1 },
        ],
      }),
  },
  {
    id: 'bossa',
    title: 'Bossa sketch',
    blurb: 'Soft bossa groove with slash chords and a minor ii–V.',
    make: () =>
      createSong({
        title: 'Bossa sketch',
        tempo: 128,
        key: 'F',
        sections: [section('A', [4, 4], 'Fmaj9 | Bb/C | Am7 | D7b9 | Gm9 | C13 | Fmaj9 | Em7b5 A7', 'bossa', 'root5')],
      }),
  },
  {
    id: 'waltz',
    title: 'Neo-soul waltz',
    blurb: '3/4 with lush ninths and soft brushes.',
    make: () =>
      createSong({
        title: 'Neo-soul waltz',
        tempo: 84,
        key: 'Eb',
        sections: [section('A', [3, 4], 'Abmaj9 | Gm9 | Fm11 | Bb9sus4', 'brushes', 'roots')],
      }),
  },
];

export function newSong() {
  return createSong({
    title: 'New sketch',
    tempo: 100,
    key: 'C',
    sections: [section('A', [4, 4], 'Cmaj7 | Am7 | Dm7 | G7', 'rock', 'root5')],
  });
}

export const getDemo = (id) => DEMOS.find((d) => d.id === id);
