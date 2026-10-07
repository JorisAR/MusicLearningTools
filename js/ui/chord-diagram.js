// Classic vertical chord box (low E on the left), rendered as SVG.
//
//   chordDiagram(voicing, chord, { labels: 'intervals' | 'notes' | 'none' })

import { svg } from './dom.js';
import { toneLabel, toneKind, noteNameFor } from '../lib/chords.js';
import { pretty } from '../lib/theory.js';

const D = { left: 30, top: 30, sx: 21, sy: 25, r: 9, right: 14, bottom: 10 };

export function chordDiagram(v, chord, { labels = 'intervals' } = {}) {
  const strings = v.frets.length;
  const start = v.maxFret <= 4 ? 1 : v.minFret;
  const rows = Math.max(4, v.maxFret - start + 1);
  const width = D.left + (strings - 1) * D.sx + D.right;
  const height = D.top + rows * D.sy + D.bottom;
  const x = (s) => D.left + s * D.sx;
  const y = (f) => D.top + (f - start + 0.5) * D.sy;

  const root = svg('svg', { class: 'chord-diagram', viewBox: `0 0 ${width} ${height}`, role: 'img' });
  root.setAttribute('aria-label', `${chord.symbol}: ${v.frets.map((f) => (f < 0 ? 'x' : f)).join(' ')}`);

  // Grid
  for (let r = 0; r <= rows; r++) {
    const yy = D.top + r * D.sy;
    root.append(svg('line', { class: 'cd-fret', x1: x(0), x2: x(strings - 1), y1: yy, y2: yy }));
  }
  for (let s = 0; s < strings; s++) {
    root.append(svg('line', { class: 'cd-string', x1: x(s), x2: x(s), y1: D.top, y2: D.top + rows * D.sy }));
  }
  if (start === 1) {
    root.append(svg('rect', { class: 'cd-nut', x: x(0) - 1, y: D.top - 4, width: x(strings - 1) - x(0) + 2, height: 5, rx: 1.5 }));
  } else {
    root.append(svg('text', { class: 'cd-start', x: D.left - 12, y: y(start), 'dominant-baseline': 'central' }, `${start}`));
  }

  // Barre hint: several strings on the lowest fret with nothing lower in between.
  if (v.tags.includes('Barre')) {
    const atMin = v.notes.filter((n) => n.f === v.minFret);
    const from = atMin[0].s;
    const to = v.notes[v.notes.length - 1].s;
    root.append(
      svg('rect', {
        class: 'cd-barre',
        x: x(from) - D.r,
        y: y(v.minFret) - D.r,
        width: x(to) - x(from) + D.r * 2,
        height: D.r * 2,
        rx: D.r,
      }),
    );
  }

  // Markers + dots
  v.frets.forEach((f, s) => {
    if (f < 0) {
      root.append(svg('text', { class: 'cd-mute', x: x(s), y: D.top - 14, 'dominant-baseline': 'central' }, '×'));
      return;
    }
    const pc = (v.notes.find((n) => n.s === s) || {}).pc;
    const kind = toneKind(chord, pc);
    const label =
      labels === 'intervals' ? pretty(toneLabel(chord, pc)) : labels === 'notes' ? pretty(noteNameFor(chord, pc)) : '';
    if (f === 0) {
      root.append(
        svg(
          'g',
          { class: `cd-open ${kind}` },
          svg('circle', { cx: x(s), cy: D.top - 14, r: 7 }),
          svg('text', { x: x(s), y: D.top - 14, 'dominant-baseline': 'central' }, label),
        ),
      );
      return;
    }
    root.append(
      svg(
        'g',
        { class: `cd-dot ${kind}` },
        svg('circle', { cx: x(s), cy: y(f), r: D.r }),
        svg('text', { x: x(s), y: y(f), 'dominant-baseline': 'central', class: label.length > 2 ? 'small' : '' }, label),
      ),
    );
  });

  return root;
}
