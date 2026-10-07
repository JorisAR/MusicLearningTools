// Sanity checks for the theory + CAGED data. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, SCALES, spellScale, pitchClass, mod12, pretty } from '../js/lib/theory.js';
import { allShapeInstances, inInstance, midiAt } from '../js/lib/guitar.js';

test('every scale note on frets 0–15 belongs to some CAGED shape (all scales)', () => {
  for (const [id, scale] of Object.entries(SCALES)) {
    const fam = scale.family;
    for (const key of KEYS) {
      const notes = spellScale(key, id);
      const inst = allShapeInstances(pitchClass(key), fam, 15);
      for (let s = 0; s < 6; s++) {
        for (let f = 0; f <= 15; f++) {
          if (!notes.has(mod12(midiAt(s, f)))) continue;
          assert.ok(inst.some((i) => inInstance(i, s, f)), `${key} ${id}: string ${s} fret ${f} uncovered`);
        }
      }
    }
  }
});

test('major/minor shapes have at most 3 notes per string', () => {
  for (const fam of ['major', 'minor']) {
    for (const key of KEYS) {
      const notes = spellScale(key, fam);
      for (const i of allShapeInstances(pitchClass(key), fam, 22)) {
        i.windows.forEach(([lo, hi], s) => {
          let n = 0;
          for (let f = Math.max(0, lo); f <= hi; f++) if (notes.has(mod12(midiAt(s, f)))) n++;
          assert.ok(n <= 3, `${key} ${fam} ${i.id} string ${s}: ${n} notes`);
        });
      }
    }
  }
});

test('spelling uses one letter per degree', () => {
  const names = (k, s) => [...spellScale(k, s).values()].map((n) => n.name).join(' ');
  assert.equal(names('A', 'minor'), 'A B C D E F G');
  assert.equal(names('Eb', 'major'), 'Eb F G Ab Bb C D');
  assert.equal(names('F#', 'major'), 'F# G# A# B C# D# E#');
});

test('modes and exotic scales spell correctly', () => {
  const names = (k, s) => [...spellScale(k, s).values()].map((n) => n.name).join(' ');
  assert.equal(names('D', 'dorian'), 'D E F G A B C');
  assert.equal(names('F', 'lydian'), 'F G A B C D E');
  assert.equal(names('A', 'harmonicMinor'), 'A B C D E F G#');
  assert.equal(names('E', 'phrygianDominant'), 'E F G# A B C D');
  assert.equal(SCALES.dorian.family, 'minor');
  assert.equal(SCALES.lydianDominant.family, 'major');
});

test('pretty() prints accidentals', () => {
  assert.equal(pretty('Bbmaj7'), 'B♭maj7');
  assert.equal(pretty('Cm7b5'), 'Cm7♭5');
  assert.equal(pretty('F#'), 'F♯');
  assert.equal(pretty('bb7'), '♭♭7');
});
