// Phase 2: chord detection, melody fingering, sax, MIDI, voicing locks, section colors. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectChord, parseChord } from '../js/lib/chords.js';
import { fingerMelody } from '../js/lib/fingering.js';
import { toWritten, fingering, noteLabel, WRITTEN_LOW, WRITTEN_HIGH } from '../js/lib/sax.js';
import { songToMidi, midiToSong, parseMidi } from '../js/song/midi.js';
import { buildTimeline } from '../js/song/timeline.js';
import { createSong, withChord, SECTION_COLORS, normalizeSong } from '../js/song/model.js';
import { encodeSong, decodeSong } from '../js/song/codec.js';
import { DEMOS } from '../js/song/demos.js';
import { TUNINGS } from '../js/lib/guitar.js';

test('detectChord names common chords', () => {
  assert.equal(detectChord([2, 5, 9, 0, 4], 2), 'Dm9');
  assert.equal(detectChord([7, 11, 5, 4], 7), 'G13');
  assert.equal(detectChord([0, 4, 7, 11, 2], 0), 'Cmaj9');
  assert.equal(detectChord([0, 4, 7], 2), 'C/D');
  assert.equal(detectChord([7, 11, 2, 5, 8], 7), 'G7b9');
  assert.equal(detectChord([11, 2, 5, 9], 11), 'Bm7b5');
  assert.equal(detectChord([0]), null);
});

test('melody fingering stays in position and respects a lock', () => {
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  const f = fingerMelody(scale);
  const positions = new Set(f.map((x) => x.pos));
  assert.equal(positions.size, 1, 'one octave of C major fits one position');
  f.forEach((x, i) => assert.equal(TUNINGS.standard.midi[x.s] + x.f, scale[i]));
  const locked = fingerMelody(scale, { lock: 7 });
  for (const x of locked) assert.ok(x.f === 0 || (x.f >= 6 && x.f <= 11), `fret ${x.f} near position 7`);
  assert.deepEqual(fingerMelody([20, 64]).map((x) => x && x.f), [null, fingerMelody([64])[0].f]);
});

test('sax: transposition and fingerings cover the normal range', () => {
  assert.equal(noteLabel(toWritten(61, 'alto')), 'Bb4'); // concert C#4 → written B♭4 on alto
  assert.equal(toWritten(60, 'tenor'), 74);
  assert.equal(toWritten(60, 'soprano'), 62);
  assert.equal(toWritten(60, 'bari'), 81);
  for (let m = WRITTEN_LOW; m <= WRITTEN_HIGH; m++) assert.ok(Array.isArray(fingering(m)), `fingering for ${noteLabel(m)}`);
  assert.equal(fingering(WRITTEN_HIGH + 1), null);
  assert.deepEqual(fingering(67), ['L1', 'L2', 'L3']); // G
  assert.deepEqual(fingering(79), ['oct', 'L1', 'L2', 'L3']); // high G
});

test('MIDI export → import round-trips sections, meters, chords and melody', () => {
  const song = DEMOS.find((d) => d.id === 'fusion-78').make();
  song.sections[0].melody = [
    { at: 0, dur: 240, pitch: 69, vel: 90 },
    { at: 480, dur: 480, pitch: 72, vel: 90 },
  ];
  const bytes = songToMidi(song, buildTimeline(song));
  const parsed = parseMidi(bytes);
  assert.equal(parsed.ppq, 480);
  const back = midiToSong(bytes);
  assert.equal(back.tempo, song.tempo);
  assert.deepEqual(
    back.sections.map((s) => [s.name, s.meter.num, s.meter.den, s.bars]),
    [
      ['Vamp', 7, 8, 4],
      ['Lift', 4, 4, 4],
    ],
  );
  assert.deepEqual(
    back.arrangement.map((a) => a.repeat),
    [2, 1],
  );
  assert.deepEqual(
    back.sections[0].chords.map((c) => c.sym),
    song.sections[0].chords.map((c) => c.sym),
  );
  assert.deepEqual(
    back.sections[0].melody.map((n) => [n.at, n.pitch]),
    [
      [0, 69],
      [480, 72],
    ],
  );
  assert.ok(back.sections[0].drums.steps.length > 0);
  assert.ok(back.sections[0].bass.notes.length > 0);
});

test('MIDI import detects chords when a file has no chord symbols', () => {
  // Hand-built SMF: one track, Dm7 (D F A C) for a bar, then G7 (G B D F).
  const ev = [];
  const chord = (t, notes) => {
    for (const n of notes) ev.push([t, [0x90, n, 90]]);
    for (const n of notes) ev.push([t + 1920, [0x80, n, 0]]);
  };
  chord(0, [50, 53, 57, 60]);
  chord(1920, [43, 59, 62, 65]);
  ev.sort((a, b) => a[0] - b[0]);
  const body = [];
  let last = 0;
  const vl = (n) => {
    const b = [n & 0x7f];
    while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80);
    return b;
  };
  for (const [t, d] of ev) body.push(...vl(t - last), ...d), (last = t);
  body.push(0, 0xff, 0x2f, 0);
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const bytes = new Uint8Array([...'MThd'].map((c) => c.charCodeAt(0)).concat(u32(6), [0, 0, 0, 1, 1, 224], [...'MTrk'].map((c) => c.charCodeAt(0)), u32(body.length), body));
  const song = midiToSong(bytes);
  assert.deepEqual(
    song.sections[0].chords.map((c) => c.sym),
    ['Dm7', 'G7'],
  );
});

test('voicing locks survive edits and steer the timeline', () => {
  const song = createSong({ sections: [{ bars: 2, chords: [{ at: 0, sym: 'Dm9', gtr: '10.8.10.9.x.x' }, { at: 1920, sym: 'G13' }] }] });
  const tl = buildTimeline(song);
  assert.equal(tl.chords[0].guitar.key, '10.8.10.9.x.x');
  assert.ok(tl.chords[0].locked);
  assert.ok(tl.chords[0].ranked.length > 1);
  // Retyping the same chord keeps the lock; changing it drops the lock.
  assert.equal(withChord(song.sections[0].chords, 0, 'Dm9').find((c) => c.at === 0).gtr, '10.8.10.9.x.x');
  assert.equal(withChord(song.sections[0].chords, 0, 'Dm11').find((c) => c.at === 0).gtr, undefined);
});

test('sections get distinct colors that survive share links', async () => {
  const song = createSong({ sections: [{ name: 'A' }, { name: 'B' }, { name: 'C', color: 0 }] });
  const colors = song.sections.map((s) => s.color);
  assert.equal(new Set(colors).size, 3);
  assert.ok(colors.every((c) => c >= 0 && c < SECTION_COLORS.length));
  const back = await decodeSong(await encodeSong(song));
  assert.deepEqual(
    back.sections.map((s) => s.color),
    colors,
  );
});

test('timeline exposes generated parts for editing, in untransposed pitch', () => {
  const song = DEMOS[0].make();
  song.transpose = 3;
  const tl = buildTimeline(normalizeSong(song));
  const gen = tl.generated[song.sections[0].id];
  assert.ok(gen.bass.length && gen.drums.length);
  // First bass note is the root of Dm9 (D) before transposition.
  assert.equal(gen.bass[0].pitch % 12, parseChord('Dm9').rootPc);
});
