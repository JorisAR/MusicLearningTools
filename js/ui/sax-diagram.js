// Saxophone fingering diagram (Preact). Keys follow the names in lib/sax.js.
import { html } from '../vendor/preact-htm.js';

// [key, shape, x, y, w, h, label]
const KEYS = [
  ['oct', 'c', 30, 22, 6, 6, 'Octave key (left thumb)'],
  ['palmD', 'o', 30, 52, 5, 9, 'Palm D'],
  ['palmEb', 'o', 22, 68, 5, 9, 'Palm E♭'],
  ['palmF', 'o', 30, 84, 5, 9, 'Palm F'],
  ['frontF', 'o', 84, 40, 6, 4, 'Front F'],
  ['L1', 'c', 60, 48, 11, 11, 'Left index (B)'],
  ['bis', 'c', 60, 66, 3.5, 3.5, 'Bis B♭'],
  ['L2', 'c', 60, 84, 11, 11, 'Left middle (A)'],
  ['L3', 'c', 60, 110, 11, 11, 'Left ring (G)'],
  ['gs', 'o', 88, 118, 7, 4, 'G♯ (left pinky)'],
  ['lowCs', 'o', 84, 134, 6, 4, 'Low C♯ (left pinky)'],
  ['lowB', 'o', 78, 146, 6, 4, 'Low B (left pinky)'],
  ['lowBb', 'o', 92, 146, 6, 4, 'Low B♭ (left pinky)'],
  ['sideE', 'o', 92, 172, 4, 7, 'Side E (right hand)'],
  ['sideC', 'o', 92, 188, 4, 7, 'Side C'],
  ['sideBb', 'o', 92, 204, 4, 7, 'Side B♭'],
  ['sideFs', 'o', 100, 222, 4, 6, 'High F♯ (side)'],
  ['R1', 'c', 60, 178, 11, 11, 'Right index (F)'],
  ['R2', 'c', 60, 204, 11, 11, 'Right middle (E)'],
  ['R3', 'c', 60, 230, 11, 11, 'Right ring (D)'],
  ['lowEb', 'o', 74, 254, 6, 4, 'Low E♭ (right pinky)'],
  ['lowC', 'o', 74, 266, 6, 4, 'Low C (right pinky)'],
];

export function SaxDiagram({ keys = [], label = '', small = false }) {
  const pressed = new Set(keys);
  return html`<svg class=${`sax-diagram${small ? ' small' : ''}`} viewBox="0 0 120 282" role="img" aria-label=${label || 'Saxophone fingering'}>
    <line class="sax-body" x1="60" y1="34" x2="60" y2="244" />
    <line class="sax-split" x1="40" y1="148" x2="80" y2="148" />
    ${KEYS.map(([k, shape, x, y, w, h, title]) =>
      shape === 'c'
        ? html`<circle class=${`sax-key${pressed.has(k) ? ' on' : ''}`} cx=${x} cy=${y} r=${w}><title>${title}</title></circle>`
        : html`<ellipse class=${`sax-key${pressed.has(k) ? ' on' : ''}`} cx=${x} cy=${y} rx=${w} ry=${h}><title>${title}</title></ellipse>`,
    )}
    <text class="sax-oct" x="30" y="10">8va</text>
  </svg>`;
}
