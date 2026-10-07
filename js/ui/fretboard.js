// Reusable SVG fretboard. Builds every (string, fret) node once, then
// `update()` just toggles classes/labels — so CSS can animate changes.
//
//   const fb = createFretboard({ frets: 15, onNoteClick: (s, f) => … });
//   container.append(fb.el);
//   fb.update({
//     notes: new Map([['0:3', { label: 'G', classes: ['root'] }]]),
//     regions: [{ min: 0, max: 3, label: 'C', active: true, onClick }],
//   });

import { svg } from './dom.js';
import { TUNINGS } from '../lib/guitar.js';

const L = {
  padL: 10,
  openW: 46,
  fretW: 62,
  topH: 40,
  stringGap: 36,
  neckPad: 16,
  bottomH: 30,
  noteR: 14,
};

const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

export function createFretboard({ frets = 15, tuning = TUNINGS.standard, onNoteClick } = {}) {
  const strings = tuning.midi.length;
  const nutX = L.padL + L.openW;
  const boardTop = L.topH + L.neckPad;
  const boardH = (strings - 1) * L.stringGap;
  const width = nutX + frets * L.fretW + L.padL;
  const height = boardTop + boardH + L.neckPad + L.bottomH;

  const xFret = (f) => (f === 0 ? L.padL + L.openW / 2 : nutX + (f - 0.5) * L.fretW);
  const yString = (s) => boardTop + (strings - 1 - s) * L.stringGap; // high e on top
  const cellLeft = (f) => (f === 0 ? L.padL : nutX + (f - 1) * L.fretW);
  const cellRight = (f) => (f === 0 ? nutX : nutX + f * L.fretW);

  const root = svg('svg', {
    class: 'fretboard',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Guitar fretboard',
  });
  // Keep notes legible on phones: below this width the board scrolls sideways.
  root.style.minWidth = `${frets * 44 + 60}px`;

  // --- static board -------------------------------------------------------
  const neckTop = boardTop - L.neckPad;
  const neckBottom = boardTop + boardH + L.neckPad;
  const board = svg('g', { class: 'fb-board' });
  board.append(
    svg('rect', { class: 'fb-neck', x: nutX, y: neckTop, width: frets * L.fretW, height: neckBottom - neckTop, rx: 6 }),
  );

  const midY = boardTop + boardH / 2;
  for (let f = 1; f <= frets; f++) {
    const cx = nutX + (f - 0.5) * L.fretW;
    if (INLAYS.includes(f)) board.append(svg('circle', { class: 'fb-inlay', cx, cy: midY, r: 6 }));
    if (f === 12 || f === 24) {
      board.append(svg('circle', { class: 'fb-inlay', cx, cy: yString(1) + L.stringGap / 2, r: 6 }));
      board.append(svg('circle', { class: 'fb-inlay', cx, cy: yString(4) - L.stringGap / 2, r: 6 }));
    }
  }
  for (let f = 1; f <= frets; f++) {
    const x = nutX + f * L.fretW;
    board.append(svg('line', { class: 'fb-fret', x1: x, x2: x, y1: neckTop + 4, y2: neckBottom - 4 }));
  }
  board.append(svg('rect', { class: 'fb-nut', x: nutX - 4, y: neckTop, width: 6, height: neckBottom - neckTop, rx: 2 }));

  for (let s = 0; s < strings; s++) {
    const y = yString(s);
    const thickness = 1 + (strings - 1 - s) * 0.32;
    board.append(svg('line', { class: 'fb-string', x1: L.padL + 4, x2: width - L.padL, y1: y, y2: y, 'stroke-width': thickness }));
  }

  for (let f = 0; f <= frets; f++) {
    const marked = f === 0 || INLAYS.includes(f) || f % 12 === 0;
    board.append(
      svg('text', { class: `fb-fretnum${marked ? ' marked' : ''}`, x: xFret(f), y: neckBottom + 20 }, String(f)),
    );
  }

  const regionLayer = svg('g', { class: 'fb-regions' });
  const noteLayer = svg('g', { class: 'fb-notes' });
  root.append(board, regionLayer, noteLayer);

  // --- note nodes ---------------------------------------------------------
  const nodes = new Map();
  for (let s = 0; s < strings; s++) {
    for (let f = 0; f <= frets; f++) {
      const x = xFret(f);
      const y = yString(s);
      const hitW = f === 0 ? L.openW : L.fretW;
      const label = svg('text', { class: 'note-label', 'dominant-baseline': 'central' });
      const g = svg(
        'g',
        { class: 'note', transform: `translate(${x} ${y})`, 'data-s': s, 'data-f': f },
        svg('rect', { class: 'note-hit', x: -hitW / 2, y: -L.stringGap / 2, width: hitW, height: L.stringGap }),
        svg('g', { class: 'note-body' }, svg('circle', { class: 'note-dot', r: L.noteR }), label),
      );
      g.addEventListener('click', () => onNoteClick?.(s, f));
      noteLayer.append(g);
      nodes.set(`${s}:${f}`, { g, label, classes: '' });
    }
  }

  function update({ notes = new Map(), regions = [] } = {}) {
    for (const [key, node] of nodes) {
      const spec = notes.get(key);
      const cls = spec ? ['note', 'on', ...(spec.classes || [])].join(' ') : 'note';
      if (cls !== node.classes) {
        node.g.setAttribute('class', cls);
        node.classes = cls;
      }
      const text = spec?.label ?? '';
      if (node.label.textContent !== text) {
        node.label.textContent = text;
        node.label.setAttribute('class', `note-label${text.length > 2 ? ' small' : ''}`);
      }
    }

    regionLayer.replaceChildren(
      ...regions.map((r) => {
        const x = cellLeft(r.min) + 2;
        const w = cellRight(r.max) - cellLeft(r.min) - 4;
        const cls = ['fb-region', r.active && 'active', r.onClick && 'clickable', r.className].filter(Boolean).join(' ');
        const g = svg('g', { class: cls });
        g.append(
          svg('rect', { class: 'fb-region-band', x, y: neckTop - 4, width: w, height: neckBottom - neckTop + 8, rx: 10 }),
          svg('rect', { class: 'fb-region-pill', x: x + w / 2 - 18, y: 8, width: 36, height: 22, rx: 11 }),
          svg('text', { class: 'fb-region-label', x: x + w / 2, y: 19, 'dominant-baseline': 'central' }, r.label),
        );
        if (r.onClick) g.addEventListener('click', r.onClick);
        return g;
      }),
    );
  }

  function flash(s, f, cls = 'playing', ms = 380) {
    const node = nodes.get(`${s}:${f}`);
    if (!node) return;
    node.g.classList.add(cls);
    setTimeout(() => node.g.classList.remove(cls), ms);
  }

  return { el: root, update, flash, frets, strings };
}
