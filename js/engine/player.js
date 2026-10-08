// Look-ahead scheduler: plays a timeline's events on the Web Audio clock.
// Supports a loop range, tempo scaling (no pitch change: it's all events), and a count-in bar.

import { getAudio } from '../lib/audio.js';
import { PPQ, groupStarts, unitTicks, barTicks } from '../song/model.js';

const LOOKAHEAD = 0.15; // seconds scheduled ahead
const INTERVAL = 25; // ms between scheduler runs

/**
 * dispatch(event, time, secondsPerTick, { countIn }) is called for every event that should sound.
 */
export function createPlayer(dispatch) {
  let st = null;
  let timer = null;
  let onEnd = null;

  function firstIndex(events, tick) {
    let i = 0;
    while (i < events.length && events[i].tick < tick) i++;
    return i;
  }

  function pump() {
    const { ctx } = getAudio();
    const horizon = ctx.currentTime + LOOKAHEAD;
    const ev = st.tl.events;
    for (;;) {
      const atEnd = st.idx >= ev.length || ev[st.idx].tick >= st.range.end;
      if (atEnd) {
        const endTime = st.passTime + (st.range.end - st.passTick) * st.spt;
        if (!st.loop) {
          if (ctx.currentTime >= endTime) {
            stop();
            onEnd?.();
          }
          return;
        }
        if (endTime > horizon) return;
        st.passTime = endTime;
        st.passTick = st.range.start;
        st.passes.push({ time: endTime, tick: st.range.start });
        if (st.passes.length > 8) st.passes.shift();
        st.idx = firstIndex(ev, st.range.start);
        st.lastT = null;
        continue;
      }
      const e = ev[st.idx];
      const time = st.passTime + (e.t - st.passTick) * st.spt;
      if (time > horizon) return;
      if (time >= ctx.currentTime - 0.02) dispatch(e, Math.max(time, ctx.currentTime), st.spt);
      st.lastT = e.t;
      st.idx++;
    }
  }

  function play(tl, { from = 0, range = null, loop = false, bpm = 100, countIn = false, onFinish } = {}) {
    stop();
    const { ctx } = getAudio();
    if (ctx.state === 'suspended') ctx.resume();
    const r = range ?? { start: 0, end: tl.length };
    const start = Math.min(Math.max(from, r.start), r.end - 1);
    const spt = 60 / bpm / PPQ;
    let t0 = ctx.currentTime + 0.1;

    if (countIn) {
      const bar = tl.bars.find((b) => start >= b.tick && start < b.tick + b.length) ?? tl.bars[0];
      const m = bar.meter;
      const u = unitTicks(m.den);
      const starts = groupStarts(m);
      for (let t = 0; t < barTicks(m); t += u)
        dispatch({ type: 'click', accent: t === 0 ? 2 : starts.includes(t) ? 1 : 0, countIn: true }, t0 + t * spt, spt);
      t0 += barTicks(m) * spt;
    }

    st = { tl, spt, range: r, loop, passTime: t0, passTick: start, passes: [{ time: t0, tick: start }], idx: firstIndex(tl.events, start), lastT: null };
    onEnd = onFinish;
    timer = setInterval(pump, INTERVAL);
    pump();
  }

  /** Replace the timeline while playing (after an edit) without restarting. */
  function swap(tl, range = null) {
    if (!st) return;
    st.tl = tl;
    st.range = range ?? { start: Math.min(st.range.start, tl.length - 1), end: tl.length };
    let i = 0;
    const after = st.lastT ?? st.passTick - 1;
    while (i < tl.events.length && (tl.events[i].t <= after || tl.events[i].tick < st.passTick)) i++;
    st.idx = i;
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    st = null;
  }

  /** Current playhead tick, or null if stopped. `countIn` is true before the downbeat. */
  function position() {
    if (!st) return null;
    const { ctx } = getAudio();
    const now = ctx.currentTime;
    let pass = st.passes[0];
    for (const p of st.passes) if (p.time <= now) pass = p;
    if (now < st.passes[0].time) return { tick: st.passes[0].tick, countIn: true };
    return { tick: Math.min(st.range.end - 1, pass.tick + (now - pass.time) / st.spt), countIn: false };
  }

  return { play, stop, swap, position, get playing() {
    return !!st;
  } };
}
