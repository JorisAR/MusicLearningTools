// Drum pattern generator. Works for any meter by following its groups:
// even-numbered groups get the kick, odd-numbered groups the backbeat.
// Output: [{ at, voice, vel }] relative to the section start.
// voices: kick snare ghost rim hat hatOpen pedal ride crash

import { barTicks, groupStarts, unitTicks } from '../model.js';

export const DRUM_STYLES = {
  none: 'No drums',
  rock: 'Rock / pop',
  halftime: 'Half-time',
  funk: 'Funk (16ths)',
  fusion: 'Fusion',
  swing: 'Jazz swing',
  bossa: 'Bossa nova',
  brushes: 'Ballad (brushes)',
};

export function generateDrums(meter, style, bars) {
  if (!style || style === 'none') return [];
  const out = [];
  const bt = barTicks(meter);
  for (let b = 0; b < bars; b++) {
    const last = b === bars - 1 && bars > 1;
    const hits = barPattern(meter, style, b, last);
    for (const h of hits) out.push({ ...h, at: h.at + b * bt });
  }
  out.push({ at: 0, voice: 'crash', vel: 70 });
  return out.sort((a, b) => a.at - b.at);
}

function barPattern(m, style, barIndex, fill) {
  const u = unitTicks(m.den);
  const bt = barTicks(m);
  const starts = groupStarts(m);
  const hits = [];
  const add = (at, voice, vel) => at >= 0 && at < bt && hits.push({ at, voice, vel });
  const eighth = Math.min(240, u);
  const backbeats = starts.filter((_, i) => i % 2 === 1);
  // Odd number of groups (3/4, 7/8 = 2+2+3): the last group also gets a backbeat feel.
  const kicks = starts.filter((_, i) => i % 2 === 0);

  switch (style) {
    case 'rock':
    case 'halftime': {
      for (let t = 0; t < bt; t += eighth) add(t, 'hat', starts.includes(t) ? 75 : 50);
      if (style === 'halftime') {
        add(0, 'kick', 100);
        add(starts[Math.floor(starts.length / 2)] ?? bt / 2, 'snare', 100);
        if (starts.length > 2) add(starts[starts.length - 1] + eighth, 'kick', 70);
      } else {
        kicks.forEach((t) => add(t, 'kick', t === 0 ? 105 : 90));
        backbeats.forEach((t) => add(t, 'snare', 100));
        if (starts.length > 2) add(starts[2] - eighth, 'kick', 70); // the "and of 2" push
      }
      break;
    }
    case 'funk':
    case 'fusion': {
      const s16 = eighth / 2;
      for (let t = 0; t < bt; t += s16) {
        const onEighth = t % eighth === 0;
        if (style === 'fusion' && !onEighth) continue;
        add(t, style === 'fusion' ? 'ride' : 'hat', starts.includes(t) ? 80 : onEighth ? 60 : 38);
      }
      kicks.forEach((t) => add(t, 'kick', 100));
      backbeats.forEach((t) => {
        add(t, 'snare', 100);
        add(t - s16, 'kick', 75); // anticipation before the backbeat
      });
      // ghost notes on the "e" of each group
      starts.forEach((t, i) => i % 2 === 0 && add(t + s16 * 3, 'ghost', 30));
      if (style === 'fusion') starts.forEach((t, i) => i % 2 === 0 && add(t + s16 * 3 + eighth, 'kick', 65));
      if (barIndex % 2 === 1) add(bt - eighth, 'hatOpen', 60);
      break;
    }
    case 'swing': {
      for (const t of starts) add(t, 'ride', 75);
      // the "skip" note on the and of 2 and 4 (swung by the scheduler)
      backbeats.forEach((t) => add(t + eighth, 'ride', 55));
      backbeats.forEach((t) => add(t, 'pedal', 60));
      for (const t of starts) add(t, 'kick', 28); // feathered
      if (barIndex % 4 === 3) add(starts[starts.length - 1] + eighth, 'snare', 45);
      break;
    }
    case 'bossa': {
      for (let t = 0; t < bt; t += eighth) add(t, 'hat', 45);
      // kick: 1 . . (a) 3 . . (a)  — on group starts plus a pickup before the next
      kicks.forEach((t) => {
        add(t, 'kick', 85);
        add(t + 3 * eighth, 'kick', 65);
      });
      // 3-2 son clave on the rim, spread over two bars
      const clave = barIndex % 2 === 0 ? [0, 3, 6] : [2, 4];
      clave.forEach((e) => add(e * eighth, 'rim', 75));
      break;
    }
    case 'brushes': {
      for (const t of starts) add(t, 'hat', 30);
      kicks.forEach((t) => add(t, 'kick', 45));
      backbeats.forEach((t) => add(t, 'rim', 45));
      break;
    }
  }

  if (fill && style !== 'brushes' && style !== 'swing' && style !== 'bossa') {
    // simple fill: snare 16ths over the last group
    const lastStart = starts[starts.length - 1];
    const s16 = eighth / 2;
    for (let t = lastStart; t < bt; t += s16) hits.push({ at: t, voice: 'snare', vel: 50 + ((t - lastStart) / s16) * 8 });
    return hits.filter((h) => h.at < lastStart || h.voice === 'snare' || h.voice === 'kick');
  }
  return hits;
}
