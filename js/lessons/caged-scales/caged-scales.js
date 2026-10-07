// CAGED Scale Explorer
// Visualise any scale across the neck, isolate a CAGED shape, compare against
// another scale to see what moves, and hear it all against a drone.

import { h, loadCss } from '../../ui/dom.js';
import { segmented, toggle, select } from '../../ui/controls.js';
import { createFretboard } from '../../ui/fretboard.js';
import {
  KEYS,
  SCALES,
  SCALE_GROUPS,
  MODE_LADDER,
  spellScale,
  pitchClass,
  parseDegree,
  pretty,
  mod12,
} from '../../lib/theory.js';
import {
  TUNINGS,
  CAGED_ORDER,
  CAGED_SHAPES,
  shapeInstances,
  allShapeInstances,
  inInstance,
  midiAt,
  shapeLabel,
} from '../../lib/guitar.js';
import { playMidi, playSequence, startDrone } from '../../lib/audio.js';

loadCss(new URL('./caged-scales.css', import.meta.url));

const STORAGE_KEY = 'mlt-caged-scales';
const DEFAULTS = {
  key: 'A',
  scale: 'major',
  compareTo: 'auto', // auto | prev | <scale id>
  shape: 'all', // all | C | A | G | E | D
  labels: 'names', // names | degrees | none
  roots: '1',
  chord: '0', // 0 | 3 (triad) | 7 (seventh chord)
  compare: '0',
  context: '1',
  frets: '15',
};

// How far each mode's root sits above its parent major scale's root.
const MODE_OFFSET = { lydian: 5, major: 0, mixolydian: 7, dorian: 2, minor: 9, phrygian: 4, locrian: 11 };
const MODE_NUMBER = { major: '1st', dorian: '2nd', phrygian: '3rd', lydian: '4th', mixolydian: '5th', minor: '6th', locrian: '7th' };

const tuning = TUNINGS.standard;

export default {
  mount(root, { params, setParams }) {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {}
    const hasUrlState = Object.keys(params).length > 0;
    const state = { ...DEFAULTS, ...migrate(hasUrlState ? params : saved) };
    if (!KEYS.includes(state.key)) state.key = DEFAULTS.key;
    if (!SCALES[state.scale]) state.scale = DEFAULTS.scale;

    let prevScale = SCALES[state.scale].compare;
    let stopPlayback = null;
    let drone = null;
    const on = (k) => state[k] === '1';
    const scale = () => SCALES[state.scale];

    function set(patch) {
      if (patch.scale && patch.scale !== state.scale) prevScale = state.scale;
      Object.assign(state, patch);
      setParams(state);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {}
      drone?.setRoot(droneMidi());
      render();
    }
    const flip = (k) => set({ [k]: on(k) ? '0' : '1' });

    // --- controls ----------------------------------------------------------
    const scaleOptions = SCALE_GROUPS.map((g) => ({
      group: g.label,
      options: g.ids.map((id) => ({ value: id, label: SCALES[id].name })),
    }));

    const keyCtl = segmented({
      label: 'Key',
      compact: true,
      options: KEYS.map((k) => ({ value: k, label: pretty(k) })),
      value: state.key,
      onChange: (key) => set({ key }),
    });
    const scaleCtl = select({
      label: 'Scale',
      options: scaleOptions,
      value: state.scale,
      onChange: (s) => set({ scale: s }),
    });
    const shapeCtl = segmented({
      label: 'CAGED shape',
      options: [
        { value: 'all', label: 'All', title: 'Shortcut: 0' },
        ...CAGED_ORDER.map((id, i) => ({ value: id, label: id, title: `Shortcut: ${i + 1}` })),
      ],
      value: state.shape,
      onChange: (shape) => set({ shape }),
    });
    const chordCtl = segmented({
      label: 'Chord tones',
      options: [
        { value: '0', label: 'Off' },
        { value: '3', label: 'Triad', title: '1-3-5 (C cycles)' },
        { value: '7', label: '7th', title: '1-3-5-7 (C cycles)' },
      ],
      value: state.chord,
      onChange: (chord) => set({ chord }),
    });
    const labelsCtl = select({
      label: 'Labels',
      options: [
        { value: 'names', label: 'Note names' },
        { value: 'degrees', label: 'Scale degrees' },
        { value: 'none', label: 'None' },
      ],
      value: state.labels,
      onChange: (labels) => set({ labels }),
    });
    const fretsCtl = select({
      label: 'Frets',
      options: ['12', '15', '17', '22'].map((v) => ({ value: v, label: v })),
      value: state.frets,
      onChange: (frets) => {
        state.frets = frets;
        buildBoard();
        set({ frets });
      },
    });
    const compareToCtl = select({
      label: 'Compare with',
      options: [
        { value: 'auto', label: 'Suggested' },
        { value: 'prev', label: 'Previous scale' },
        ...scaleOptions,
      ],
      value: state.compareTo,
      onChange: (compareTo) => set({ compareTo, compare: '1' }),
    });
    const rootsCtl = toggle({ label: 'Roots', hint: 'Shortcut: R', value: on('roots'), onChange: () => flip('roots') });
    const compareCtl = toggle({
      label: 'Show changes',
      hint: 'Ghost the comparison scale’s notes so you can see what moves (D)',
      value: on('compare'),
      onChange: () => flip('compare'),
    });
    const contextCtl = toggle({
      label: 'Faded neck',
      hint: 'When a shape is selected, show the rest of the scale faintly (F)',
      value: on('context'),
      onChange: () => flip('context'),
    });

    const playBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => togglePlay() }, '▶ Play');
    const droneBtn = h(
      'button',
      { class: 'btn', type: 'button', title: 'Root + fifth drone (Shortcut: N)', onclick: () => toggleDrone() },
      '◎ Drone',
    );

    // --- brightness ladder (the fun bit) ------------------------------------
    const ladder = h('div', { class: 'ladder', role: 'group', aria: { label: 'Mode brightness' } });
    const ladderHint = h('p', { class: 'ladder-hint' });
    const ladderScroll = h('div', { class: 'ladder-scroll' }, ladder);
    const ladderSteps = MODE_LADDER.map((id, i) =>
      h(
        'button',
        { class: 'ladder-step', type: 'button', style: { '--i': i }, onclick: () => set({ scale: id }) },
        h('span', { class: 'ladder-name' }, SCALES[id].name.replace('Natural minor', 'Aeolian').replace('Major', 'Ionian')),
      ),
    );
    MODE_LADDER.forEach((id, i) => {
      ladder.append(ladderSteps[i]);
      if (i < MODE_LADDER.length - 1) {
        const change = ladderChange(MODE_LADDER[i], MODE_LADDER[i + 1]);
        ladder.append(h('span', { class: 'ladder-link', title: `Lower the ${pretty(change.from)}` }, pretty(change.to)));
      }
    });

    // --- layout ------------------------------------------------------------
    const boardWrap = h('div', { class: 'board-scroll' });
    const legend = h('div', { class: 'legend' });
    const info = h('div', { class: 'caged-info' });
    const boardTitle = h('h2', { class: 'board-title' });
    const boardMood = h('p', { class: 'board-mood' });

    root.append(
      h(
        'section',
        { class: 'panel controls' },
        h('div', { class: 'controls-row' }, keyCtl.el),
        h('div', { class: 'controls-row' }, scaleCtl.el, shapeCtl.el, chordCtl.el),
        h(
          'div',
          { class: 'ladder-wrap' },
          h('span', { class: 'field-label' }, 'Brightness ladder · each step lowers one note'),
          ladderScroll,
          ladderHint,
        ),
        h(
          'div',
          { class: 'controls-row toggles' },
          rootsCtl.el,
          compareCtl.el,
          contextCtl.el,
          h('div', { class: 'spacer' }),
          compareToCtl.el,
          labelsCtl.el,
          fretsCtl.el,
        ),
      ),
      h(
        'section',
        { class: 'panel board-panel' },
        h(
          'div',
          { class: 'board-head' },
          h('div', {}, boardTitle, boardMood),
          h('div', { class: 'board-actions' }, droneBtn, playBtn),
        ),
        boardWrap,
        legend,
      ),
      info,
      h(
        'details',
        { class: 'shortcuts' },
        h('summary', {}, 'Keyboard shortcuts'),
        h(
          'dl',
          {},
          shortcut('M', 'Major ↔ minor'),
          shortcut(',  .', 'Darker / brighter mode'),
          shortcut('P', 'Pentatonic ↔ full scale'),
          shortcut('← →', 'Previous / next shape'),
          shortcut('0–5', 'All shapes / C A G E D'),
          shortcut('[  ]', 'Key down / up a semitone'),
          shortcut('R  C  D  F', 'Roots · Chord tones · Changes · Faded neck'),
          shortcut('L', 'Cycle labels'),
          shortcut('N', 'Drone on / off'),
          shortcut('Space', 'Play / stop'),
        ),
      ),
    );

    // On narrow screens the board scrolls sideways; bring the selected shape into view.
    let lastShape = null;
    function scrollToShape() {
      const band = boardWrap.querySelector('.fb-region.active .fb-region-band');
      if (!band || boardWrap.scrollWidth <= boardWrap.clientWidth) return;
      const b = band.getBoundingClientRect();
      const w = boardWrap.getBoundingClientRect();
      const left = boardWrap.scrollLeft + b.left - w.left - (w.width - b.width) / 2;
      boardWrap.scrollTo({ left, behavior: 'smooth' });
    }

    let board;
    function buildBoard() {
      board = createFretboard({
        frets: +state.frets,
        tuning,
        onNoteClick: (s, f) => {
          playMidi(midiAt(s, f, tuning));
          board.flash(s, f);
        },
      });
      boardWrap.replaceChildren(board.el);
    }
    buildBoard();

    // --- derived view ------------------------------------------------------
    function compareId() {
      if (state.compareTo === 'prev') return prevScale !== state.scale ? prevScale : scale().compare;
      if (state.compareTo === 'auto' || !SCALES[state.compareTo]) return scale().compare;
      return state.compareTo;
    }

    function compute() {
      const id = state.scale;
      const sc = SCALES[id];
      const parId = compareId();
      const parScale = SCALES[parId];
      const rootPc = pitchClass(state.key);
      const frets = +state.frets;
      const fam = sc.family;
      const instances =
        state.shape === 'all'
          ? allShapeInstances(rootPc, fam, frets, tuning)
          : shapeInstances(rootPc, fam, state.shape, frets, tuning);
      const parInstances =
        state.shape === 'all' ? null : shapeInstances(rootPc, parScale.family, state.shape, frets, tuning);
      return {
        id,
        scale: sc,
        parId,
        parScale,
        rootPc,
        notes: spellScale(state.key, id),
        parNotes: spellScale(state.key, parId),
        frets,
        fam,
        instances,
        parInstances,
      };
    }

    function render() {
      const v = compute();
      const { scale: sc, notes, parNotes, instances, parInstances, fam } = v;
      const all = state.shape === 'all';
      const chordIvs = state.chord === '7' ? sc.seventh : state.chord === '3' ? sc.triad : [];
      const chordSet = new Set(chordIvs.map((iv) => mod12(v.rootPc + iv)));
      const map = new Map();

      for (let s = 0; s < tuning.midi.length; s++) {
        for (let f = 0; f <= v.frets; f++) {
          const pc = mod12(midiAt(s, f, tuning));
          const note = notes.get(pc);
          const inShape = all || instances.some((inst) => inInstance(inst, s, f));

          if (note) {
            const classes = [];
            if (!inShape) {
              if (!on('context')) continue;
              classes.push('faint');
            }
            if (note.degree === '1' && on('roots')) classes.push('root');
            else if (chordSet.has(pc)) classes.push('chord');
            if (on('compare') && !parNotes.has(pc)) classes.push('changed');
            map.set(`${s}:${f}`, { label: labelFor(note), classes });
          } else if (on('compare') && parNotes.has(pc)) {
            const inParShape = all || parInstances.some((inst) => inInstance(inst, s, f));
            if (!inParShape) continue;
            map.set(`${s}:${f}`, { label: labelFor(parNotes.get(pc)), classes: ['ghost'] });
          }
        }
      }

      const regions = allShapeInstances(v.rootPc, fam, v.frets, tuning).map((inst) => ({
        min: inst.min,
        max: inst.max,
        label: shapeLabel(inst.id, fam),
        active: !all && inst.id === state.shape,
        className: all ? 'soft' : inst.id === state.shape ? '' : 'hidden-band',
        onClick: () => set({ shape: state.shape === inst.id ? 'all' : inst.id }),
      }));

      board.update({ notes: map, regions });
      if (state.shape !== lastShape) {
        lastShape = state.shape;
        scrollToShape();
      }

      // Sync controls (state may have changed via keyboard or URL).
      keyCtl.set(state.key);
      scaleCtl.set(state.scale);
      shapeCtl.set(state.shape);
      shapeCtl.setLabels((val) => (val === 'all' ? 'All' : shapeLabel(val, fam)));
      chordCtl.set(state.chord);
      labelsCtl.set(state.labels);
      fretsCtl.set(state.frets);
      compareToCtl.set(state.compareTo);
      rootsCtl.set(on('roots'));
      compareCtl.set(on('compare'));
      contextCtl.set(on('context'));

      // Ladder
      const li = MODE_LADDER.indexOf(state.scale);
      ladderSteps.forEach((b, i) => {
        b.classList.toggle('active', i === li);
        b.setAttribute('aria-pressed', i === li);
      });
      if (li !== -1 && ladderScroll.scrollWidth > ladderScroll.clientWidth) {
        const step = ladderSteps[li];
        const left = step.offsetLeft - (ladderScroll.clientWidth - step.offsetWidth) / 2;
        ladderScroll.scrollTo({ left, behavior: 'smooth' });
      }
      ladderHint.textContent =
        li === -1
          ? `${sc.name} isn’t a mode of the major scale. Pick a step to jump onto the ladder.`
          : [
              li > 0 &&
                `Brighter: raise the ${pretty(ladderChange(MODE_LADDER[li - 1], state.scale).to)} → ${SCALES[MODE_LADDER[li - 1]].name}.`,
              li < 6 &&
                `Darker: lower the ${pretty(ladderChange(state.scale, MODE_LADDER[li + 1]).from)} → ${SCALES[MODE_LADDER[li + 1]].name}.`,
            ]
              .filter(Boolean)
              .join('   ');

      boardTitle.textContent =
        `${pretty(state.key)} ${sc.name.toLowerCase()}` + (all ? ' · whole neck' : ` · ${shapeLabel(state.shape, fam)} shape`);
      boardMood.textContent = sc.mood;
      playBtn.textContent = stopPlayback ? '■ Stop' : all ? '▶ Play scale' : '▶ Play shape';
      droneBtn.classList.toggle('active', !!drone);
      droneBtn.setAttribute('aria-pressed', !!drone);

      renderLegend(v);
      renderInfo(v);
    }

    function labelFor(note) {
      if (state.labels === 'names') return pretty(note.name);
      if (state.labels === 'degrees') return pretty(note.degree);
      return '';
    }

    function renderLegend(v) {
      const items = [
        on('roots') && ['root', 'Root'],
        state.chord !== '0' && ['chord', state.chord === '7' ? 'Chord tone (3, 5, 7)' : 'Chord tone (3, 5)'],
        ['', 'Scale note'],
        on('compare') && ['changed', `Not in ${v.parScale.name.toLowerCase()}`],
        on('compare') && ['ghost', `${v.parScale.name} note (moved / missing)`],
        state.shape !== 'all' && on('context') && ['faint', 'Outside this shape'],
      ].filter(Boolean);
      legend.replaceChildren(
        ...items.map(([cls, text]) =>
          h('span', { class: 'legend-item' }, h('span', { class: `legend-dot ${cls}` }), text),
        ),
      );
    }

    function renderInfo(v) {
      const { scale: sc, parScale, notes, parNotes } = v;
      const ordered = [...notes.values()].sort((a, b) => a.interval - b.interval);

      const noteChips = h(
        'div',
        { class: 'scale-notes' },
        ordered.map((n) =>
          h(
            'div',
            {
              class: [
                'scale-note',
                n.degree === '1' && 'root',
                on('compare') && !parNotes.has(n.pc) && 'changed',
                sc.signature.includes(n.degree) && 'signature',
              ]
                .filter(Boolean)
                .join(' '),
              title: sc.signature.includes(n.degree) ? 'Signature note' : null,
            },
            h('span', { class: 'sn-name' }, pretty(n.name)),
            h('span', { class: 'sn-degree' }, pretty(n.degree)),
          ),
        ),
      );

      const shapeNote =
        state.shape === 'all' ? 'Click a shape label above the neck (or press 1–5) to isolate it.' : shapeHint(v);

      info.replaceChildren(
        h(
          'div',
          { class: 'panel info-card' },
          h('h3', {}, `Notes in ${pretty(state.key)} ${sc.name.toLowerCase()}`),
          noteChips,
          sc.signature.length
            ? h(
                'p',
                { class: 'muted' },
                'Signature sound: ',
                h('strong', { class: 'sig' }, sc.signature.map(pretty).join(', ')),
                '. Turn on the drone and lean on ',
                sc.signature.length > 1 ? 'these.' : 'it.',
              )
            : null,
        ),
        h(
          'div',
          { class: 'panel info-card' },
          h('h3', {}, `${sc.name} vs ${parScale.name.toLowerCase()}`),
          diffScales(notes, parNotes),
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: () =>
                set({ scale: v.parId, compare: '1', compareTo: state.compareTo === 'auto' ? 'prev' : state.compareTo }),
            },
            `Switch to ${pretty(state.key)} ${parScale.name.toLowerCase()} ⇄`,
          ),
        ),
        h('div', { class: 'panel info-card' }, h('h3', {}, 'Context'), relativeLine(v), h('p', { class: 'muted' }, shapeNote)),
      );
    }

    function relativeLine(v) {
      const link = (key, scaleId, text) =>
        h('button', { class: 'link', type: 'button', onclick: () => set({ key, scale: scaleId }) }, text);
      if (state.scale === 'major') {
        const rel = KEYS[mod12(v.rootPc + 9)];
        return h('p', {}, 'Relative minor: ', link(rel, 'minor', `${pretty(rel)} minor`), ' (same notes).');
      }
      if (state.scale in MODE_OFFSET) {
        const parentKey = KEYS[mod12(v.rootPc - MODE_OFFSET[state.scale])];
        return h(
          'p',
          {},
          'Same notes as ',
          link(parentKey, 'major', `${pretty(parentKey)} major`),
          ` — it’s the ${MODE_NUMBER[state.scale]} mode.`,
        );
      }
      if (state.scale === 'majorPentatonic' || state.scale === 'minorPentatonic') {
        const major = state.scale === 'majorPentatonic';
        const relKey = KEYS[mod12(v.rootPc + (major ? 9 : 3))];
        const relId = major ? 'minorPentatonic' : 'majorPentatonic';
        return h(
          'p',
          {},
          'Same notes as ',
          link(relKey, relId, `${pretty(relKey)} ${SCALES[relId].name.toLowerCase()}`),
          '.',
        );
      }
      return h('p', {}, `${v.scale.name} isn’t a mode of the major scale, so it has its own set of notes.`);
    }

    function shapeHint(v) {
      const roots = v.instances.map((i) => i.root).filter((r) => r >= 0 && r <= v.frets);
      if (!roots.length) return 'This shape only partly fits on the visible neck in this key — try more frets.';
      const strings = ['6th (low E)', '5th (A)', '4th (D)', '3rd (G)', '2nd (B)', '1st (high e)'];
      const anchor = CAGED_SHAPES[v.fam][state.shape].anchor;
      return `${shapeLabel(state.shape, v.fam)} shape: anchored on the root on the ${strings[anchor]} string at fret ${roots.join(' and ')}.`;
    }

    // --- audio -------------------------------------------------------------
    function droneMidi() {
      return 40 + mod12(pitchClass(state.key) - 4); // keep it low: E2..D#3
    }
    function toggleDrone() {
      if (drone) {
        drone.stop();
        drone = null;
      } else {
        drone = startDrone(droneMidi());
      }
      render();
    }

    function togglePlay() {
      if (stopPlayback) {
        stopPlayback();
        return;
      }
      const v = compute();
      // Prefer a complete placement (root on the neck) over one clipped at the nut or last fret.
      const inst = [...v.instances].sort((a, b) => completeness(b, v.frets) - completeness(a, v.frets))[0];
      if (!inst) return;
      const cells = [];
      const seen = new Set();
      for (let s = 0; s < tuning.midi.length; s++) {
        const [lo, hi] = inst.windows[s];
        for (let f = Math.max(0, lo); f <= Math.min(v.frets, hi); f++) {
          const midi = midiAt(s, f, tuning);
          if (v.notes.has(mod12(midi)) && !seen.has(midi)) {
            seen.add(midi);
            cells.push({ s, f, midi });
          }
        }
      }
      cells.sort((a, b) => a.midi - b.midi);
      const seq = [...cells, ...cells.slice(0, -1).reverse()];
      stopPlayback = playSequence(
        seq.map((c) => c.midi),
        {
          bpm: 200,
          onStep: (i) => board.flash(seq[i].s, seq[i].f, 'playing', 260),
          onDone: () => {
            if (!stopPlayback) return;
            stopPlayback = null;
            render();
          },
        },
      );
      render();
    }

    // --- keyboard ----------------------------------------------------------
    function onKey(e) {
      if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      const shapes = ['all', ...CAGED_ORDER];
      const k = e.key.toLowerCase();
      const idx = shapes.indexOf(state.shape);
      const li = MODE_LADDER.indexOf(state.scale);
      if (k === 'm') set({ scale: scale().family === 'major' ? 'minor' : 'major' });
      else if (k === ',') set({ scale: li === -1 ? 'major' : MODE_LADDER[Math.min(6, li + 1)] });
      else if (k === '.') set({ scale: li === -1 ? 'major' : MODE_LADDER[Math.max(0, li - 1)] });
      else if (k === 'p') {
        const pent = state.scale.endsWith('Pentatonic');
        set({ scale: pent ? scale().family : `${scale().family}Pentatonic` });
      } else if (k === 'r') flip('roots');
      else if (k === 'c') set({ chord: { 0: '3', 3: '7', 7: '0' }[state.chord] });
      else if (k === 'd') flip('compare');
      else if (k === 'f') flip('context');
      else if (k === 'n') toggleDrone();
      else if (k === 'l') {
        const order = ['names', 'degrees', 'none'];
        set({ labels: order[(order.indexOf(state.labels) + 1) % 3] });
      } else if (k === 'arrowright') set({ shape: shapes[(idx + 1) % shapes.length] });
      else if (k === 'arrowleft') set({ shape: shapes[(idx - 1 + shapes.length) % shapes.length] });
      else if (/^[0-5]$/.test(k)) set({ shape: shapes[+k] });
      else if (k === ']' || k === '[') {
        const i = KEYS.indexOf(state.key);
        set({ key: KEYS[(i + (k === ']' ? 1 : -1) + 12) % 12] });
      } else if (k === ' ') togglePlay();
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);

    setParams(state);
    render();

    return () => {
      window.removeEventListener('keydown', onKey);
      stopPlayback?.();
      drone?.stop();
    };
  },
};

// --- helpers ---------------------------------------------------------------

// Older links used ?mode=major&penta=1; map them onto ?scale=…
function migrate(p) {
  const out = { ...p };
  if (p.mode && !p.scale) out.scale = p.penta === '1' ? `${p.mode}Pentatonic` : p.mode;
  if (out.chord === '1') out.chord = '3';
  delete out.mode;
  delete out.penta;
  return out;
}

// Which note changes between two neighbouring modes on the ladder.
function ladderChange(brighter, darker) {
  const a = SCALES[brighter].degrees;
  const b = SCALES[darker].degrees;
  const i = a.findIndex((d, k) => d !== b[k]);
  return { from: a[i], to: b[i] };
}

// How much of a shape placement is actually on the neck (higher = more complete).
function completeness(inst, frets) {
  const rootOnNeck = inst.root >= 0 && inst.root <= frets ? 100 : 0;
  return rootOnNeck + (inst.max - inst.min);
}

function shortcut(keys, what) {
  return [h('dt', {}, keys.split(/\s{2,}/).map((k) => h('kbd', {}, k))), h('dd', {}, what)];
}

// Pair up notes by scale-degree number (9 ≡ 2, 11 ≡ 4, 13 ≡ 6) to describe what moved.
function diffScales(notes, parNotes) {
  const num = (d) => ((parseDegree(d).num - 1) % 7) + 1;
  const group = (map) => {
    const g = new Map();
    for (const n of map.values()) g.set(num(n.degree), [...(g.get(num(n.degree)) || []), n]);
    return g;
  };
  const cur = group(notes);
  const par = group(parNotes);
  const rows = [];
  for (const k of [1, 2, 3, 4, 5, 6, 7]) {
    const a = (par.get(k) || []).filter((n) => !notes.has(n.pc));
    const b = (cur.get(k) || []).filter((n) => !parNotes.has(n.pc));
    if (a.length === 1 && b.length === 1) rows.push(diffRow(a[0], b[0]));
    else {
      a.forEach((n) => rows.push(diffRow(n, null)));
      b.forEach((n) => rows.push(diffRow(null, n)));
    }
  }
  if (!rows.length) return h('p', { class: 'muted' }, 'Same notes — try another comparison.');
  return h('ul', { class: 'diff-list' }, rows);
}

function diffRow(a, b) {
  const cell = (n, cls) =>
    n ? h('span', { class: cls }, `${pretty(n.degree)} ${pretty(n.name)}`) : h('span', { class: `${cls} muted` }, '—');
  return h('li', {}, cell(a, 'from'), h('span', { class: 'arrow' }, '→'), cell(b, 'to'));
}
