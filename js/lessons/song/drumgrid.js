// Drum step grid (Preact): rows = drum voices, columns = 16th notes. Click to toggle.

import { html } from '../../vendor/preact-htm.js';

const STEP = 120; // a 16th note
export const DRUM_ROWS = [
  ['crash', 'Crash', 75],
  ['ride', 'Ride', 70],
  ['hatOpen', 'Open hat', 60],
  ['hat', 'Hi-hat', 60],
  ['pedal', 'Hat pedal', 55],
  ['rim', 'Rim', 70],
  ['snare', 'Snare', 100],
  ['ghost', 'Ghost', 30],
  ['kick', 'Kick', 100],
];

/** props: hits [{at,voice,vel}], length, barTicks, groupTicks (array of group starts within a bar), playhead, onChange, onAudition */
export function DrumGrid({ hits, length, barTicks, groupTicks, playhead, onChange, onAudition }) {
  const cols = Math.ceil(length / STEP);
  const cell = (voice, c) => hits.some((h) => h.voice === voice && h.at >= c * STEP && h.at < (c + 1) * STEP);
  const toggle = (voice, vel, c) => {
    if (cell(voice, c)) onChange(hits.filter((h) => !(h.voice === voice && h.at >= c * STEP && h.at < (c + 1) * STEP)));
    else {
      onAudition?.(voice, vel);
      onChange([...hits, { at: c * STEP, voice, vel }].sort((a, b) => a.at - b.at));
    }
  };
  const playCol = playhead != null ? Math.floor(playhead / STEP) : -1;
  return html`<div class="drumgrid" style=${{ '--cols': cols }}>
    ${DRUM_ROWS.map(
      ([voice, label, vel]) => html`<div class="dg-row">
        <span class="dg-label">${label}</span>
        <div class="dg-cells">
          ${Array.from({ length: cols }, (_, c) => {
            const t = c * STEP;
            const inBar = t % barTicks;
            const mark = inBar === 0 ? ' bar' : groupTicks.includes(inBar) ? ' group' : t % 480 === 0 ? ' beat' : '';
            return html`<button
              type="button"
              class=${`dg-cell${cell(voice, c) ? ' on' : ''}${mark}${c === playCol ? ' now' : ''}`}
              aria-label=${`${label}, step ${c + 1}`}
              aria-pressed=${cell(voice, c)}
              onClick=${() => toggle(voice, vel, c)}
            ></button>`;
          })}
        </div>
      </div>`,
    )}
  </div>`;
}
