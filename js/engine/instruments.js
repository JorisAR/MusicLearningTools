// Instruments for song playback: sampled pitched instruments (loaded on demand),
// synthesized drums and a metronome click, routed through a small mixer.

import { getAudio } from '../lib/audio.js';
import { FLAT_NAMES } from '../lib/theory.js';

// FluidR3 GM (MIT-licensed SoundFont), one mp3 per note, served from GitHub Pages with CORS.
const SAMPLE_BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';

export const SOUNDS = {
  jazzGuitar: { label: 'Jazz guitar', file: 'electric_guitar_jazz', range: [40, 86], release: 0.25, gain: 1.1 },
  nylon: { label: 'Nylon guitar', file: 'acoustic_guitar_nylon', range: [40, 86], release: 0.3, gain: 1 },
  piano: { label: 'Piano', file: 'acoustic_grand_piano', range: [33, 96], release: 0.35, gain: 0.8 },
  epiano: { label: 'Electric piano', file: 'electric_piano_1', range: [33, 96], release: 0.3, gain: 0.9 },
  bass: { label: 'Upright bass', file: 'acoustic_bass', range: [28, 64], release: 0.12, gain: 1.2 },
  fingerBass: { label: 'Electric bass', file: 'electric_bass_finger', range: [28, 64], release: 0.12, gain: 1.1 },
  altoSax: { label: 'Alto sax', file: 'alto_sax', range: [49, 82], release: 0.12, gain: 0.9 },
};

const noteFile = (m) => `${FLAT_NAMES[m % 12]}${Math.floor(m / 12) - 1}.mp3`;
const samplers = new Map();

/** A sampled instrument. Plays a simple synth until its samples have loaded. */
export function getSampler(id) {
  if (samplers.has(id)) return samplers.get(id);
  const def = SOUNDS[id];
  const buffers = new Map();
  const s = {
    id,
    label: def.label,
    status: 'idle', // idle | loading | ready | error
    ready: null,
    load() {
      if (this.ready) return this.ready;
      const { ctx } = getAudio();
      this.status = 'loading';
      const jobs = [];
      for (let m = def.range[0]; m <= def.range[1]; m += 3) {
        jobs.push(
          fetch(SAMPLE_BASE + `${def.file}-mp3/` + noteFile(m))
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
            .then((b) => ctx.decodeAudioData(b))
            .then((buf) => buffers.set(m, buf))
            .catch(() => {}),
        );
      }
      this.ready = Promise.all(jobs).then(() => {
        this.status = buffers.size ? 'ready' : 'error';
        return this;
      });
      return this.ready;
    },
    play(midi, time, dur, vel, dest) {
      const { ctx } = getAudio();
      const g = ctx.createGain();
      g.connect(dest);
      const amp = (vel / 127) * def.gain;
      if (!buffers.size) return synthNote(ctx, g, midi, time, dur, amp * 0.5);
      let best = null;
      for (const m of buffers.keys()) if (best == null || Math.abs(m - midi) < Math.abs(best - midi)) best = m;
      const src = ctx.createBufferSource();
      src.buffer = buffers.get(best);
      src.playbackRate.value = Math.pow(2, (midi - best) / 12);
      src.connect(g);
      g.gain.setValueAtTime(amp, time);
      g.gain.setTargetAtTime(0, time + dur, def.release / 3);
      src.start(time);
      src.stop(time + dur + def.release * 2 + 0.05);
    },
  };
  samplers.set(id, s);
  return s;
}

function synthNote(ctx, dest, midi, time, dur, amp) {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
  osc.connect(dest);
  dest.gain.setValueAtTime(0, time);
  dest.gain.linearRampToValueAtTime(amp, time + 0.01);
  dest.gain.setTargetAtTime(amp * 0.4, time + 0.02, 0.2);
  dest.gain.setTargetAtTime(0, time + dur, 0.08);
  osc.start(time);
  osc.stop(time + dur + 0.4);
}

// --- drums (synthesized; no download) -------------------------------------------

let noise = null;
function noiseBuffer(ctx) {
  if (noise) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

function noiseHit(ctx, dest, time, { type, freq, q = 1, decay, amp }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(amp, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + decay);
  src.connect(f).connect(g).connect(dest);
  src.start(time);
  src.stop(time + decay + 0.02);
}

function toneHit(ctx, dest, time, { from, to, decay, amp, type = 'sine' }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, time);
  osc.frequency.exponentialRampToValueAtTime(to, time + decay * 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(amp, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + decay);
  osc.connect(g).connect(dest);
  osc.start(time);
  osc.stop(time + decay + 0.02);
}

export function playDrum(voice, time, vel, dest) {
  const { ctx } = getAudio();
  const a = vel / 127;
  switch (voice) {
    case 'kick':
      return toneHit(ctx, dest, time, { from: 140, to: 42, decay: 0.38, amp: 1.1 * a });
    case 'snare':
    case 'ghost':
      noiseHit(ctx, dest, time, { type: 'bandpass', freq: 1900, q: 0.7, decay: 0.18, amp: 0.9 * a });
      return toneHit(ctx, dest, time, { from: 230, to: 170, decay: 0.09, amp: 0.5 * a, type: 'triangle' });
    case 'rim':
      return toneHit(ctx, dest, time, { from: 1750, to: 1600, decay: 0.04, amp: 0.5 * a, type: 'square' });
    case 'hat':
      return noiseHit(ctx, dest, time, { type: 'highpass', freq: 7500, decay: 0.05, amp: 0.45 * a });
    case 'pedal':
      return noiseHit(ctx, dest, time, { type: 'highpass', freq: 6000, decay: 0.035, amp: 0.3 * a });
    case 'hatOpen':
      return noiseHit(ctx, dest, time, { type: 'highpass', freq: 7000, decay: 0.32, amp: 0.4 * a });
    case 'ride':
      noiseHit(ctx, dest, time, { type: 'bandpass', freq: 5200, q: 2, decay: 0.45, amp: 0.28 * a });
      return toneHit(ctx, dest, time, { from: 3400, to: 3300, decay: 0.25, amp: 0.05 * a });
    case 'crash':
      return noiseHit(ctx, dest, time, { type: 'highpass', freq: 3800, decay: 1.5, amp: 0.5 * a });
  }
}

export function playClick(accent, time, dest) {
  const { ctx } = getAudio();
  toneHit(ctx, dest, time, { from: [900, 1250, 1700][accent], to: [900, 1250, 1700][accent], decay: 0.05, amp: [0.35, 0.5, 0.7][accent] });
}

// --- mixer -------------------------------------------------------------------------

export const PARTS = ['chords', 'bass', 'drums', 'melody', 'click'];

export function createMixer() {
  const { ctx, master } = getAudio();
  const bus = {};
  const levels = { chords: 0.75, bass: 0.9, drums: 0.7, melody: 0.9, click: 0.8 };
  for (const p of PARTS) {
    bus[p] = ctx.createGain();
    bus[p].gain.value = levels[p];
    bus[p].connect(master);
  }
  return {
    bus,
    setMuted(part, muted) {
      bus[part].gain.setTargetAtTime(muted ? 0 : levels[part], ctx.currentTime, 0.02);
    },
  };
}
