// Copy this folder to start a new lesson, then register it in js/lessons.js:
//
//   {
//     id: 'my-lesson',
//     title: 'My Lesson',
//     summary: 'One line for the home page card.',
//     type: 'tool',            // tool | lesson | game | reference
//     tags: ['guitar', 'scales'],
//     load: () => import('./lessons/my-lesson/my-lesson.js'),
//   },

import { h } from '../../ui/dom.js';
import { segmented, toggle } from '../../ui/controls.js';
import { createFretboard } from '../../ui/fretboard.js';
import { playMidi } from '../../lib/audio.js';
import { midiAt } from '../../lib/guitar.js';
// import { loadCss } from '../../ui/dom.js';
// loadCss(new URL('./my-lesson.css', import.meta.url));

const DEFAULTS = { mode: 'a', dots: '1' };

export default {
  /**
   * @param {HTMLElement} root   where to render
   * @param {{ params: object, setParams: (obj) => void }} ctx
   *        params    – current URL query (strings); use it as initial state
   *        setParams – write state back into the URL (shareable, no history spam)
   * @returns {() => void} optional cleanup (remove listeners, stop audio…)
   */
  mount(root, { params, setParams }) {
    const state = { ...DEFAULTS, ...params };

    const board = createFretboard({
      frets: 12,
      onNoteClick: (s, f) => {
        playMidi(midiAt(s, f));
        board.flash(s, f);
      },
    });

    const modeCtl = segmented({
      label: 'Mode',
      options: [
        { value: 'a', label: 'Option A' },
        { value: 'b', label: 'Option B' },
      ],
      value: state.mode,
      onChange: (mode) => update({ mode }),
    });
    const dotsCtl = toggle({ label: 'Show dots', value: state.dots === '1', onChange: (v) => update({ dots: v ? '1' : '0' }) });

    function update(patch) {
      Object.assign(state, patch);
      setParams(state);
      render();
    }

    function render() {
      modeCtl.set(state.mode);
      const notes = new Map();
      if (state.dots === '1') notes.set('0:3', { label: 'G', classes: ['root'] });
      board.update({ notes });
    }

    root.append(
      h('section', { class: 'panel' }, modeCtl.el, dotsCtl.el),
      h('section', { class: 'panel' }, h('div', { class: 'board-scroll' }, board.el)),
    );
    render();

    return () => {};
  },
};
