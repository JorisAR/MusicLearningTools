// Standard MIDI File (SMF) export and import.
// Export: conductor track (tempo, meters, section markers, chord symbols as text) + chords,
//         bass, melody and drums tracks. Chord symbols make our own files round-trip exactly.
// Import: any SMF → a song. Tracks are classified (drums / bass / melody / chords) and chord
//         symbols are detected from the harmony when the file doesn't carry them.

import { PPQ, createSong, createSection, makeMeter, barTicks, groupStarts } from './model.js';
import { detectChord } from '../lib/chords.js';
import { mod12 } from '../lib/theory.js';

// --- writing -------------------------------------------------------------------

const GM_DRUM = { kick: 36, snare: 38, ghost: 38, rim: 37, hat: 42, pedal: 44, hatOpen: 46, ride: 51, crash: 49 };

function varLen(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
const str = (s) => [...new TextEncoder().encode(s)];

function track(events) {
  // events: [{ tick, data: number[] }] — sorted here; note-offs before note-ons at equal ticks
  events.sort((a, b) => a.tick - b.tick || (a.order ?? 1) - (b.order ?? 1));
  const out = [];
  let last = 0;
  for (const e of events) {
    out.push(...varLen(Math.max(0, Math.round(e.tick - last))), ...e.data);
    last = e.tick;
  }
  out.push(0, 0xff, 0x2f, 0); // end of track
  return [...str('MTrk'), ...u32(out.length), ...out];
}
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];
const meta = (type, bytes) => [0xff, type, ...varLen(bytes.length), ...bytes];

function noteEvents(list, ch) {
  const ev = [];
  for (const n of list) {
    const pitch = Math.max(0, Math.min(127, n.pitch));
    ev.push({ tick: n.tick, data: [0x90 | ch, pitch, Math.max(1, Math.min(127, n.vel | 0))] });
    ev.push({ tick: n.tick + Math.max(1, n.dur), data: [0x80 | ch, pitch, 0], order: 0 });
  }
  return ev;
}

/** @param tl a timeline from buildTimeline(song) */
export function songToMidi(song, tl) {
  const conductor = [{ tick: 0, data: meta(0x03, str(song.title)) }];
  conductor.push({ tick: 0, data: meta(0x51, [...u32(Math.round(60000000 / song.tempo))].slice(1)) });
  let lastMeter = '';
  for (const inst of tl.instances) {
    const m = inst.section.meter;
    const key = `${m.num}/${m.den}`;
    if (key !== lastMeter) {
      conductor.push({ tick: inst.start, data: meta(0x58, [m.num, Math.log2(m.den), 24, 8]) });
      lastMeter = key;
    }
    conductor.push({ tick: inst.start, data: meta(0x06, str(inst.section.name)) });
  }
  for (const c of tl.chords) conductor.push({ tick: c.tick, data: meta(0x01, str(`chord:${c.sym}`)) });

  const chordNotes = [];
  const bass = [];
  const melody = [];
  const drums = [];
  for (const e of tl.events) {
    if (e.type === 'chord') {
      const c = tl.chords[e.chord];
      for (const p of [...c.piano.lh, ...c.piano.rh]) chordNotes.push({ tick: e.tick, dur: e.dur - 10, pitch: p, vel: e.vel });
    } else if (e.type === 'bass') bass.push({ tick: e.tick, dur: e.dur, pitch: e.pitch, vel: e.vel });
    else if (e.type === 'melody') melody.push({ tick: e.tick, dur: e.dur, pitch: e.pitch, vel: e.vel });
    else if (e.type === 'drum' && GM_DRUM[e.voice]) drums.push({ tick: e.tick, dur: 60, pitch: GM_DRUM[e.voice], vel: e.vel });
  }
  const named = (name, program, ch, notes) => [
    { tick: 0, data: meta(0x03, str(name)) },
    ...(program != null ? [{ tick: 0, data: [0xc0 | ch, program] }] : []),
    ...noteEvents(notes, ch),
  ];
  const tracks = [
    track(conductor),
    track(named('Chords', 0, 0, chordNotes)),
    track(named('Bass', 32, 1, bass)),
    track(named('Melody', 65, 2, melody)),
    track(named('Drums', null, 9, drums)),
  ];
  const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)];
  return new Uint8Array([...header, ...tracks.flat()]);
}

// --- reading ---------------------------------------------------------------------

/** Parse an SMF into { ppq, tracks: [{ name, events }] }. */
export function parseMidi(buffer) {
  const d = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  let p = 0;
  const text = (n) => {
    const s = new TextDecoder().decode(new Uint8Array(d.buffer, d.byteOffset + p, n));
    p += n;
    return s;
  };
  if (text(4) !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = d.getUint32(p);
  p += 4;
  const ntracks = d.getUint16(p + 2);
  const division = d.getUint16(p + 4);
  if (division & 0x8000) throw new Error('SMPTE timing is not supported');
  p += hlen;
  const readVar = () => {
    let v = 0;
    let b;
    do {
      b = d.getUint8(p++);
      v = (v << 7) | (b & 0x7f);
    } while (b & 0x80);
    return v;
  };

  const tracks = [];
  for (let t = 0; t < ntracks && p < d.byteLength; t++) {
    const id = text(4);
    const len = d.getUint32(p);
    p += 4;
    const end = p + len;
    if (id !== 'MTrk') {
      p = end;
      continue;
    }
    const events = [];
    let tick = 0;
    let status = 0;
    let name = '';
    while (p < end) {
      tick += readVar();
      let b = d.getUint8(p);
      if (b & 0x80) {
        status = b;
        p++;
      }
      const type = status & 0xf0;
      const ch = status & 0x0f;
      if (status === 0xff) {
        const mt = d.getUint8(p++);
        const l = readVar();
        const bytes = new Uint8Array(d.buffer, d.byteOffset + p, l);
        p += l;
        if (mt === 0x51) events.push({ tick, type: 'tempo', bpm: 60000000 / ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) });
        else if (mt === 0x58) events.push({ tick, type: 'timesig', num: bytes[0], den: 2 ** bytes[1] });
        else if (mt === 0x03) name = new TextDecoder().decode(bytes);
        else if (mt === 0x01 || mt === 0x05 || mt === 0x06) events.push({ tick, type: mt === 0x06 ? 'marker' : 'text', text: new TextDecoder().decode(bytes) });
      } else if (status === 0xf0 || status === 0xf7) {
        p += readVar();
      } else if (type === 0x90 || type === 0x80) {
        const note = d.getUint8(p++);
        const vel = d.getUint8(p++);
        events.push({ tick, type: type === 0x90 && vel > 0 ? 'on' : 'off', ch, note, vel });
      } else if (type === 0xc0 || type === 0xd0) {
        const v = d.getUint8(p++);
        if (type === 0xc0) events.push({ tick, type: 'program', ch, program: v });
      } else {
        p += 2; // 0xA0, 0xB0, 0xE0: two data bytes
      }
    }
    p = end;
    tracks.push({ name, events });
  }
  return { ppq: division, tracks };
}

const DRUM_VOICE = {
  35: 'kick', 36: 'kick', 37: 'rim', 38: 'snare', 40: 'snare', 39: 'rim', 42: 'hat', 44: 'pedal', 46: 'hatOpen',
  49: 'crash', 57: 'crash', 51: 'ride', 59: 'ride', 53: 'ride', 41: 'kick', 43: 'kick', 45: 'snare', 47: 'snare', 48: 'snare', 50: 'snare',
};

/** Build a song from MIDI bytes. Long files are split into 8-bar sections. */
export function midiToSong(buffer, { title = 'Imported MIDI', barsPerSection = 8 } = {}) {
  const { ppq, tracks } = parseMidi(buffer);
  const k = PPQ / ppq;
  const all = tracks.flatMap((t, ti) => t.events.map((e) => ({ ...e, tick: Math.round(e.tick * k), track: ti })));
  const tempo = all.find((e) => e.type === 'tempo')?.bpm ?? 120;
  const textChords = all.filter((e) => e.type === 'text' && e.text.startsWith('chord:')).map((e) => ({ tick: e.tick, sym: e.text.slice(6) }));

  // Pair note-ons and note-offs into notes, grouped per track+channel ("parts").
  const parts = new Map();
  const open = new Map();
  for (const e of all.sort((a, b) => a.tick - b.tick)) {
    if (e.type !== 'on' && e.type !== 'off') continue;
    const id = `${e.track}:${e.ch}`;
    const key = `${id}:${e.note}`;
    if (e.type === 'on') {
      if (open.has(key)) close(open.get(key), e.tick);
      const n = { tick: e.tick, pitch: e.note, vel: e.vel, ch: e.ch, part: id };
      open.set(key, n);
      if (!parts.has(id)) parts.set(id, { id, ch: e.ch, name: tracks[e.track].name, notes: [] });
      parts.get(id).notes.push(n);
    } else if (open.has(key)) {
      close(open.get(key), e.tick);
      open.delete(key);
    }
  }
  function close(n, tick) {
    n.dur = Math.max(30, tick - n.tick);
  }
  for (const n of open.values()) n.dur ??= PPQ;

  // Classify parts.
  const list = [...parts.values()].filter((pt) => pt.notes.length);
  for (const pt of list) {
    pt.avg = pt.notes.reduce((a, n) => a + n.pitch, 0) / pt.notes.length;
    const starts = new Map();
    for (const n of pt.notes) starts.set(n.tick, (starts.get(n.tick) || 0) + 1);
    pt.poly = pt.notes.length / starts.size; // notes per onset
  }
  const drums = list.filter((pt) => pt.ch === 9);
  const pitched = list.filter((pt) => pt.ch !== 9);
  const named = (re) => pitched.find((pt) => re.test(pt.name));
  const mono = pitched.filter((pt) => pt.poly < 1.4);
  const bassPart = named(/bass/i) ?? mono.filter((pt) => pt.avg < 52).sort((a, b) => a.avg - b.avg)[0] ?? null;
  const melodyPart =
    named(/melody|lead|sax|vocal|voice/i) ?? mono.filter((pt) => pt !== bassPart).sort((a, b) => b.notes.length - a.notes.length)[0] ?? null;
  const chordParts = pitched.filter((pt) => pt !== bassPart && pt !== melodyPart);

  const notesOf = (parts) => parts.flatMap((pt) => pt.notes);
  const end = Math.max(1, ...list.flatMap((pt) => pt.notes.map((n) => n.tick + n.dur)), ...textChords.map((c) => c.tick + 1));

  // Bar grid from (possibly changing) time signatures.
  const sigs = all.filter((e) => e.type === 'timesig').sort((a, b) => a.tick - b.tick);
  const markers = all.filter((e) => e.type === 'marker');
  const bars = [];
  for (let t = 0; t < end - 1 || !bars.length; ) {
    const sig = [...sigs].reverse().find((e) => e.tick <= t);
    const m = makeMeter(sig?.num ?? 4, sig?.den ?? 4);
    bars.push({ start: t, meter: m, length: barTicks(m), marker: markers.find((mk) => mk.tick === t)?.text });
    t += barTicks(m);
  }

  // Chords: from text events if present, else detected per meter group.
  let chords = textChords;
  if (!chords.length) {
    const harmony = notesOf(chordParts.length ? chordParts : pitched);
    const bassNotes = bassPart ? bassPart.notes : harmony;
    let prev = null;
    for (const bar of bars) {
      const starts = groupStarts(bar.meter);
      starts.forEach((g, gi) => {
        const from = bar.start + g;
        const to = bar.start + (starts[gi + 1] ?? bar.length);
        const sounding = harmony.filter((n) => n.tick < to && n.tick + n.dur > from);
        if (sounding.length < 2) return;
        const low = bassNotes.filter((n) => n.tick < to && n.tick + n.dur > from).sort((a, b) => a.pitch - b.pitch)[0];
        const sym = detectChord(new Set(sounding.map((n) => mod12(n.pitch))), low ? mod12(low.pitch) : null);
        if (sym && sym !== prev) chords.push({ tick: from, sym });
        prev = sym ?? prev;
      });
    }
  }

  // Sections: split at markers, meter changes, and every `barsPerSection` bars.
  const groups = [];
  for (const bar of bars) {
    const cur = groups[groups.length - 1];
    const sameMeter = cur && JSON.stringify(cur.meter) === JSON.stringify(bar.meter);
    if (!cur || bar.marker || !sameMeter || cur.bars.length >= barsPerSection) groups.push({ meter: bar.meter, name: bar.marker, bars: [bar] });
    else cur.bars.push(bar);
  }
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const sections = [];
  const arrangement = [];
  const seen = new Map(); // content signature → section id
  groups.forEach((g, i) => {
    const from = g.bars[0].start;
    const to = from + g.bars.reduce((a, b) => a + b.length, 0);
    const inRange = (t) => t >= from && t < to;
    const rel = (n) => ({ at: n.tick - from, dur: Math.min(n.dur, to - n.tick), pitch: n.pitch, vel: n.vel });
    const content = {
      bars: g.bars.length,
      meter: g.meter,
      chords: chords.filter((c) => inRange(c.tick)).map((c) => ({ at: c.tick - from, sym: c.sym })),
      melody: melodyPart ? melodyPart.notes.filter((n) => inRange(n.tick)).map(rel) : [],
      bass: bassPart ? { notes: bassPart.notes.filter((n) => inRange(n.tick)).map(rel) } : { gen: { style: 'none' } },
      drums: drums.length
        ? {
            steps: notesOf(drums)
              .filter((n) => inRange(n.tick) && DRUM_VOICE[n.pitch])
              .map((n) => ({ at: n.tick - from, voice: n.vel < 45 && DRUM_VOICE[n.pitch] === 'snare' ? 'ghost' : DRUM_VOICE[n.pitch], vel: n.vel })),
          }
        : { gen: { style: 'none' } },
    };
    const name = g.name || letters[sections.length] || `S${sections.length + 1}`;
    // The crash on a section's downbeat differs between repeats; ignore it when matching.
    const sig = name + JSON.stringify({ ...content, drums: content.drums.steps?.filter((h) => !(h.voice === 'crash' && h.at === 0)) ?? content.drums });
    let id = seen.get(sig);
    if (!id) {
      id = `s${i}`;
      seen.set(sig, id);
      sections.push(createSection({ id, name, ...content }));
    }
    const last = arrangement[arrangement.length - 1];
    if (last?.section === id) last.repeat++;
    else arrangement.push({ section: id, repeat: 1 });
  });
  return createSong({ title, tempo: Math.round(tempo), sections, arrangement });
}
