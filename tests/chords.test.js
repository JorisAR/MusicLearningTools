// Chord parsing, voicing search and progression planning. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYS } from '../js/lib/theory.js';
import {
  parseChord,
  findVoicings,
  planProgression,
  parseProgression,
  PROGRESSIONS,
  CHORD_LIBRARY,
  librarySymbol,
  realize,
} from '../js/lib/chords.js';

const tones = (sym) => parseChord(sym).tones.map((t) => t.name).join(' ');

test('parses common chord symbols', () => {
  assert.equal(tones('C'), 'C E G');
  assert.equal(tones('Cmaj9'), 'C E G B D');
  assert.equal(tones('Dm9'), 'D F A C E');
  assert.equal(tones('F#m7b5'), 'F# A C E');
  assert.equal(tones('Bbdim7'), 'Bb Db Fb Abb');
  assert.equal(tones('G13'), 'G B D F A E'); // 11 omitted
  assert.equal(tones('C6/9'), 'C E G A D');
  assert.equal(tones('Cm(maj7)'), 'C Eb G B');
  assert.equal(tones('Ebmaj7#11'), 'Eb G Bb D A');
  assert.equal(tones('C9sus4'), 'C F G Bb D');
  assert.equal(parseChord('C/D').bass, 'D');
  assert.equal(parseChord('C6/9').bass, null); // 6/9 is not a slash chord
  assert.equal(parseChord('Xyz'), null);
  assert.equal(parseChord('Cfoo'), null);
});

test('finds the classic voicings', () => {
  const keys = (sym, opts) => findVoicings(parseChord(sym), opts).map((v) => v.key);
  assert.ok(keys('Cmaj7').includes('x.3.5.4.5.x'), 'Cmaj7 drop 2 on the A string');
  assert.ok(keys('Cmaj7').includes('8.x.9.9.8.x'), 'Cmaj7 drop 3 on the E string');
  assert.ok(keys('G13').includes('3.x.3.4.5.x'), 'G13 on the E string');
  assert.ok(keys('C/D').includes('x.5.5.5.5.x'), 'C/D over an A-string bass');
  assert.ok(keys('G7#9').includes('x.10.9.10.11.x'), 'the "Hendrix" 7#9');
});

test('voicings always put the root (or slash bass) lowest and contain the essential tones', () => {
  for (const sym of ['Cmaj9', 'C/D', 'F#m7b5', 'Bb13', 'E7alt']) {
    const chord = parseChord(sym);
    const bass = chord.bassPc ?? chord.rootPc;
    const essentials = chord.tones.filter((t) => t.role !== 'optional').map((t) => t.pc);
    for (const v of findVoicings(chord)) {
      assert.equal(v.notes[0].pc, bass, `${sym} ${v.key}`);
      const pcs = new Set(v.notes.map((n) => n.pc));
      for (const pc of essentials) assert.ok(pcs.has(pc), `${sym} ${v.key} missing ${pc}`);
    }
  }
});

test('every library chord and template progression is playable in every key', () => {
  for (const root of KEYS) {
    for (const g of CHORD_LIBRARY)
      for (const q of g.qualities) {
        const sym = librarySymbol(root, q);
        assert.ok(findVoicings(parseChord(sym), { allowOpen: false }).length, `${sym} has no movable voicing`);
      }
    for (const t of PROGRESSIONS)
      for (const sym of realize(t, root)) assert.ok(findVoicings(parseChord(sym)).length, `${t.name}: ${sym}`);
  }
});

test('progression planner keeps the hand close and respects locks', () => {
  const items = parseProgression('Dm9 | G13 Cmaj9');
  const cands = items.map((it) => findVoicings(it.chord).slice(0, 40));
  const { path, ranked } = planProgression(cands);
  assert.equal(path.length, 3);
  for (let i = 1; i < path.length; i++) assert.ok(Math.abs(path[i].center - path[i - 1].center) <= 4);
  assert.equal(ranked[1][0].key, path[1].key);

  const lockKey = ranked[1][3].key;
  const locked = planProgression(cands, { locks: new Map([[1, lockKey]]) });
  assert.equal(locked.path[1].key, lockKey);
});
