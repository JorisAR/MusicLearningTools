// Piano roll (Preact + SVG). Mouse and touch via pointer events.
//   click empty space  → add a note (drag right to set its length)
//   drag a note        → move it (time & pitch); drag its right edge → resize
//   double-click / right-click a note → delete;  Delete / Backspace → delete selected
//   ← → ↑ ↓ on a selected note → nudge by one grid step / semitone

import { html, useState, useRef, useEffect } from '../../vendor/preact-htm.js';
import { mod12, SHARP_NAMES } from '../../lib/theory.js';

const ROW = 12; // px per semitone
const KEYW = 38; // keyboard column
const HEAD = 18; // chord label row
const isBlack = (m) => [1, 3, 6, 8, 10].includes(mod12(m));

/**
 * props: notes [{at,dur,pitch,vel}], length (ticks), lo/hi (midi range), snap (ticks),
 *        barTicks, beatTicks, chords [{at,end,sym,pcs:Set}], playhead (tick|null),
 *        pxPerTick, pending (recorded notes not yet committed), onChange(notes), onAudition(pitch)
 */
export function PianoRoll(props) {
  const { notes, length, lo, hi, snap, barTicks, beatTicks, chords = [], playhead, pxPerTick = 0.1, onChange, onAudition } = props;
  const [sel, setSel] = useState(null);
  const [drag, setDragState] = useState(null); // { i, mode, startX, startY, orig, note, created }
  const dragRef = useRef(null);
  const setDrag = (d) => {
    dragRef.current = d;
    setDragState(d);
  };
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const svgRef = useRef(null);
  const height = HEAD + (hi - lo + 1) * ROW;
  const width = KEYW + length * pxPerTick;
  const yOf = (p) => HEAD + (hi - p) * ROW;
  const xOf = (t) => KEYW + t * pxPerTick;
  const q = (t) => Math.round(t / snap) * snap;
  const qf = (t) => Math.floor(t / snap) * snap;

  const view = notes.map((n, i) => (drag && !drag.created && drag.i === i ? drag.note : n));
  if (drag?.created) view.push(drag.note);

  const point = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    const sx = (svgRef.current.viewBox.baseVal.width || width) / r.width;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sx };
  };
  const pitchAt = (y) => Math.max(lo, Math.min(hi, hi - Math.floor((y - HEAD) / ROW)));
  const tickAt = (x) => Math.max(0, Math.min(length - snap, (x - KEYW) / pxPerTick));

  function down(e) {
    if (e.button === 2) return;
    const { x, y } = point(e);
    if (y < HEAD) return;
    if (x < KEYW) return onAudition?.(pitchAt(y));
    const hit = view.findIndex((n) => x >= xOf(n.at) && x <= xOf(n.at + n.dur) && y >= yOf(n.pitch) && y < yOf(n.pitch) + ROW);
    try {
      svgRef.current.setPointerCapture(e.pointerId);
    } catch {}
    if (hit >= 0) {
      const n = view[hit];
      const edge = x > xOf(n.at + n.dur) - Math.max(5, Math.min(9, n.dur * pxPerTick * 0.3));
      setSel(hit);
      setDrag({ i: hit, mode: edge ? 'resize' : 'move', startX: x, startY: y, orig: n, note: n, moved: false });
    } else {
      const note = { at: qf(tickAt(x)), dur: snap, pitch: pitchAt(y), vel: 90 };
      onAudition?.(note.pitch);
      setSel(notes.length);
      setDrag({ i: notes.length, mode: 'resize', startX: xOf(note.at), startY: y, orig: note, note, moved: true, created: true });
    }
  }

  function move(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = point(e);
    const o = drag.orig;
    let note = o;
    if (drag.mode === 'move') {
      const dt = q((x - drag.startX) / pxPerTick);
      const dp = Math.round((drag.startY - y) / ROW);
      note = { ...o, at: Math.max(0, Math.min(length - o.dur, o.at + dt)), pitch: Math.max(lo, Math.min(hi, o.pitch + dp)) };
      if (note.pitch !== drag.note.pitch) onAudition?.(note.pitch);
    } else {
      const end = Math.max(o.at + snap, q(tickAt(x) + snap / 2));
      note = { ...o, dur: Math.min(length - o.at, end - o.at) };
    }
    setDrag({ ...drag, note, moved: drag.moved || note !== o });
  }

  function up() {
    const drag = dragRef.current;
    if (!drag) return;
    const cur = notesRef.current;
    if (drag.created) onChange([...cur, drag.note]);
    else if (drag.moved) onChange(cur.map((n, i) => (i === drag.i ? drag.note : n)));
    setDrag(null);
  }

  const remove = (i) => {
    onChange(notes.filter((_, k) => k !== i));
    setSel(null);
  };

  function key(e) {
    if (sel == null || !notes[sel]) return;
    const n = notes[sel];
    const put = (patch) => onChange(notes.map((x, i) => (i === sel ? { ...x, ...patch } : x)));
    if (e.key === 'Delete' || e.key === 'Backspace') remove(sel);
    else if (e.key === 'ArrowUp') put({ pitch: Math.min(hi, n.pitch + 1) }), onAudition?.(n.pitch + 1);
    else if (e.key === 'ArrowDown') put({ pitch: Math.max(lo, n.pitch - 1) }), onAudition?.(n.pitch - 1);
    else if (e.key === 'ArrowRight') put(e.shiftKey ? { dur: Math.min(length - n.at, n.dur + snap) } : { at: Math.min(length - n.dur, n.at + snap) });
    else if (e.key === 'ArrowLeft') put(e.shiftKey ? { dur: Math.max(snap, n.dur - snap) } : { at: Math.max(0, n.at - snap) });
    else if (e.key === 'Escape') setSel(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  useEffect(() => {
    if (sel != null && sel >= notes.length) setSel(null);
  }, [notes.length]);

  // --- drawing ---
  const rows = [];
  for (let p = hi; p >= lo; p--)
    rows.push(html`<rect class=${`pr-row${isBlack(p) ? ' black' : ''}${mod12(p) === 0 ? ' c' : ''}`} x=${KEYW} y=${yOf(p)} width=${width - KEYW} height=${ROW} />`);
  const toneRows = [];
  for (const c of chords) {
    for (let p = hi; p >= lo; p--)
      if (c.pcs.has(mod12(p)))
        toneRows.push(html`<rect class=${`pr-tone${mod12(p) === c.rootPc ? ' root' : ''}`} x=${xOf(c.at)} y=${yOf(p)} width=${(c.end - c.at) * pxPerTick} height=${ROW} />`);
  }
  const lines = [];
  for (let t = 0; t <= length; t += snap) {
    const kind = t % barTicks === 0 ? 'bar' : t % beatTicks === 0 ? 'beat' : 'sub';
    lines.push(html`<line class=${`pr-line ${kind}`} x1=${xOf(t)} x2=${xOf(t)} y1=${HEAD} y2=${height} />`);
  }
  const keys = [];
  for (let p = hi; p >= lo; p--)
    keys.push(html`<g class=${`pr-key${isBlack(p) ? ' black' : ''}`}>
      <rect x="0" y=${yOf(p)} width=${KEYW - 2} height=${ROW} />
      ${mod12(p) === 0 && html`<text x=${KEYW - 5} y=${yOf(p) + ROW - 2.5}>C${p / 12 - 1}</text>`}
    </g>`);

  return html`<div class="pianoroll" tabIndex="0" onKeyDown=${key}>
    <svg
      ref=${svgRef}
      viewBox=${`0 0 ${width} ${height}`}
      style=${{ width: `${width}px`, height: `${height}px` }}
      onPointerDown=${down}
      onPointerMove=${move}
      onPointerUp=${up}
      onPointerCancel=${up}
      onContextMenu=${(e) => {
        const { x, y } = point(e);
        const hit = notes.findIndex((n) => x >= xOf(n.at) && x <= xOf(n.at + n.dur) && y >= yOf(n.pitch) && y < yOf(n.pitch) + ROW);
        if (hit >= 0) {
          e.preventDefault();
          remove(hit);
        }
      }}
      onDblClick=${(e) => {
        const { x, y } = point(e);
        const hit = notes.findIndex((n) => x >= xOf(n.at) && x <= xOf(n.at + n.dur) && y >= yOf(n.pitch) && y < yOf(n.pitch) + ROW);
        if (hit >= 0) remove(hit);
      }}
    >
      ${rows} ${toneRows} ${lines}
      ${chords.map((c) => html`<text class="pr-chord" x=${xOf(c.at) + 4} y="13">${c.label}</text>`)}
      ${(props.pending || []).map((n) => html`<rect class="pr-note pending" x=${xOf(n.at)} y=${yOf(n.pitch) + 1} width=${Math.max(3, n.dur * pxPerTick)} height=${ROW - 2} rx="3" />`)}
      ${view.map(
        (n, i) => html`<g class=${`pr-note-g${i === sel ? ' sel' : ''}`}>
          <rect class="pr-note" x=${xOf(n.at)} y=${yOf(n.pitch) + 1} width=${Math.max(4, n.dur * pxPerTick - 1)} height=${ROW - 2} rx="3" />
          ${n.dur * pxPerTick > 26 && html`<text class="pr-note-label" x=${xOf(n.at) + 4} y=${yOf(n.pitch) + ROW - 3}>${SHARP_NAMES[mod12(n.pitch)]}</text>`}
        </g>`,
      )}
      ${playhead != null && html`<line class="pr-playhead" x1=${xOf(playhead)} x2=${xOf(playhead)} y1="0" y2=${height} />`}
      ${keys}
    </svg>
  </div>`;
}
