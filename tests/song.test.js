// Song model, generators, timeline, codec, chord-scale and piano voicing. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeMeter,
  defaultGroups,
  parseGroups,
  barTicks,
  groupStarts,
  parseChordText,
  chordText,
  createSong,
  normalizeSong,
  flatten,
  songLength,
} from '../js/song/model.js';
import { generateDrums, DRUM_STYLES } from '../js/song/generate/drums.js';
import { generateBass, BASS_STYLES } from '../js/song/generate/bass.js';
import { buildTimeline, chordIndexAt } from '../js/song/timeline.js';
import { encodeSong, decodeSong } from '../js/song/codec.js';
import { DEMOS } from '../js/song/demos.js';
import { parseChord, transposeSymbol } from '../js/lib/chords.js';
import { chordScale } from '../js/lib/chordscale.js';
import { pianoVoicing } from '../js/lib/piano.js';
import { mod12 } from '../js/lib/theory.js';

test('meters: default groupings and tick math', () => {
  assert.deepEqual(defaultGroups(4, 4), [1, 1, 1, 1]);
  assert.deepEqual(defaultGroups(6, 8), [3, 3]);
  assert.deepEqual(defaultGroups(7, 8), [2, 2, 3]);
  assert.deepEqual(defaultGroups(5, 8), [2, 3]);
  assert.deepEqual(defaultGroups(12, 8), [3, 3, 3, 3]);
  assert.equal(barTicks(makeMeter(7, 8)), 7 * 240);
  assert.deepEqual(groupStarts(makeMeter(7, 8)), [0, 480, 960]);
  assert.deepEqual(parseGroups('3+2', 5), [3, 2]);
  assert.equal(parseGroups('3+3', 5), null);
});

test('quick chord entry round-trips', () => {
  const m = makeMeter(4, 4);
  const { chords, bars } = parseChordText('Dm9 G13 | Cmaj9 | % | . ', m);
  assert.equal(bars, 4);
  assert.deepEqual(
    chords.map((c) => [c.at, c.sym]),
    [
      [0, 'Dm9'],
      [960, 'G13'],
      [1920, 'Cmaj9'],
      [3840, 'Cmaj9'],
    ],
  );
  const sec = { bars, meter: m, chords };
  assert.equal(chordText(sec), 'Dm9 G13 | Cmaj9 | Cmaj9 | .');
});

test('arrangement flattens with repeats', () => {
  const song = DEMOS.find((d) => d.id === 'fusion-78').make();
  const inst = flatten(song);
  assert.deepEqual(
    inst.map((i) => i.section.name),
    ['Vamp', 'Vamp', 'Lift'],
  );
  assert.equal(songLength(song), 2 * 4 * 7 * 240 + 4 * 1920);
});

test('normalizeSong repairs junk and keeps valid data', () => {
  const s = normalizeSong({ tempo: 9999, sections: [{ name: 'X', meter: { num: 7, den: 8, groups: [9] } }], arrangement: [{ section: 'nope' }] });
  assert.equal(s.tempo, 300);
  assert.deepEqual(s.sections[0].meter.groups, [2, 2, 3]);
  assert.equal(s.arrangement[0].section, s.sections[0].id);
  assert.throws(() => normalizeSong(null));
});

test('drum styles produce hits inside the section for odd meters', () => {
  for (const meter of [makeMeter(4, 4), makeMeter(7, 8), makeMeter(5, 4, [3, 2]), makeMeter(6, 8)])
    for (const style of Object.keys(DRUM_STYLES)) {
      const hits = generateDrums(meter, style, 2);
      if (style === 'none') assert.equal(hits.length, 0);
      else assert.ok(hits.length > 4, `${style} in ${meter.num}/${meter.den}`);
      for (const h of hits) assert.ok(h.at >= 0 && h.at < 2 * barTicks(meter));
    }
});

test('bass lines follow the chord roots and stay in range', () => {
  const meter = makeMeter(4, 4);
  const spans = [
    { at: 0, end: 1920, chord: parseChord('Dm9') },
    { at: 1920, end: 3840, chord: parseChord('G13') },
  ];
  for (const style of Object.keys(BASS_STYLES)) {
    const notes = generateBass(meter, 2, spans, style);
    if (style === 'none') continue;
    assert.ok(notes.length, style);
    assert.equal(mod12(notes[0].pitch), 2, `${style} starts on D`);
    const atG = notes.find((n) => n.at === 1920);
    assert.equal(mod12(atG.pitch), 7, `${style} hits G on the change`);
    for (const n of notes) assert.ok(n.pitch >= 28 && n.pitch <= 50);
  }
});

test('timeline: chords carry across sections, voicings exist, events sorted', () => {
  for (const demo of DEMOS) {
    const tl = buildTimeline(demo.make());
    assert.ok(tl.chords.length);
    for (const c of tl.chords) {
      assert.ok(c.guitar, `${demo.id}: ${c.sym} has a guitar voicing`);
      assert.ok(c.piano.rh.length >= 3, `${demo.id}: ${c.sym} piano`);
      assert.ok(c.scale.scale, `${demo.id}: ${c.sym} scale`);
    }
    for (let i = 1; i < tl.events.length; i++) assert.ok(tl.events[i].t >= tl.events[i - 1].t);
  }
  const song = createSong({
    sections: [
      { id: 'a', bars: 1, chords: [{ at: 0, sym: 'Dm9' }] },
      { id: 'b', bars: 1, chords: [] },
    ],
  });
  const tl = buildTimeline(song);
  assert.equal(tl.chords.length, 2, 'section b inherits Dm9');
  assert.equal(tl.chords[1].sym, 'Dm9');
  assert.equal(chordIndexAt(tl, 1920 + 10), 1);
});

test('transposition moves chords and the key', () => {
  assert.equal(transposeSymbol('Dm9/F', 2), 'Em9/G');
  assert.equal(transposeSymbol('C/D', -2, true), 'Bb/C');
  const song = DEMOS[0].make();
  song.transpose = 2;
  const tl = buildTimeline(song);
  assert.equal(tl.chords[0].sym, 'Em9');
  assert.equal(tl.key, 'D');
});

test('swing delays off-beat eighths only', () => {
  const song = createSong({ swing: 0.33, sections: [{ bars: 1, chords: [{ at: 0, sym: 'C' }], drums: { gen: { style: 'rock' } } }] });
  const hats = buildTimeline(song).events.filter((e) => e.type === 'drum' && e.voice === 'hat');
  assert.ok(hats.some((e) => e.tick % 480 === 240 && e.t > e.tick));
  assert.ok(hats.filter((e) => e.tick % 480 === 0).every((e) => e.t === e.tick));
});

test('share links round-trip', async () => {
  for (const d of DEMOS) {
    const song = d.make();
    const code = await encodeSong(song);
    assert.match(code, /^[A-Za-z0-9_-]+$/);
    assert.ok(code.length < 1500);
    assert.deepEqual(await decodeSong(code), normalizeSong(song));
  }
});

test('chord-scale suggestions', () => {
  const cs = (sym, key = 'C', scale = 'major') => chordScale(parseChord(sym), key, scale).scale;
  assert.equal(cs('Dm9'), 'dorian');
  assert.equal(cs('Em7'), 'phrygian');
  assert.equal(cs('Am7'), 'minor');
  assert.equal(cs('Fmaj7'), 'lydian');
  assert.equal(cs('Cmaj9'), 'major');
  assert.equal(cs('G7'), 'mixolydian');
  assert.equal(cs('G7alt'), 'altered');
  assert.equal(cs('A7b9'), 'dimHalfWhole');
  assert.equal(cs('D7'), 'lydianDominant'); // II7: non-diatonic dominant
  assert.equal(cs('Bm7b5'), 'locrian');
  assert.equal(cs('Cm(maj7)'), 'melodicMinor');
  assert.equal(cs('Dm9', 'D', 'dorian'), 'dorian');
});

test('piano voicings are close and voice-led', () => {
  let prev = null;
  for (const sym of ['Dm9', 'G13', 'Cmaj9']) {
    const v = pianoVoicing(parseChord(sym), prev);
    assert.ok(v.rh[v.rh.length - 1] - v.rh[0] < 12, `${sym} right hand within an octave`);
    assert.equal(mod12(v.lh[0]), parseChord(sym).rootPc);
    if (prev) assert.ok(Math.abs(v.rh[0] - prev.rh[0]) <= 5, `${sym} moves smoothly`);
    prev = v;
  }
  const rootless = pianoVoicing(parseChord('Dm9'), null, { rootless: true });
  assert.ok(!rootless.lh.some((m) => mod12(m) === 2), 'rootless has no root');
});
