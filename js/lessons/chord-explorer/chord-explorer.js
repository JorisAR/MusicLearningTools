// Chord Explorer
// • Chord finder: type any chord symbol → every sensible voicing, grouped by bass string.
//   Empty input shows a library of movable jazz shapes.
// • "+ Add to song" appends the chord (with the chosen voicing) to your current song in the
//   Song Sketchpad, which is where progressions, voice-leading and playback now live.

import { h, loadCss } from '../../ui/dom.js';
import { segmented, toggle, select } from '../../ui/controls.js';
import { createFretboard } from '../../ui/fretboard.js';
import { chordDiagram } from '../../ui/chord-diagram.js';
import { KEYS, pretty, mod12 } from '../../lib/theory.js';
import { TUNINGS, midiAt } from '../../lib/guitar.js';
import {
  parseChord,
  findVoicings,
  groupByBassString,
  bassStringLabel,
  toneLabel,
  toneKind,
  noteNameFor,
  CHORD_LIBRARY,
  librarySymbol,
  randomChord,
} from '../../lib/chords.js';
import { loadLastSong, LAST_SONG_KEY } from '../../song/store.js';
import { createSong, normalizeSong, barTicks } from '../../song/model.js';
import { strum } from '../../lib/audio.js';

loadCss(new URL('./chord-explorer.css', import.meta.url));

const STORAGE_KEY = 'mlt-chord-explorer';
const DEFAULTS = {
  chord: '',
  labels: 'intervals', // intervals | notes | none
  bass: 'root', // root | any
  open: '1',
  root: 'C', // shape library root
};
const EXAMPLES = ['Cmaj9', 'C/D', 'Dm11', 'G13', 'Bb7#9', 'Ebmaj7#11', 'F#m7b5', 'A7alt', 'D6/9', 'E9sus4'];
const tuning = TUNINGS.standard;
const NECK_FRETS = 15;

// Voicing search is the expensive bit; cache it per chord + options.
const cache = new Map();
function voicingsFor(chord, opts) {
  const k = `${chord.symbol}|${JSON.stringify(opts)}`;
  if (!cache.has(k)) cache.set(k, findVoicings(chord, opts));
  return cache.get(k);
}

export default {
  mount(root, { params, setParams }) {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {}
    const state = { ...DEFAULTS, ...(Object.keys(params).length ? params : saved) };
    for (const k of Object.keys(state)) if (!(k in DEFAULTS)) delete state[k]; // drop old progression-builder params
    let selKey = null; // selected voicing in the chord finder
    const expanded = new Set();

    const opts = () => ({ bass: state.bass, allowOpen: state.open === '1' });
    function candidatesFor(chord) {
      let v = voicingsFor(chord, opts());
      if (!v.length && state.bass === 'root') v = voicingsFor(chord, { ...opts(), bass: 'any' });
      if (!v.length) v = voicingsFor(chord, { ...opts(), bass: 'any', maxSpan: 4 });
      return v;
    }

    function save() {
      setParams(state);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {}
    }
    function set(patch) {
      Object.assign(state, patch);
      save();
      render();
    }

    // --- shared controls ----------------------------------------------------
    const labelsCtl = select({
      label: 'Labels',
      options: [
        { value: 'intervals', label: 'Intervals' },
        { value: 'notes', label: 'Note names' },
        { value: 'none', label: 'None' },
      ],
      value: state.labels,
      onChange: (labels) => set({ labels }),
    });
    const bassCtl = segmented({
      label: 'Bass',
      options: [
        { value: 'root', label: 'Root in bass', title: 'Root (or slash note) is the lowest note' },
        { value: 'any', label: 'Rootless & inversions', title: 'Let the bass player have the root' },
      ],
      value: state.bass,
      onChange: (bass) => set({ bass }),
    });
    const openCtl = toggle({
      label: 'Open strings',
      value: state.open === '1',
      onChange: (v) => set({ open: v ? '1' : '0' }),
    });

    const legend = h(
      'div',
      { class: 'legend' },
      [
        ['root', 'Root'],
        ['guide', 'Guide tones (3rd, 7th, 6th, sus)'],
        ['color', 'Extensions & alterations'],
        ['', '5th'],
      ].map(([c, t]) => h('span', { class: 'legend-item' }, h('span', { class: `legend-dot ${c}` }), t)),
    );

    // --- chord finder -------------------------------------------------------
    const chordInput = h('input', {
      class: 'chord-input',
      type: 'text',
      value: state.chord,
      placeholder: 'Type a chord… Cmaj9, C/D, F#m7b5, G13#11',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      aria: { label: 'Chord symbol' },
      oninput: debounce((e) => {
        selKey = null;
        set({ chord: e.target.value });
      }, 150),
    });
    const surprise = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => {
          const sym = randomChord();
          chordInput.value = sym;
          selKey = null;
          set({ chord: sym });
          const ch = parseChord(sym);
          const v = ch && candidatesFor(ch)[0];
          if (v) play(v);
        },
      },
      '🎲 Surprise me',
    );
    const chordResults = h('div', { class: 'chord-results' });
    const chordNeckWrap = h('div', { class: 'board-scroll' });
    const chordNeck = createFretboard({ frets: NECK_FRETS, tuning, onNoteClick: (s, f) => strum([midiAt(s, f)]) });
    chordNeckWrap.append(chordNeck.el);

    const chordView = h(
      'div',
      { class: 'tab-view' },
      h(
        'section',
        { class: 'panel controls' },
        h('div', { class: 'chord-input-row' }, chordInput, surprise),
        h('div', { class: 'controls-row' }, bassCtl.el, openCtl.el, h('div', { class: 'spacer' }), labelsCtl.el),
      ),
      chordResults,
    );

    function renderChord() {
      const text = state.chord.trim();
      if (!text) return renderLibrary();
      const chord = parseChord(text);
      if (!chord) {
        chordResults.replaceChildren(
          h(
            'div',
            { class: 'panel empty-state' },
            h('p', {}, `Couldn’t read “${text}”. Try one of these:`),
            exampleChips(),
          ),
        );
        return;
      }
      // Hide the long tail of awkward voicings (they still exist for the progression planner).
      const found = candidatesFor(chord);
      const all = found.filter((v) => v.score <= found[0].score + 3.5);
      const sel = all.find((v) => v.key === selKey) || all[0];
      selKey = sel?.key ?? null;

      // Neck: selected voicing on top of every chord tone on the neck.
      const notes = new Map();
      const pcs = new Set(chord.tones.map((t) => t.pc));
      if (chord.bassPc != null) pcs.add(chord.bassPc);
      for (let s = 0; s < 6; s++)
        for (let f = 0; f <= NECK_FRETS; f++) {
          const pc = mod12(midiAt(s, f));
          if (pcs.has(pc)) notes.set(`${s}:${f}`, { label: label(chord, pc), classes: ['faint', toneKind(chord, pc)] });
        }
      if (sel) for (const n of sel.notes) notes.set(`${n.s}:${n.f}`, { label: label(chord, n.pc), classes: [toneKind(chord, n.pc)] });
      chordNeck.update({ notes });

      const groups = groupByBassString(all, 99);
      chordResults.replaceChildren(
        h(
          'section',
          { class: 'panel chord-summary' },
          h(
            'div',
            { class: 'chord-head' },
            h('h2', { class: 'chord-title' }, pretty(chord.symbol)),
            h(
              'div',
              { class: 'tone-chips' },
              chord.tones.map((t) =>
                h(
                  'span',
                  { class: `tone-chip ${toneKind(chord, t.pc)}${t.role === 'optional' ? ' optional' : ''}`, title: t.role === 'optional' ? 'Optional — often left out' : '' },
                  h('b', {}, pretty(t.name)),
                  h('small', {}, pretty(t.token === '1' ? 'R' : t.token)),
                ),
              ),
              chord.bass && h('span', { class: 'tone-chip bass' }, h('b', {}, pretty(chord.bass)), h('small', {}, 'bass')),
            ),
            sel &&
              h(
                'button',
                {
                  class: 'btn',
                  type: 'button',
                  title: 'Append this chord (with this voicing) as a new bar in your current song',
                  onclick: () => addToSong(chord, sel),
                },
                '+ Add to song',
              ),
          ),
          chordNeckWrap,
          legend.cloneNode(true),
        ),
        ...(all.length
          ? groups.map((g) => {
              const open = expanded.has(g.string);
              const shown = open ? g.list : g.list.slice(0, 6);
              return h(
                'section',
                { class: 'voicing-group' },
                h(
                  'div',
                  { class: 'group-head' },
                  h('h3', {}, bassStringLabel(g.list[0], chord)),
                  h('span', { class: 'muted' }, `${g.list.length} voicing${g.list.length === 1 ? '' : 's'}`),
                ),
                h(
                  'div',
                  { class: 'voicing-grid' },
                  shown.map((v) =>
                    voicingCard(v, chord, {
                      selected: v.key === selKey,
                      onClick: () => {
                        selKey = v.key;
                        play(v);
                        render();
                      },
                    }),
                  ),
                ),
                g.list.length > 6 &&
                  h(
                    'button',
                    {
                      class: 'link more',
                      type: 'button',
                      onclick: () => {
                        open ? expanded.delete(g.string) : expanded.add(g.string);
                        render();
                      },
                    },
                    open ? 'Show fewer' : `Show all ${g.list.length}`,
                  ),
              );
            })
          : [h('div', { class: 'panel empty-state' }, 'No playable voicing found within a 4-fret stretch. Try “Rootless & inversions”.')]),
      );
    }

    function renderLibrary() {
      const rootCtl = segmented({
        label: 'Root',
        compact: true,
        options: KEYS.map((k) => ({ value: k, label: pretty(k) })),
        value: state.root,
        onChange: (r) => set({ root: r }),
      });
      chordResults.replaceChildren(
        h(
          'section',
          { class: 'panel library-intro' },
          h('h2', {}, 'Shape library'),
          h(
            'p',
            { class: 'muted' },
            'Movable shapes with the root on the 6th and 5th strings. Click a name to explore every voicing of it, or a diagram to hear it. ',
            'Or type any chord above:',
          ),
          exampleChips(),
          rootCtl.el,
        ),
        ...CHORD_LIBRARY.map((group) =>
          h(
            'section',
            { class: 'voicing-group' },
            h('div', { class: 'group-head' }, h('h3', {}, group.group)),
            h(
              'div',
              { class: 'library-grid' },
              group.qualities.map((q) => {
                const sym = librarySymbol(state.root, q);
                const chord = parseChord(sym);
                const vs = voicingsFor(chord, { bass: 'root', allowOpen: false });
                const picks = [0, 1, 2]
                  .map((s) => vs.find((v) => v.bassString === s))
                  .filter(Boolean)
                  .slice(0, 2);
                return h(
                  'div',
                  { class: 'library-card' },
                  h(
                    'button',
                    {
                      class: 'library-name',
                      type: 'button',
                      onclick: () => {
                        chordInput.value = sym;
                        selKey = null;
                        set({ chord: sym });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      },
                    },
                    pretty(sym),
                  ),
                  h(
                    'div',
                    { class: 'library-pair' },
                    picks.map((v) =>
                      h(
                        'button',
                        { class: 'diagram-btn', type: 'button', title: `${bassStringLabel(v, chord)} — click to hear`, onclick: () => play(v) },
                        chordDiagram(v, chord, { labels: state.labels }),
                      ),
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
      );
    }

    function exampleChips() {
      return h(
        'div',
        { class: 'chips' },
        EXAMPLES.map((sym) =>
          h(
            'button',
            {
              class: 'chip',
              type: 'button',
              onclick: () => {
                chordInput.value = sym;
                selKey = null;
                set({ chord: sym });
              },
            },
            pretty(sym),
          ),
        ),
      );
    }

    function play(v) {
      strum(v.notes.map((n) => n.midi));
    }

    /** Append this chord (with this exact voicing) as a new bar at the end of your current song. */
    function addToSong(chord, v) {
      let song = loadLastSong() || createSong({ title: 'Chord sketch', sections: [{ name: 'A', bars: 1, chords: [] }] });
      song = structuredClone(song);
      const sec = song.sections[song.sections.length - 1];
      const bt = barTicks(sec.meter);
      const lastAt = sec.chords.reduce((m, c) => Math.max(m, c.at), -1);
      const nextBar = sec.chords.length ? Math.floor(lastAt / bt) + 1 : 0;
      sec.bars = Math.max(sec.bars, nextBar + 1);
      sec.chords.push({ at: nextBar * bt, sym: chord.symbol, gtr: v.key });
      try {
        localStorage.setItem(LAST_SONG_KEY, JSON.stringify(normalizeSong(song)));
        toast(`Added ${pretty(chord.symbol)} to “${song.title}”, section ${sec.name}, bar ${nextBar + 1}`);
      } catch {
        toast('Could not save to the song (storage blocked?)');
      }
    }

    // --- page ---------------------------------------------------------------
    const toastEl = h('div', { class: 'toast', role: 'status' });
    const view = h('div');
    root.append(view, toastEl);

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toast.t);
      toast.t = setTimeout(() => toastEl.classList.remove('show'), 1800);
    }

    function render() {
      labelsCtl.set(state.labels);
      bassCtl.set(state.bass);
      openCtl.set(state.open === '1');
      if (view.firstChild !== chordView) view.replaceChildren(chordView);
      renderChord();
    }

    function label(chord, pc) {
      if (state.labels === 'intervals') return pretty(toneLabel(chord, pc));
      if (state.labels === 'notes') return pretty(noteNameFor(chord, pc));
      return '';
    }

    function voicingCard(v, chord, { selected, onClick }) {
      return h(
        'button',
        { class: `voicing-card${selected ? ' selected' : ''}`, type: 'button', onclick: onClick, title: 'Click to hear & show on the neck' },
        chordDiagram(v, chord, { labels: state.labels }),
        h('span', { class: 'voicing-tags' }, v.tags.join(' · ')),
      );
    }

    save();
    render();

    return () => {};
  },
};

// --- helpers ---------------------------------------------------------------

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
