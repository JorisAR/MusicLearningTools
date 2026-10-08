// Bass line generator from a section's chords.
// Input: resolved chord spans for the section [{ at, end, chord }] (relative ticks).
// Output: [{ at, dur, pitch, vel }] relative to the section start.

import { barTicks, groupStarts, unitTicks } from '../model.js';
import { mod12 } from '../../lib/theory.js';

export const BASS_STYLES = {
  none: 'No bass',
  roots: 'Roots',
  root5: 'Root & fifth',
  walking: 'Walking (4/4 swing)',
  pedal: 'Whole notes',
  synco: 'Syncopated',
};

const LOW = 28; // E1
const HIGH = 50; // D3

function nearest(pc, target) {
  let best = null;
  for (let m = LOW; m <= HIGH; m++) if (mod12(m) === pc && (best == null || Math.abs(m - target) < Math.abs(best - target))) best = m;
  return best;
}

const bassPc = (chord) => chord.bassPc ?? chord.rootPc;
const fifthPc = (chord) => (chord.tones.find((t) => t.token.endsWith('5')) ?? { pc: mod12(chord.rootPc + 7) }).pc;

export function generateBass(meter, bars, spans, style) {
  if (!style || style === 'none' || !spans.length) return [];
  const bt = barTicks(meter);
  const starts = groupStarts(meter);
  const u = unitTicks(meter.den);
  const total = bars * bt;
  const chordAt = (t) => spans.find((s) => t >= s.at && t < s.end)?.chord ?? spans[spans.length - 1].chord;

  // Onsets: where the bass plays, per style.
  const onsets = [];
  for (let b = 0; b < bars; b++) {
    const base = b * bt;
    if (style === 'pedal') onsets.push(base);
    else if (style === 'walking') for (let t = 0; t < bt; t += u) onsets.push(base + t);
    else if (style === 'synco') starts.forEach((g, i) => onsets.push(base + g, ...(i % 2 ? [] : [base + g + Math.min(360, u * 1.5)])));
    else starts.forEach((g) => onsets.push(base + g));
  }
  // Every chord change gets a note too.
  for (const s of spans) if (s.at < total) onsets.push(s.at);
  const times = [...new Set(onsets)].filter((t) => t < total).sort((a, b) => a - b);

  const notes = [];
  let prev = 38;
  times.forEach((t, i) => {
    const chord = chordAt(t);
    const next = times[i + 1] ?? total;
    const isChange = spans.some((s) => s.at === t);
    const nextChord = chordAt(next < total ? next : total - 1);
    let pc = bassPc(chord);

    if (style === 'root5' && !isChange) {
      const groupIdx = starts.indexOf(t % bt);
      if (groupIdx % 2 === 1) pc = fifthPc(chord);
    } else if (style === 'walking' && !isChange) {
      const changeNext = spans.some((s) => s.at === next) || next >= total;
      if (changeNext) {
        // chromatic approach into the next root
        const target = nearest(bassPc(nextChord !== chord ? nextChord : chord), prev);
        const pitch = target + (prev > target ? 1 : -1);
        notes.push({ at: t, dur: next - t - 10, pitch: Math.min(HIGH, Math.max(LOW, pitch)), vel: 80 });
        prev = pitch;
        return;
      }
      // otherwise a chord tone, alternating direction
      const pcs = chord.tones.filter((x) => x.role !== 'optional' || x.token.endsWith('5')).map((x) => x.pc);
      const cands = pcs.map((p) => nearest(p, prev + (i % 2 ? -3 : 4))).filter((m) => m !== prev);
      pc = mod12(cands[0] ?? prev);
    }
    const pitch = nearest(pc, isChange ? 36 : prev);
    notes.push({ at: t, dur: Math.max(60, next - t - 15), pitch, vel: isChange ? 95 : 80 });
    prev = pitch;
  });
  return notes;
}
