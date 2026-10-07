// Tiny plucked-string synth (Karplus–Strong), no samples needed.

let ctx = null;
let master = null;
const cache = new Map();

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function pluckBuffer(midi) {
  if (cache.has(midi)) return cache.get(midi);
  const ac = audio();
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const sr = ac.sampleRate;
  const length = Math.floor(sr * 2.2);
  const buf = ac.createBuffer(1, length, sr);
  const data = buf.getChannelData(0);
  const period = Math.round(sr / freq);
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  // Higher notes decay a bit faster, like a real string.
  const decay = 0.996 - Math.min(0.006, freq / 200000);
  let idx = 0;
  for (let i = 0; i < length; i++) {
    const next = (idx + 1) % period;
    const v = ring[idx];
    ring[idx] = decay * 0.5 * (ring[idx] + ring[next]);
    data[i] = v;
    idx = next;
  }
  cache.set(midi, buf);
  return buf;
}

export function playMidi(midi, when = 0, gain = 0.8) {
  const ac = audio();
  const src = ac.createBufferSource();
  src.buffer = pluckBuffer(midi);
  const g = ac.createGain();
  const t = ac.currentTime + when;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
  src.connect(g).connect(master);
  src.start(t);
  src.stop(t + 2.2);
}

/** Strum a chord: notes low → high with a small delay between strings. */
export function strum(midis, { spread = 0.035, when = 0, gain = 0.6 } = {}) {
  [...midis].sort((a, b) => a - b).forEach((m, i) => playMidi(m, when + i * spread, gain));
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Sustained root + fifth drone, so you can hear a scale's colour against its tonic.
 * Returns { setRoot(midi), stop() }.
 */
export function startDrone(midi) {
  const ac = audio();
  const out = ac.createGain();
  out.gain.value = 0;
  out.gain.linearRampToValueAtTime(0.16, ac.currentTime + 0.8);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 700;
  filter.Q.value = 0.3;
  filter.connect(out).connect(master);

  // A slow wobble on the filter keeps it from sounding static.
  const lfo = ac.createOscillator();
  const lfoGain = ac.createGain();
  lfo.frequency.value = 0.15;
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();

  const voices = [
    { offset: 0, detune: -6, type: 'sawtooth', gain: 0.5 },
    { offset: 0, detune: 6, type: 'sawtooth', gain: 0.5 },
    { offset: 7, detune: 0, type: 'triangle', gain: 0.45 },
    { offset: -12, detune: 0, type: 'sine', gain: 0.7 },
  ].map((v) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = v.type;
    osc.detune.value = v.detune;
    g.gain.value = v.gain;
    osc.connect(g).connect(filter);
    osc.start();
    return { osc, offset: v.offset };
  });

  const setRoot = (m) => {
    for (const v of voices) v.osc.frequency.setTargetAtTime(mtof(m + v.offset), ac.currentTime, 0.08);
  };
  setRoot(midi);

  return {
    setRoot,
    stop() {
      const t = ac.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.4);
      setTimeout(() => {
        voices.forEach((v) => v.osc.stop());
        lfo.stop();
        out.disconnect();
      }, 500);
    },
  };
}

/**
 * Play a sequence of midi notes. Calls onStep(i) as each note sounds.
 * Returns a stop() function.
 */
export function playSequence(midis, { bpm = 160, onStep, onDone } = {}) {
  const stepMs = 60000 / bpm;
  const timers = [];
  midis.forEach((m, i) => {
    timers.push(
      setTimeout(() => {
        playMidi(m);
        onStep?.(i);
      }, i * stepMs),
    );
  });
  timers.push(setTimeout(() => onDone?.(), midis.length * stepMs + 150));
  return () => {
    timers.forEach(clearTimeout);
    onDone?.();
  };
}
