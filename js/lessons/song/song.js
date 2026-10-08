// Song Sketchpad: sketch a song (Sketch view), then practice it on your instrument (Practice view).
// State lives in three stores:
//   songs – the song document (undoable, cached as the last song)
//   ui    – view & practice settings (tempo %, loop, mutes, lenses…)
//   now   – the playhead / cursor (tick, chord index, section instance)

import { html, render } from '../../vendor/preact-htm.js';
import { loadCss } from '../../ui/dom.js';
import { getAudio } from '../../lib/audio.js';
import { createStore, createSongStore, useStore, loadLastSong, LAST_SONG_KEY } from '../../song/store.js';
import { decodeSong, encodeSong, songToFile, songFromFile, safeFilename, LINK_WARN_LENGTH } from '../../song/codec.js';
import { DEMOS, getDemo, newSong } from '../../song/demos.js';
import { buildTimeline, chordIndexAt, instanceAt } from '../../song/timeline.js';
import { createPlayer } from '../../engine/player.js';
import { createMixer, getSampler, playDrum, playClick, SOUNDS } from '../../engine/instruments.js';
import { Seg, Toggle, Select } from '../../ui/preact-controls.js';
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
  lenses: { guitar: true, piano: true },
  scaleOverlay: true,
  labels: 'intervals',
  rootless: false,
  region: 'auto',
};

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
    const ui = createStore({ ...UI_DEFAULTS, ...savedUi, view: params.view || savedUi.view || 'sketch', playing: false, toast: notice });
    const now = createStore({ tick: 0, countIn: false });
    ui.subscribe((s) => {
      const { playing, toast, ...persist } = s;
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
      const { comp, bassSound } = ui.get();
      const jobs = [comp, bassSound].map((id) => getSampler(id).load());
      ui.patch({ loading: true });
      Promise.all(jobs).then(() => ui.patch({ loading: false }));
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
          getSampler('altoSax').play(e.pitch, time, e.dur * spt, e.vel, mixer.bus.melody);
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

    // ---- playhead polling ----
    // A timer (not requestAnimationFrame) so the display keeps up even when the window isn't painting.
    let pollTimer = 0;
    const poll = () => {
      const pos = player.position();
      if (pos) now.set({ tick: pos.tick, countIn: pos.countIn });
    };

    const actions = {
      play() {
        ensureAudio();
        loadSounds();
        const tl = timeline();
        if (!tl.length) return;
        const st = ui.get();
        const cur = Math.min(now.get().tick, tl.length - 1);
        const inst = instanceAt(tl, cur);
        const range = st.loop === 'section' && inst ? { start: inst.start, end: inst.start + inst.length } : null;
        // start on the chord under the cursor
        const ci = chordIndexAt(tl, cur);
        const from = ci >= 0 && (!range || tl.chords[ci].tick >= range.start) ? tl.chords[ci].tick : range?.start ?? 0;
        player.play(tl, {
          from,
          range,
          loop: st.loop !== 'off',
          bpm: (songs.song.tempo * st.tempoPct) / 100,
          countIn: st.countIn,
          onFinish: () => actions.stop(true),
        });
        ui.patch({ playing: true });
        clearInterval(pollTimer);
        pollTimer = setInterval(poll, 40);
      },
      stop(atEnd = false) {
        player.stop();
        clearInterval(pollTimer);
        if (atEnd) now.set({ tick: 0, countIn: false });
        else now.set({ tick: now.get().tick, countIn: false });
        ui.patch({ playing: false });
      },
      toggle() {
        player.playing ? actions.stop() : actions.play();
      },
      /** Restart playback after settings that change the timeline or tempo. */
      refresh() {
        if (player.playing) {
          const { countIn } = ui.get();
          ui.patch({ countIn: false });
          actions.play();
          ui.patch({ countIn });
        }
      },
      seek(tick) {
        now.set({ tick, countIn: false });
        if (player.playing) actions.refresh();
      },
      step(dir) {
        const tl = timeline();
        if (!tl.chords.length) return;
        const ci = chordIndexAt(tl, now.get().tick);
        const next = Math.max(0, Math.min(tl.chords.length - 1, ci + dir));
        actions.seek(tl.chords[next].tick);
      },
      setUi(patch) {
        ui.patch(patch);
        if (patch.mutes && mixer) for (const [p, m] of Object.entries(ui.get().mutes)) mixer.setMuted(p, m);
        if ('comp' in patch || 'bassSound' in patch) mixer && loadSounds();
        if ('tempoPct' in patch || 'loop' in patch || 'rootless' in patch || 'region' in patch) actions.refresh();
        if ('view' in patch) setParams({ view: patch.view });
      },
      /** Click-to-hear on the lenses. */
      audition(midis, sound) {
        ensureAudio();
        const s = getSampler(sound);
        s.load();
        const t = getAudio().ctx.currentTime + 0.01;
        midis.forEach((m) => s.play(m, t, 0.9, 95, mixer.bus.chords));
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
      exportFile() {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(songToFile(songs.song));
        a.download = `${safeFilename(songs.song.title)}.song.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
      async importFile(file) {
        try {
          actions.stop();
          songs.replace(await songFromFile(file));
          now.set({ tick: 0, countIn: false });
          actions.toast(`Opened “${songs.song.title}”`);
        } catch {
          actions.toast('That file is not a song file');
        }
      },
      load(song) {
        actions.stop();
        songs.replace(song);
        now.set({ tick: 0, countIn: false });
      },
    };
    // Song edits while playing: rebuild and keep going.
    songs.subscribe(() => actions.refresh());

    const app = { songs, ui, now, player, actions, timeline };

    const onKey = (e) => {
      const typing = e.target.closest?.('input, select, textarea, [contenteditable]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.shiftKey ? songs.redo() : songs.undo();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
        songs.redo();
        e.preventDefault();
      } else if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      else if (e.key === ' ') {
        actions.toggle();
        e.preventDefault();
      } else if (e.key === 'ArrowRight' && ui.get().view === 'practice') actions.step(1), e.preventDefault();
      else if (e.key === 'ArrowLeft' && ui.get().view === 'practice') actions.step(-1), e.preventDefault();
    };
    window.addEventListener('keydown', onKey);

    render(html`<${App} app=${app} />`, root);

    return () => {
      window.removeEventListener('keydown', onKey);
      player.stop();
      clearInterval(pollTimer);
      render(null, root);
    };
  },
};

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
          <button type="button" onClick=${() => actions.exportFile()}>⤓ Save as file</button>
          <button type="button" onClick=${() => fileInput.click()}>⤒ Open file…</button>
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
        accept=".json,application/json"
        hidden
        ref=${(el) => (fileInput = el)}
        onChange=${(e) => e.target.files[0] && actions.importFile(e.target.files[0])}
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
  return html`<section class="transport-bar panel">
    <button class=${`btn btn-primary play${st.playing ? ' on' : ''}`} type="button" onClick=${() => actions.toggle()} title="Play / stop (Space)">
      ${st.playing ? '■ Stop' : '▶ Play'}
    </button>
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
      ${st.loading && html`<span class="loading" title="Loading instrument samples">loading sounds…</span>`}
    </div>
  </section>`;
}

function Position({ app }) {
  const tick = useStore(app.now, (s) => Math.floor(s.tick / 60));
  const countIn = useStore(app.now, (s) => s.countIn);
  useStore(app.songs, (s) => s.song);
  const tl = app.timeline();
  const t = tick * 60;
  const inst = tl.instances.length ? instanceAt(tl, t) : null;
  const bar = tl.bars.filter((b) => b.inst === inst?.index).findIndex((b) => t >= b.tick && t < b.tick + b.length);
  const pct = tl.length ? (t / tl.length) * 100 : 0;
  return html`<div class="position" title="Section · bar">
    <span class="pos-label">${countIn ? 'Count-in…' : inst ? `${inst.section.name} · bar ${bar + 1}/${inst.section.bars}` : '—'}</span>
    <span class="pos-track"><span class="pos-fill" style=${{ width: `${pct}%` }}></span></span>
  </div>`;
}
