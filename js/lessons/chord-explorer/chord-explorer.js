// Chord Explorer
// • Chord finder: type any chord symbol → every sensible voicing, grouped by bass string.
//   Empty input shows a library of movable jazz shapes.
// • Progression builder: type a progression → voicings chosen to stay close together,
//   with per-chord alternatives you can step through and lock.

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
  parseProgression,
  planProgression,
  toneLabel,
  toneKind,
  noteNameFor,
  PROGRESSIONS,
  realize,
  CHORD_LIBRARY,
  librarySymbol,
  randomChord,
  randomProgression,
} from '../../lib/chords.js';
import { strum } from '../../lib/audio.js';

loadCss(new URL('./chord-explorer.css', import.meta.url));

const STORAGE_KEY = 'mlt-chord-explorer';
const DEFAULTS = {
  tab: 'chord', // chord | prog
  chord: '',
  prog: 'Dm9 G13 Cmaj9 A7#9',
  locks: '', // "index~voicingKey,…"
  labels: 'intervals', // intervals | notes | none
  bass: 'root', // root | any
  open: '1',
  region: 'auto', // auto | low | mid | high
  root: 'C', // shape library root
  bpm: '96',
  loop: '1',
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
    let locks = parseLocks(state.locks);
    let selKey = null; // selected voicing in the chord finder
    let focus = 0; // focused chord in the progression
    let progName = '';
    const expanded = new Set();
    let stopPlay = null;

    const opts = () => ({ bass: state.bass, allowOpen: state.open === '1' });
    function candidatesFor(chord) {
      let v = voicingsFor(chord, opts());
      if (!v.length && state.bass === 'root') v = voicingsFor(chord, { ...opts(), bass: 'any' });
      if (!v.length) v = voicingsFor(chord, { ...opts(), bass: 'any', maxSpan: 4 });
      return v;
    }

    function save() {
      state.locks = serializeLocks(locks);
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
    const tabCtl = segmented({
      label: '',
      options: [
        { value: 'chord', label: 'Chord finder' },
        { value: 'prog', label: 'Progression builder' },
      ],
      value: state.tab,
      onChange: (tab) => {
        stopPlay?.();
        set({ tab });
      },
    });
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
                  title: 'Append this chord (with this voicing) to the progression builder',
                  onclick: () => addToProgression(chord, sel),
                },
                '+ Add to progression',
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
                set({ tab: 'chord', chord: sym });
              },
            },
            pretty(sym),
          ),
        ),
      );
    }

    function addToProgression(chord, v) {
      const items = parseProgression(state.prog);
      locks.set(items.length, v.key);
      state.prog = `${state.prog.trim()} ${chord.symbol}`.trim();
      focus = items.length;
      progInput.value = state.prog;
      toast(`Added ${pretty(chord.symbol)} to the progression`);
      save();
    }

    // --- progression builder -------------------------------------------------
    const progInput = h('input', {
      class: 'chord-input',
      type: 'text',
      value: state.prog,
      placeholder: 'Dm9 G13 Cmaj9 A7#9',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      aria: { label: 'Chord progression' },
      oninput: debounce((e) => {
        progName = '';
        set({ prog: e.target.value });
      }, 250),
    });
    const templateKey = select({
      label: 'Key',
      options: KEYS.map((k) => ({ value: k, label: pretty(k) })),
      value: 'C',
      onChange: () => {},
    });
    const templateSel = h(
      'select',
      {
        class: 'select',
        aria: { label: 'Load a progression' },
        onchange: (e) => {
          const t = PROGRESSIONS[+e.target.value];
          if (!t) return;
          const key = templateKey.el.querySelector('select').value;
          loadProgression(realize(t, key).join(' '), `${t.name} in ${pretty(key)}`);
          e.target.value = '';
        },
      },
      h('option', { value: '' }, 'Load a progression…'),
      PROGRESSIONS.map((t, i) => h('option', { value: i }, t.name)),
    );
    const randomBtn = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => {
          const r = randomProgression();
          loadProgression(r.chords.join(' '), `${r.name} in ${pretty(r.key)}`);
        },
      },
      '🎲 Random',
    );
    function loadProgression(text, name) {
      stopPlay?.();
      progInput.value = text;
      locks = new Map();
      focus = 0;
      progName = name;
      set({ prog: text });
    }

    const regionCtl = segmented({
      label: 'Neck region',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'low', label: 'Low' },
        { value: 'mid', label: 'Mid' },
        { value: 'high', label: 'High' },
      ],
      value: state.region,
      onChange: (region) => set({ region }),
    });
    const bpmCtl = select({
      label: 'Tempo',
      options: ['60', '72', '84', '96', '108', '120', '140'].map((b) => ({ value: b, label: `${b} bpm` })),
      value: state.bpm,
      onChange: (bpm) => set({ bpm }),
    });
    const loopCtl = toggle({ label: 'Loop', value: state.loop === '1', onChange: (v) => set({ loop: v ? '1' : '0' }) });
    const playBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => togglePlay() }, '▶ Play');

    const progCards = h('div', { class: 'prog-row' });
    const progInfo = h('div', { class: 'prog-info' });
    const progNeckWrap = h('div', { class: 'board-scroll' });
    const progNeck = createFretboard({ frets: NECK_FRETS, tuning, onNoteClick: (s, f) => strum([midiAt(s, f)]) });
    progNeckWrap.append(progNeck.el);
    const progNeckTitle = h('h3', { class: 'neck-title' });
    const progNameEl = h('p', { class: 'prog-name muted' });

    const progView = h(
      'div',
      { class: 'tab-view' },
      h(
        'section',
        { class: 'panel controls' },
        h('div', { class: 'chord-input-row' }, progInput, randomBtn),
        h('div', { class: 'controls-row' }, templateSel, templateKey.el, h('div', { class: 'spacer' }), regionCtl.el),
        h('div', { class: 'controls-row' }, bassCtl.el, openCtl.el, h('div', { class: 'spacer' }), labelsCtl.el),
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'transport' }, h('div', {}, progNameEl), h('div', { class: 'transport-ctl' }, loopCtl.el, bpmCtl.el, playBtn)),
        progCards,
        progInfo,
      ),
      h(
        'section',
        { class: 'panel' },
        progNeckTitle,
        progNeckWrap,
        h(
          'div',
          { class: 'legend' },
          [
            ['root', 'Root'],
            ['guide', 'Guide tones'],
            ['color', 'Extensions'],
            ['common', 'Stays for the next chord'],
            ['ghost', 'Next chord'],
          ].map(([c, t]) => h('span', { class: 'legend-item' }, h('span', { class: `legend-dot ${c}` }), t)),
        ),
      ),
    );

    let plan = null;
    function computePlan() {
      const items = parseProgression(state.prog).map((it, i) => ({ ...it, i }));
      const playable = [];
      const cands = [];
      for (const it of items) {
        if (!it.chord) continue;
        const full = candidatesFor(it.chord);
        if (!full.length) continue;
        const list = full.slice(0, 40);
        const lk = locks.get(it.i);
        if (lk && !list.some((v) => v.key === lk)) {
          const found = full.find((v) => v.key === lk);
          if (found) list.unshift(found);
        }
        playable.push(it);
        cands.push(list);
      }
      const lockMap = new Map();
      playable.forEach((it, k) => {
        const lk = locks.get(it.i);
        if (lk && cands[k].some((v) => v.key === lk)) lockMap.set(k, lk);
      });
      const { path, ranked } = planProgression(cands, { locks: lockMap, region: state.region });
      playable.forEach((it, k) => Object.assign(it, { voicing: path[k], ranked: ranked[k], locked: lockMap.has(k) }));
      return { items, playable };
    }

    function renderProg() {
      plan = computePlan();
      const { items, playable } = plan;
      if (!playable.some((p) => p.i === focus)) focus = playable[0]?.i ?? 0;
      progNameEl.textContent = progName || `${playable.length} chord${playable.length === 1 ? '' : 's'}`;
      playBtn.textContent = stopPlay ? '■ Stop' : '▶ Play';
      playBtn.disabled = !playable.length;

      progCards.replaceChildren(
        ...items.map((it) => {
          const p = playable.find((x) => x.i === it.i);
          if (!p) {
            return h(
              'div',
              { class: 'prog-card invalid' },
              h('div', { class: 'prog-symbol' }, it.text),
              h('p', { class: 'muted' }, it.chord ? 'No playable voicing' : 'Can’t read this chord'),
            );
          }
          const v = p.voicing;
          const rank = p.ranked.findIndex((x) => x.key === v.key);
          return h(
            'div',
            { class: `prog-card${it.i === focus ? ' focused' : ''}${p.locked ? ' locked' : ''}` },
            h(
              'div',
              { class: 'prog-card-head' },
              h('span', { class: 'prog-symbol' }, pretty(p.chord.symbol)),
              p.locked &&
                h(
                  'button',
                  {
                    class: 'lock',
                    type: 'button',
                    title: 'You picked this voicing — click to let the planner choose again',
                    onclick: () => {
                      locks.delete(it.i);
                      save();
                      render();
                    },
                  },
                  '🔒',
                ),
            ),
            h(
              'button',
              {
                class: 'diagram-btn',
                type: 'button',
                title: 'Play',
                onclick: () => {
                  focus = it.i;
                  play(v);
                  render();
                },
              },
              chordDiagram(v, p.chord, { labels: state.labels }),
            ),
            h(
              'div',
              { class: 'prog-card-foot' },
              h('button', { class: 'step', type: 'button', title: 'Previous option (↓)', onclick: () => cycle(p, -1) }, '‹'),
              h('span', { class: 'rank' }, `${rank + 1} / ${p.ranked.length}`),
              h('button', { class: 'step', type: 'button', title: 'Next option (↑)', onclick: () => cycle(p, 1) }, '›'),
            ),
            h('div', { class: 'prog-tags' }, v.tags.slice(0, 2).join(' · ')),
          );
        }),
      );

      // Summary: hand movement + top voice line
      const vs = playable.map((p) => p.voicing);
      const moves = vs.slice(1).map((v, i) => Math.abs(v.center - vs[i].center));
      const avg = moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : 0;
      progInfo.replaceChildren(
        vs.length
          ? h(
              'div',
              { class: 'top-line' },
              h('span', { class: 'field-label' }, 'Top voice'),
              ...playable.flatMap((p, k) => [
                k ? h('span', { class: 'arrow' }, '→') : null,
                h('span', { class: 'top-note' }, pretty(noteNameFor(p.chord, mod12(p.voicing.top)))),
              ]),
            )
          : null,
        vs.length > 1 ? h('p', { class: 'muted' }, `Average hand move: ${avg.toFixed(1)} frets between chords.`) : null,
      );

      // Neck: focused chord + ghost of the next one.
      const k = playable.findIndex((p) => p.i === focus);
      const cur = playable[k];
      const next = playable.length > 1 ? playable[(k + 1) % playable.length] : null;
      const notes = new Map();
      if (cur) {
        if (next) {
          for (const n of next.voicing.notes)
            notes.set(`${n.s}:${n.f}`, { label: label(next.chord, n.pc), classes: ['ghost'] });
        }
        for (const n of cur.voicing.notes) {
          const stays = next && next.voicing.frets[n.s] === n.f;
          notes.set(`${n.s}:${n.f}`, {
            label: label(cur.chord, n.pc),
            classes: [toneKind(cur.chord, n.pc), stays && 'common'].filter(Boolean),
          });
        }
        const common = next ? cur.voicing.notes.filter((n) => next.voicing.frets[n.s] === n.f).length : 0;
        progNeckTitle.textContent = next
          ? `${pretty(cur.chord.symbol)} → ${pretty(next.chord.symbol)}` +
            (common ? ` · ${common} finger${common > 1 ? 's' : ''} stay put` : '')
          : pretty(cur.chord.symbol);
      } else progNeckTitle.textContent = 'Type some chords above';
      progNeck.update({ notes });
    }

    function cycle(p, dir) {
      const idx = p.ranked.findIndex((x) => x.key === p.voicing.key);
      const nextV = p.ranked[(idx + dir + p.ranked.length) % p.ranked.length];
      locks.set(p.i, nextV.key);
      focus = p.i;
      save();
      render();
      play(nextV);
    }

    // --- audio --------------------------------------------------------------
    function play(v) {
      strum(v.notes.map((n) => n.midi));
    }

    function togglePlay() {
      if (stopPlay) return stopPlay();
      const seq = plan?.playable ?? [];
      if (!seq.length) return;
      let k = Math.max(0, seq.findIndex((p) => p.i === focus));
      const timers = [];
      const beat = 60000 / +state.bpm;
      const step = () => {
        if (k >= seq.length) {
          if (state.loop !== '1') return stopPlay?.();
          k = 0;
        }
        const p = seq[k];
        focus = p.i;
        const midis = p.voicing.notes.map((n) => n.midi);
        strum(midis);
        // A lighter comp on beat 3 keeps it feeling like music, not a metronome.
        timers.push(setTimeout(() => strum(midis, { gain: 0.3, spread: 0.02 }), beat * 2.5));
        k++;
        renderProg();
        timers.push(setTimeout(step, beat * 4));
      };
      stopPlay = () => {
        timers.forEach(clearTimeout);
        stopPlay = null;
        renderProg();
      };
      step();
    }

    function onKey(e) {
      if (state.tab !== 'prog' || e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      const ps = plan?.playable ?? [];
      const k = ps.findIndex((p) => p.i === focus);
      if (e.key === ' ') togglePlay();
      else if (e.key === 'ArrowRight' && ps.length) (focus = ps[(k + 1) % ps.length].i), renderProg(), play(ps[(k + 1) % ps.length].voicing);
      else if (e.key === 'ArrowLeft' && ps.length) (focus = ps[(k - 1 + ps.length) % ps.length].i), renderProg(), play(ps[(k - 1 + ps.length) % ps.length].voicing);
      else if (e.key === 'ArrowUp' && ps[k]) cycle(ps[k], 1);
      else if (e.key === 'ArrowDown' && ps[k]) cycle(ps[k], -1);
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);

    // --- page ---------------------------------------------------------------
    const toastEl = h('div', { class: 'toast', role: 'status' });
    const view = h('div');
    root.append(h('div', { class: 'tabs-bar' }, tabCtl.el), view, toastEl);

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toast.t);
      toast.t = setTimeout(() => toastEl.classList.remove('show'), 1800);
    }

    function render() {
      tabCtl.set(state.tab);
      labelsCtl.set(state.labels);
      bassCtl.set(state.bass);
      openCtl.set(state.open === '1');
      regionCtl.set(state.region);
      bpmCtl.set(state.bpm);
      loopCtl.set(state.loop === '1');
      // Controls are shared between tabs; move them into the active view.
      if (state.tab === 'chord') {
        chordView.querySelector('.controls .controls-row').prepend(bassCtl.el, openCtl.el);
        chordView.querySelector('.controls .controls-row').append(labelsCtl.el);
        if (view.firstChild !== chordView) view.replaceChildren(chordView);
        renderChord();
      } else {
        const rows = progView.querySelectorAll('.controls .controls-row');
        rows[1].prepend(bassCtl.el, openCtl.el);
        rows[1].append(labelsCtl.el);
        if (view.firstChild !== progView) view.replaceChildren(progView);
        renderProg();
      }
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

    return () => {
      window.removeEventListener('keydown', onKey);
      stopPlay?.();
    };
  },
};

// --- helpers ---------------------------------------------------------------

function parseLocks(str) {
  const m = new Map();
  for (const part of String(str || '').split(',')) {
    const [i, key] = part.split('~');
    if (key) m.set(+i, key);
  }
  return m;
}
function serializeLocks(m) {
  return [...m].map(([i, k]) => `${i}~${k}`).join(',');
}
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
