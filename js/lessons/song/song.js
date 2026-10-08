// Song Sketchpad: sketch a song (Sketch view), then practice it on your instrument (Practice view).
// State lives in three stores:
//   songs – the song document (undoable, cached as the last song)
//   ui    – view & practice settings (tempo %, loop, mutes, lenses…)
//   now   – the playhead / cursor (tick) and the notes held on the computer / MIDI keyboard

import { html, render } from '../../vendor/preact-htm.js';
import { loadCss } from '../../ui/dom.js';
import { getAudio } from '../../lib/audio.js';
import { createStore, createSongStore, useStore, loadLastSong, LAST_SONG_KEY } from '../../song/store.js';
import { decodeSong, encodeSong, songToFile, songFromFile, safeFilename, LINK_WARN_LENGTH } from '../../song/codec.js';
import { songToMidi, midiToSong } from '../../song/midi.js';
import { DEMOS, getDemo, newSong } from '../../song/demos.js';
import { buildTimeline, chordIndexAt, instanceAt } from '../../song/timeline.js';
import { createPlayer } from '../../engine/player.js';
import { createMixer, getSampler, playDrum, playClick, SOUNDS } from '../../engine/instruments.js';
import { Toggle, Select, Seg } from '../../ui/preact-controls.js';
import { Sketch } from './sketch.js';
import { Practice } from './practice.js';

loadCss(new URL('./song.css', import.meta.url));

const UI_KEY = 'mlt-song-ui';
const UI_DEFAULTS = {
  view: 'sketch',
  tempoPct: 100,
  loop: 'song', // off | song | section
  countIn: true,
  metronome: false,
  mutes: { chords: false, bass: false, drums: false, click: false, melody: false },
  comp: 'jazzGuitar',
  bassSound: 'bass',
  melodySound: 'altoSax',
  lenses: { guitar: true, piano: true, sax: false },
  scaleOverlay: true,
  labels: 'intervals',
  rootless: false,
  region: 'auto',
  chordView: 'guitar', // sketch chord pictures: off | guitar | piano
  snap: 120, // piano-roll grid & record quantize (ticks)
  keys: false, // computer keyboard plays notes
  keyOctave: 5, // 'a' = C of this octave (5 → C4)
  guitarMode: 'both', // chords | melody | both
  pianoMode: 'keys', // keys | falling
  falling: { melody: true, chords: true, bass: false },
  sax: 'alto',
};

export const PIANO_SOUNDS = ['altoSax', 'piano', 'epiano', 'jazzGuitar', 'nylon'];

// Computer keyboard → semitone offsets (like most DAWs).
const QWERTY = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17 };

export default {
  async mount(root, { params, setParams }) {
    // ---- load the song: share link > demo > new > last song > first demo ----
    let song = null;
    let notice = '';
    try {
      if (params.s) song = await decodeSong(params.s);
    } catch {
      notice = 'That share link could not be read — it may be cut off.';
    }
    if (!song && params.demo && getDemo(params.demo)) song = getDemo(params.demo).make();
    if (!song && params.new) song = newSong();
    if (!song) song = loadLastSong() || DEMOS[0].make();

    let savedUi = {};
    try {
      savedUi = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    } catch {}
    const songs = createSongStore(song);
    try {
      localStorage.setItem(LAST_SONG_KEY, JSON.stringify(songs.song)); // cache as the last song right away
    } catch {}
    const ui = createStore({
      ...UI_DEFAULTS,
      ...savedUi,
      lenses: { ...UI_DEFAULTS.lenses, ...savedUi.lenses },
      falling: { ...UI_DEFAULTS.falling, ...savedUi.falling },
      view: params.view || savedUi.view || 'sketch',
      playing: false,
      recording: null,
      toast: notice,
      midi: null,
    });
    const now = createStore({ tick: 0, countIn: false, held: [] });
    ui.subscribe((s) => {
      const { playing, toast, recording, midi, shareUrl, shareLong, loading, ...persist } = s;
      try {
        localStorage.setItem(UI_KEY, JSON.stringify(persist));
      } catch {}
    });
    setParams({ view: ui.get().view });

    // ---- timeline (memoized on song + voicing options) ----
    let tlCache = { key: null, tl: null };
    const timeline = () => {
      const s = songs.song;
      const { rootless, region } = ui.get();
      const key = [s, rootless, region];
      if (!tlCache.tl || tlCache.key.some((k, i) => k !== key[i])) tlCache = { key, tl: buildTimeline(s, { rootless, region }) };
      return tlCache.tl;
    };

    // ---- audio ----
    let mixer = null;
    const ensureAudio = () => {
      if (mixer) return;
      mixer = createMixer();
      for (const [part, muted] of Object.entries(ui.get().mutes)) mixer.setMuted(part, muted);
    };
    const loadSounds = () => {
      const { comp, bassSound, melodySound } = ui.get();
      const ids = [comp, bassSound];
      if (songs.song.sections.some((s) => s.melody.length) || ui.get().keys) ids.push(melodySound);
      ui.patch({ loading: true });
      Promise.all(ids.map((id) => getSampler(id).load())).then(() => ui.patch({ loading: false }));
    };

    const dispatch = (e, time, spt) => {
      const st = ui.get();
      switch (e.type) {
        case 'click':
          if (e.countIn || st.metronome) playClick(e.accent, time, mixer.bus.click);
          break;
        case 'drum':
          playDrum(e.voice, time, e.vel, mixer.bus.drums);
          break;
        case 'bass':
          getSampler(st.bassSound).play(e.pitch, time, e.dur * spt, e.vel, mixer.bus.bass);
          break;
        case 'melody':
          getSampler(st.melodySound).play(e.pitch, time, e.dur * spt, e.vel, mixer.bus.melody);
          break;
        case 'chord': {
          const c = timeline().chords[e.chord];
          if (!c) break;
          const guitarComp = st.comp === 'jazzGuitar' || st.comp === 'nylon';
          const notes = guitarComp && c.guitar ? c.guitar.notes.map((n) => n.midi) : [...c.piano.lh, ...c.piano.rh];
          const dur = e.dur * spt * 0.96;
          notes.forEach((m, i) => getSampler(st.comp).play(m, time + (guitarComp ? i * 0.014 : 0), dur, e.vel, mixer.bus.chords));
          break;
        }
      }
    };
    const player = createPlayer(dispatch);

    // ---- playhead polling (a timer, so it keeps going when the window isn't painting) ----
    let pollTimer = 0;
    const poll = () => {
      const pos = player.position();
      if (pos) now.patch({ tick: pos.tick, countIn: pos.countIn });
    };

    // ---- live input: computer keyboard & MIDI ----
    const held = new Map(); // pitch → { stop, at, vel }
    const noteOn = (pitch, vel = 96) => {
      if (held.has(pitch)) return;
      ensureAudio();
      const s = getSampler(ui.get().melodySound);
      s.load();
      const rec = recordTick();
      held.set(pitch, { stop: s.start(pitch, vel, mixer.bus.melody), at: rec, vel });
      now.patch({ held: [...held.keys()] });
    };
    const noteOff = (pitch) => {
      const h = held.get(pitch);
      if (!h) return;
      h.stop();
      held.delete(pitch);
      now.patch({ held: [...held.keys()] });
      const end = recordTick();
      if (h.at != null && end != null) commitRecorded(pitch, h.at, end, h.vel);
    };

    // Recording: notes land in the recorded section's melody, quantized to the grid.
    let take = 0;
    const recInstance = () => {
      const id = ui.get().recording;
      return id ? timeline().instances.find((i) => i.section.id === id) : null;
    };
    function recordTick() {
      const inst = recInstance();
      const pos = player.position();
      if (!inst || !pos || pos.countIn) return null;
      return pos.tick - inst.start;
    }
    function commitRecorded(pitch, at, end, vel) {
      const inst = recInstance();
      if (!inst) return;
      const snap = ui.get().snap;
      const q = (t) => Math.round(t / snap) * snap;
      const len = inst.length;
      let start = q(at);
      if (start >= len) start -= len;
      let dur = q(end) - start;
      if (dur <= 0) dur += len; // wrapped around the loop
      dur = Math.max(snap, Math.min(dur, len - start));
      songs.update((d) => {
        const sec = d.sections.find((s) => s.id === inst.section.id);
        sec.melody = sec.melody.filter((n) => !(n.at === start && n.pitch === pitch - d.transpose));
        sec.melody.push({ at: start, dur, pitch: pitch - d.transpose, vel });
      }, `take:${take}`);
    }

    const actions = {
      play() {
        ensureAudio();
        loadSounds();
        const tl = timeline();
        if (!tl.length) return;
        const st = ui.get();
        const cur = Math.min(now.get().tick, tl.length - 1);
        const recInst = recInstance();
        const inst = recInst ?? instanceAt(tl, cur);
        const range = (st.loop === 'section' || recInst) && inst ? { start: inst.start, end: inst.start + inst.length } : null;
        // start on the chord under the cursor (or the section start when recording)
        const ci = chordIndexAt(tl, cur);
        let from = ci >= 0 && (!range || tl.chords[ci].tick >= range.start) ? tl.chords[ci].tick : range?.start ?? 0;
        if (recInst || from < (range?.start ?? 0) || from >= (range?.end ?? tl.length)) from = range?.start ?? from;
        player.play(tl, {
          from,
          range,
          loop: st.loop !== 'off' || !!recInst,
          bpm: (songs.song.tempo * st.tempoPct) / 100,
          countIn: st.countIn || !!recInst,
          onFinish: () => actions.stop(),
        });
        ui.patch({ playing: true });
        clearInterval(pollTimer);
        pollTimer = setInterval(poll, 40);
      },
      /** Pause: stop sound, keep the position. */
      pause() {
        player.stop();
        clearInterval(pollTimer);
        now.patch({ countIn: false });
        ui.patch({ playing: false, recording: null });
      },
      /** Stop: stop and go back to the start (of the looped section, if any). */
      stop() {
        const tl = timeline();
        const inst = instanceAt(tl, now.get().tick);
        actions.pause();
        now.patch({ tick: ui.get().loop === 'section' && inst ? inst.start : 0 });
      },
      toggle() {
        player.playing ? actions.pause() : actions.play();
      },
      /** Restart playback after settings that change tempo or loop range. */
      refresh() {
        if (!player.playing) return;
        const { countIn } = ui.get();
        ui.patch({ countIn: false });
        actions.play();
        ui.patch({ countIn });
      },
      seek(tick) {
        now.patch({ tick, countIn: false });
        if (player.playing) actions.refresh();
      },
      step(dir) {
        const tl = timeline();
        if (!tl.chords.length) return;
        const ci = chordIndexAt(tl, now.get().tick);
        const next = Math.max(0, Math.min(tl.chords.length - 1, ci + dir));
        actions.seek(tl.chords[next].tick);
      },
      /** Previous / next section. "Previous" restarts the current section unless you're at its very start. */
      skip(dir) {
        const tl = timeline();
        if (!tl.instances.length) return;
        const t = now.get().tick;
        const cur = instanceAt(tl, t);
        let i = cur.index + dir;
        if (dir < 0 && t - cur.start > barTicksAt(tl, cur.start)) i = cur.index;
        i = Math.max(0, Math.min(tl.instances.length - 1, i));
        const target = tl.instances[i].start;
        if (player.playing && ui.get().loop === 'section') {
          now.patch({ tick: target });
          actions.refresh();
        } else actions.seek(target);
      },
      record(sectionId) {
        if (ui.get().recording === sectionId) return actions.pause();
        take++;
        ensureAudio();
        if (!ui.get().keys && !ui.get().midi) ui.patch({ keys: true });
        ui.patch({ recording: sectionId });
        const inst = recInstance();
        now.patch({ tick: inst.start });
        actions.play();
      },
      setUi(patch) {
        ui.patch(patch);
        if (patch.mutes && mixer) for (const [p, m] of Object.entries(ui.get().mutes)) mixer.setMuted(p, m);
        if (('comp' in patch || 'bassSound' in patch || 'melodySound' in patch) && mixer) loadSounds();
        if ('tempoPct' in patch || 'loop' in patch) actions.refresh();
        if ('rootless' in patch || 'region' in patch) player.playing && player.swap(timeline(), currentRange());
        if ('view' in patch) setParams({ view: patch.view });
      },
      /** Click-to-hear on lenses, rolls and grids. */
      audition(midis, sound) {
        ensureAudio();
        const s = getSampler(sound);
        s.load();
        const t = getAudio().ctx.currentTime + 0.01;
        midis.forEach((m) => s.play(m, t, 0.6, 95, mixer.bus.chords));
      },
      auditionDrum(voice, vel = 90) {
        ensureAudio();
        playDrum(voice, getAudio().ctx.currentTime + 0.01, vel, mixer.bus.drums);
      },
      noteOn,
      noteOff,
      async connectMidi() {
        if (!navigator.requestMIDIAccess) return ui.patch({ midi: 'unsupported' });
        try {
          const access = await navigator.requestMIDIAccess();
          const hook = () => {
            let n = 0;
            for (const input of access.inputs.values()) {
              n++;
              input.onmidimessage = (m) => {
                const [st, note, vel] = m.data;
                const type = st & 0xf0;
                if (type === 0x90 && vel > 0) noteOn(note, vel);
                else if (type === 0x80 || (type === 0x90 && vel === 0)) noteOff(note);
              };
            }
            ui.patch({ midi: n ? `${n} MIDI input${n > 1 ? 's' : ''}` : 'no MIDI devices' });
          };
          access.onstatechange = hook;
          hook();
        } catch {
          ui.patch({ midi: 'MIDI access denied' });
        }
      },
      toast(msg) {
        ui.patch({ toast: msg });
        clearTimeout(actions._t);
        actions._t = setTimeout(() => ui.patch({ toast: '' }), 2600);
      },
      async share() {
        const code = await encodeSong(songs.song);
        const url = `${location.origin}${location.pathname}#/lesson/song?s=${code}`;
        ui.patch({ shareUrl: url, shareLong: url.length > LINK_WARN_LENGTH });
        try {
          await navigator.clipboard.writeText(url);
          actions.toast('Share link copied to the clipboard');
        } catch {}
      },
      download(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
      exportFile() {
        actions.download(songToFile(songs.song), `${safeFilename(songs.song.title)}.song.json`);
      },
      exportMidi() {
        const bytes = songToMidi(songs.song, timeline());
        actions.download(new Blob([bytes], { type: 'audio/midi' }), `${safeFilename(songs.song.title)}.mid`);
      },
      async importFile(file) {
        try {
          actions.pause();
          const isMidi = /\.(mid|midi|smf)$/i.test(file.name);
          const song = isMidi ? midiToSong(await file.arrayBuffer(), { title: file.name.replace(/\.[^.]+$/, '') }) : await songFromFile(file);
          songs.replace(song);
          now.patch({ tick: 0, countIn: false });
          actions.toast(`Opened “${songs.song.title}”`);
        } catch (err) {
          actions.toast(`Couldn’t open that file${err?.message ? ` (${err.message})` : ''}`);
        }
      },
      load(song) {
        actions.pause();
        songs.replace(song);
        now.patch({ tick: 0, countIn: false });
      },
    };

    function currentRange() {
      const tl = timeline();
      const recInst = recInstance();
      if (recInst) return { start: recInst.start, end: recInst.start + recInst.length };
      if (ui.get().loop !== 'section') return null;
      const inst = instanceAt(tl, now.get().tick);
      return inst ? { start: inst.start, end: inst.start + inst.length } : null;
    }
    // Song edits while playing: hot-swap the timeline, keep playing.
    songs.subscribe(() => player.playing && player.swap(timeline(), currentRange()));

    const app = { songs, ui, now, player, actions, timeline };

    const keyPitch = new Map(); // computer key → the pitch it started
    const onKey = (e) => {
      const typing = e.target.closest?.('input, select, textarea, [contenteditable]');
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !typing) {
        e.shiftKey ? songs.redo() : songs.undo();
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y' && !typing) {
        songs.redo();
        e.preventDefault();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (ui.get().keys && !e.target.closest?.('.pianoroll')) {
        if (k in QWERTY) {
          if (!e.repeat && !keyPitch.has(k)) {
            const pitch = ui.get().keyOctave * 12 + QWERTY[k];
            keyPitch.set(k, pitch);
            noteOn(pitch);
          }
          e.preventDefault();
          return;
        }
        if (k === 'z' || k === 'x') {
          ui.patch({ keyOctave: Math.max(2, Math.min(7, ui.get().keyOctave + (k === 'x' ? 1 : -1))) });
          return;
        }
      }
      if (e.key === ' ') actions.toggle();
      else if (e.key === 'Escape') actions.stop();
      else if (e.key === 'ArrowRight' && e.shiftKey) actions.skip(1);
      else if (e.key === 'ArrowLeft' && e.shiftKey) actions.skip(-1);
      else if (e.key === 'ArrowRight' && ui.get().view === 'practice') actions.step(1);
      else if (e.key === 'ArrowLeft' && ui.get().view === 'practice') actions.step(-1);
      else return;
      e.preventDefault();
    };
    const onKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if (keyPitch.has(k)) {
        noteOff(keyPitch.get(k));
        keyPitch.delete(k);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);

    render(html`<${App} app=${app} />`, root);

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      for (const p of [...held.keys()]) noteOff(p);
      player.stop();
      clearInterval(pollTimer);
      render(null, root);
    };
  },
};

function barTicksAt(tl, tick) {
  const b = tl.bars.find((x) => tick >= x.tick && tick < x.tick + x.length);
  return b ? b.length : 1920;
}

// ---------------------------------------------------------------------------

function App({ app }) {
  const view = useStore(app.ui, (s) => s.view);
  const toast = useStore(app.ui, (s) => s.toast);
  return html`<div class="song-app">
    <${TopBar} app=${app} />
    <${Transport} app=${app} />
    ${view === 'sketch' ? html`<${Sketch} app=${app} />` : html`<${Practice} app=${app} />`}
    <${ShareDialog} app=${app} />
    <div class=${`toast${toast ? ' show' : ''}`} role="status">${toast}</div>
  </div>`;
}

function TopBar({ app }) {
  const { songs, ui, actions } = app;
  const state = useStore(songs);
  const view = useStore(ui, (s) => s.view);
  let fileInput;
  return html`<header class="song-top">
    <input
      class="song-title"
      value=${state.song.title}
      aria-label="Song title"
      onInput=${(e) => songs.update((d) => (d.title = e.target.value), 'title')}
    />
    <${Seg}
      value=${view}
      options=${[
        { value: 'sketch', label: '✎ Sketch' },
        { value: 'practice', label: '♫ Practice' },
      ]}
      onChange=${(v) => actions.setUi({ view: v })}
    />
    <div class="song-actions">
      <button class="icon-btn" type="button" title="Undo (Ctrl+Z)" disabled=${!state.canUndo} onClick=${() => songs.undo()}>↶</button>
      <button class="icon-btn" type="button" title="Redo (Ctrl+Shift+Z)" disabled=${!state.canRedo} onClick=${() => songs.redo()}>↷</button>
      <details class="menu">
        <summary class="btn">Song ▾</summary>
        <div class="menu-list" onClick=${(e) => e.target.closest('button') && e.currentTarget.parentElement.removeAttribute('open')}>
          <button type="button" onClick=${() => actions.share()}>🔗 Copy share link</button>
          <button type="button" onClick=${() => actions.exportFile()}>⤓ Save as song file (.json)</button>
          <button type="button" onClick=${() => actions.exportMidi()}>⤓ Export MIDI (.mid)</button>
          <button type="button" onClick=${() => fileInput.click()}>⤒ Open song or MIDI file…</button>
          <hr />
          <button
            type="button"
            onClick=${() => confirm('Start a new song? The current one is only kept until you replace it — copy a share link or save a file first if you want to keep it.') && actions.load(newSong())}
          >
            ＋ New song
          </button>
          ${DEMOS.map((d) => html`<button type="button" onClick=${() => actions.load(d.make())}>♪ Demo: ${d.title}</button>`)}
        </div>
      </details>
      <input
        type="file"
        accept=".json,.mid,.midi,application/json,audio/midi"
        hidden
        ref=${(el) => (fileInput = el)}
        onChange=${(e) => {
          if (e.target.files[0]) actions.importFile(e.target.files[0]);
          e.target.value = '';
        }}
      />
    </div>
  </header>`;
}

function ShareDialog({ app }) {
  const url = useStore(app.ui, (s) => s.shareUrl);
  const long = useStore(app.ui, (s) => s.shareLong);
  if (!url) return null;
  return html`<div class="share-dialog panel" role="dialog" aria-label="Share link">
    <p><strong>Share link</strong> — anyone with this link opens a copy of this song.</p>
    <input class="share-url" readonly value=${url} onFocus=${(e) => e.target.select()} />
    ${long && html`<p class="muted">This link is long; some apps may cut it off. Saving a file is safer for big songs.</p>`}
    <div class="share-actions">
      <button class="btn" type="button" onClick=${() => navigator.clipboard?.writeText(url).then(() => app.actions.toast('Copied'))}>Copy</button>
      <button class="btn" type="button" onClick=${() => app.ui.patch({ shareUrl: null })}>Close</button>
    </div>
  </div>`;
}

function Transport({ app }) {
  const { ui, songs, actions } = app;
  const st = useStore(ui);
  const tempo = useStore(songs, (s) => s.song.tempo);
  const setMute = (part, v) => actions.setUi({ mutes: { ...st.mutes, [part]: !v } });
  const compOptions = ['jazzGuitar', 'nylon', 'piano', 'epiano'].map((id) => ({ value: id, label: SOUNDS[id].label }));
  return html`<section class=${`transport-bar panel${st.recording ? ' recording' : ''}`}>
    <div class="transport-buttons" role="group" aria-label="Transport">
      <button class="tbtn" type="button" title="Previous section (Shift+←)" onClick=${() => actions.skip(-1)}>⏮</button>
      <button class=${`tbtn main${st.playing ? ' on' : ''}`} type="button" title="Play / pause (Space)" onClick=${() => actions.toggle()}>
        ${st.playing ? '❚❚' : '▶'}
      </button>
      <button class="tbtn" type="button" title="Stop and return to the start (Esc)" onClick=${() => actions.stop()}>■</button>
      <button class="tbtn" type="button" title="Next section (Shift+→)" onClick=${() => actions.skip(1)}>⏭</button>
    </div>
    <${Position} app=${app} />
    <div class="transport-group">
      <label class="tempo" title="Practice speed — slows down without changing pitch">
        <span class="field-label">Speed</span>
        <input type="range" min="40" max="130" step="5" value=${st.tempoPct} onInput=${(e) => actions.setUi({ tempoPct: +e.target.value })} />
        <span class="tempo-val">${Math.round((tempo * st.tempoPct) / 100)} bpm <small>(${st.tempoPct}%)</small></span>
      </label>
      <${Select}
        title="Loop"
        value=${st.loop}
        options=${[
          { value: 'off', label: 'Play once' },
          { value: 'song', label: 'Loop song' },
          { value: 'section', label: 'Loop section' },
        ]}
        onChange=${(v) => actions.setUi({ loop: v })}
      />
      <${Toggle} label="Count-in" value=${st.countIn} onChange=${(v) => actions.setUi({ countIn: v })} />
      <${Toggle} label="Click" value=${st.metronome} onChange=${(v) => actions.setUi({ metronome: v })} />
    </div>
    <div class="transport-group mutes" role="group" aria-label="Parts">
      ${[
        ['chords', 'Chords'],
        ['bass', 'Bass'],
        ['drums', 'Drums'],
        ['melody', 'Melody'],
      ].map(
        ([p, label]) => html`<button
          type="button"
          class=${`chip${st.mutes[p] ? '' : ' active'}`}
          aria-pressed=${!st.mutes[p]}
          title=${st.mutes[p] ? `Unmute ${label.toLowerCase()}` : `Mute ${label.toLowerCase()} (play it yourself!)`}
          onClick=${() => setMute(p, st.mutes[p])}
        >
          ${label}
        </button>`,
      )}
      <${Select} title="Chord sound" value=${st.comp} options=${compOptions} onChange=${(v) => actions.setUi({ comp: v })} />
      <${KeysButton} app=${app} />
      ${st.loading && html`<span class="loading" title="Loading instrument samples">loading sounds…</span>`}
    </div>
  </section>`;
}

function KeysButton({ app }) {
  const st = useStore(app.ui);
  const octave = st.keyOctave - 1;
  return html`<span class="keys-ctl">
    <button
      type="button"
      class=${`chip${st.keys ? ' active' : ''}`}
      title="Play notes with your computer keyboard: A W S E D F T G Y H U J K = one octave, Z / X = octave down / up"
      onClick=${() => app.actions.setUi({ keys: !st.keys })}
    >
      ⌨ Keys${st.keys ? ` · C${octave}` : ''}
    </button>
    <button type="button" class=${`chip${st.midi?.includes('input') ? ' active' : ''}`} title=${st.midi || 'Connect a MIDI keyboard (Chrome / Edge)'} onClick=${() => app.actions.connectMidi()}>
      ${st.midi?.includes('input') ? '🎹 MIDI' : '🎹 Connect MIDI'}
    </button>
  </span>`;
}

function Position({ app }) {
  const tick = useStore(app.now, (s) => Math.floor(s.tick / 60));
  const countIn = useStore(app.now, (s) => s.countIn);
  const recording = useStore(app.ui, (s) => s.recording);
  useStore(app.songs, (s) => s.song);
  const tl = app.timeline();
  const t = tick * 60;
  const inst = tl.instances.length ? instanceAt(tl, t) : null;
  const bar = tl.bars.filter((b) => b.inst === inst?.index).findIndex((b) => t >= b.tick && t < b.tick + b.length);
  const pct = tl.length ? (t / tl.length) * 100 : 0;
  return html`<div class="position" title="Section · bar">
    <span class="pos-label">
      ${recording && html`<span class="rec-dot">● REC</span> `}
      ${countIn ? 'Count-in…' : inst ? `${inst.section.name} · bar ${bar + 1}/${inst.section.bars}` : '—'}
    </span>
    <span class="pos-track"><span class="pos-fill" style=${{ width: `${pct}%` }}></span></span>
  </div>`;
}
