// Turns a song into everything playback and practice views need:
// section instances, bars, chords (with guitar & piano voicings and a chord-scale),
// and one sorted list of audio events.

import { flatten, barTicks, groupStarts, unitTicks } from './model.js';
import { generateDrums } from './generate/drums.js';
import { generateBass } from './generate/bass.js';
import { parseChord, findVoicings, planProgression, transposeSymbol } from '../lib/chords.js';
import { pianoVoicing } from '../lib/piano.js';
import { fingerMelody } from '../lib/fingering.js';
import { chordScale } from '../lib/chordscale.js';
import { KEYS, pitchClass, mod12 } from '../lib/theory.js';

const voicingCache = new Map();
function guitarCandidates(chord) {
  if (!voicingCache.has(chord.symbol)) {
    let v = findVoicings(chord, { bass: 'root', allowOpen: true });
    if (!v.length) v = findVoicings(chord, { bass: 'any', allowOpen: true });
    voicingCache.set(chord.symbol, v.slice(0, 30));
  }
  return voicingCache.get(chord.symbol);
}

const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

/** The song key after transposition (e.g. 'D' +2 → 'E'). */
export function transposedKey(song) {
  return KEYS[mod12(pitchClass(song.key) + song.transpose)];
}

/**
 * @param song
 * @param opts { rootless: boolean, region: 'auto'|'low'|'mid'|'high' }
 */
export function buildTimeline(song, opts = {}) {
  const instances = flatten(song);
  const key = transposedKey(song);
  const preferFlats = FLAT_KEYS.has(key) || key.includes('b');
  const length = instances.reduce((a, i) => a + i.length, 0);

  // --- bars --------------------------------------------------------------------
  const bars = [];
  for (const inst of instances) {
    const bt = barTicks(inst.section.meter);
    for (let b = 0; b < inst.section.bars; b++) bars.push({ tick: inst.start + b * bt, length: bt, bar: b, inst: inst.index, meter: inst.section.meter });
  }

  // --- chords (held across section boundaries until the next change) ------------
  const chords = [];
  let carry = null;
  for (const inst of instances) {
    const sec = inst.section;
    const list = [...sec.chords].sort((a, b) => a.at - b.at);
    if (carry && !list.some((c) => c.at === 0)) list.unshift({ at: 0, sym: carry, carried: true });
    for (const c of list) {
      const sym = transposeSymbol(c.sym, song.transpose, preferFlats);
      const chord = parseChord(sym);
      if (!chord) continue;
      chords.push({ tick: inst.start + c.at, sym: chord.symbol, chord, inst: inst.index, carried: !!c.carried, src: c.carried ? null : { sec: sec.id, at: c.at }, lock: c.carried ? null : c.gtr });
      carry = c.sym;
    }
  }
  chords.forEach((c, i) => (c.end = chords[i + 1]?.tick ?? length));

  // Guitar: voice-lead the whole song at once. Piano: chord by chord.
  const cands = chords.map((c) => guitarCandidates(c.chord));
  const playable = cands.every((l) => l.length);
  // Voicings the user picked in the sketch are locked; the planner fits the rest around them.
  const locks = new Map();
  chords.forEach((c, i) => {
    if (!c.lock) return;
    if (!cands[i].some((v) => v.key === c.lock)) {
      const found = findVoicings(c.chord, { bass: 'any', allowOpen: true }).find((v) => v.key === c.lock);
      if (found) cands[i] = [found, ...cands[i]];
    }
    if (cands[i].some((v) => v.key === c.lock)) locks.set(i, c.lock);
  });
  const planned = playable && chords.length ? planProgression(cands, { region: opts.region || 'auto', locks }) : { path: [], ranked: [] };
  const plan = planned.path;
  let prevPiano = null;
  chords.forEach((c, i) => {
    c.guitar = plan[i] || cands[i][0] || null;
    c.ranked = planned.ranked[i] || cands[i];
    c.locked = locks.has(i);
    c.piano = pianoVoicing(c.chord, prevPiano, { rootless: !!opts.rootless });
    prevPiano = c.piano;
    c.scale = chordScale(c.chord, key, song.scale);
  });

  // --- events --------------------------------------------------------------------
  const events = [];
  const melody = []; // all melody notes, with guitar fingering
  const bassLine = []; // all bass notes (for falling-notes views)
  const generated = {}; // per section id: the generated bass/drums of its first instance (for "Edit")
  const swingTick = (tick, meter) => {
    if (!song.swing || meter.den !== 4) return tick;
    const pos = tick % 480;
    return pos === 240 ? tick + Math.round(song.swing * 240) : tick;
  };

  for (const inst of instances) {
    const sec = inst.section;
    const m = sec.meter;
    const bt = barTicks(m);
    const secLen = inst.length;
    const add = (e) => events.push({ ...e, tick: inst.start + e.at, t: swingTick(inst.start + e.at, m), inst: inst.index });

    // metronome
    const starts = groupStarts(m);
    const u = unitTicks(m.den);
    for (let b = 0; b < sec.bars; b++)
      for (let t = 0; t < bt; t += u) add({ at: b * bt + t, type: 'click', accent: t === 0 ? 2 : starts.includes(t) ? 1 : 0 });

    // drums
    const drums = sec.drums.steps ? sec.drums.steps : generateDrums(m, sec.drums.gen?.style, sec.bars);
    for (const d of drums) if (inst.index > 0 || d.voice !== 'crash') add({ at: d.at, type: 'drum', voice: d.voice, vel: d.vel });
    generated[sec.id] ??= {};
    if (!sec.drums.steps) generated[sec.id].drums ??= drums;

    // bass
    const spans = chords
      .filter((c) => c.end > inst.start && c.tick < inst.start + secLen)
      .map((c) => ({ at: Math.max(0, c.tick - inst.start), end: Math.min(secLen, c.end - inst.start), chord: c.chord }));
    const bass = sec.bass.notes ? sec.bass.notes : generateBass(m, sec.bars, spans, sec.bass.gen?.style);
    for (const n of bass) {
      const pitch = n.pitch + (sec.bass.notes ? song.transpose : 0);
      add({ at: n.at, type: 'bass', pitch, dur: n.dur, vel: n.vel });
      bassLine.push({ tick: inst.start + n.at, dur: n.dur, pitch });
    }
    // Stored in concert pitch without transposition, so it can be edited and re-transposed.
    if (!sec.bass.notes) generated[sec.id].bass ??= bass.map((n) => ({ ...n, pitch: n.pitch - song.transpose }));

    // melody (fingered per section instance so a position lock applies to that section)
    const line = [...sec.melody].sort((a, b) => a.at - b.at || b.pitch - a.pitch);
    const fingers = fingerMelody(
      line.map((n) => n.pitch + song.transpose),
      { lock: sec.gtrPos, maxFret: 17 },
    );
    line.forEach((n, i) => {
      add({ at: n.at, type: 'melody', pitch: n.pitch + song.transpose, dur: n.dur, vel: n.vel });
      melody.push({ tick: inst.start + n.at, dur: n.dur, pitch: n.pitch + song.transpose, inst: inst.index, gtr: fingers[i] });
    });
  }

  // comping: strike on every chord change and again on each bar line inside a chord
  chords.forEach((c, ci) => {
    const strikes = new Set([c.tick]);
    for (const b of bars) if (b.tick > c.tick && b.tick < c.end) strikes.add(b.tick);
    const sorted = [...strikes].sort((a, b) => a - b);
    sorted.forEach((tick, k) => {
      const end = sorted[k + 1] ?? c.end;
      const meter = bars.find((b) => tick >= b.tick && tick < b.tick + b.length)?.meter ?? { den: 4 };
      events.push({ tick, t: swingTick(tick, meter), type: 'chord', chord: ci, dur: end - tick, vel: k === 0 ? 80 : 60, inst: c.inst });
    });
  });

  events.sort((a, b) => a.t - b.t || order(a) - order(b));
  return { length, instances, bars, chords, events, key, melody, bassLine, generated };
}

const ORDER = { click: 0, drum: 1, bass: 2, chord: 3, melody: 4 };
const order = (e) => ORDER[e.type];

/** Index of the chord sounding at a tick (or -1). */
export function chordIndexAt(tl, tick) {
  let lo = -1;
  for (let i = 0; i < tl.chords.length; i++) {
    if (tl.chords[i].tick <= tick) lo = i;
    else break;
  }
  return lo;
}

export function instanceAt(tl, tick) {
  return tl.instances.find((i) => tick >= i.start && tick < i.start + i.length) ?? tl.instances[tl.instances.length - 1];
}

export function barAt(tl, tick) {
  return tl.bars.find((b) => tick >= b.tick && tick < b.tick + b.length) ?? tl.bars[tl.bars.length - 1];
}
