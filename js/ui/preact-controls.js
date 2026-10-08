// Preact versions of the themed controls (same CSS classes as ui/controls.js).

import { html } from '../vendor/preact-htm.js';

export function Field({ label, children, class: cls = '' }) {
  return html`<div class=${`field ${cls}`}>${label && html`<span class="field-label">${label}</span>`}${children}</div>`;
}

export function Seg({ label, value, options, onChange, compact = false }) {
  const group = html`<div class=${`segmented${compact ? ' compact' : ''}`} role="group" aria-label=${label || null}>
    ${options.map(
      (o) => html`<button
        type="button"
        class=${`seg-btn${String(o.value) === String(value) ? ' active' : ''}`}
        aria-pressed=${String(o.value) === String(value)}
        title=${o.title || null}
        onClick=${() => onChange(o.value)}
      >
        ${o.label}
      </button>`,
    )}
  </div>`;
  return label ? html`<${Field} label=${label}>${group}<//>` : group;
}

export function Toggle({ label, value, onChange, title }) {
  return html`<label class="switch" title=${title || null}>
    <input type="checkbox" role="switch" checked=${!!value} onChange=${(e) => onChange(e.target.checked)} />
    <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
    <span class="switch-label">${label}</span>
  </label>`;
}

/** options: [{ value, label }] or [{ group, options }] */
export function Select({ label, value, options, onChange, title }) {
  const opt = (o) => html`<option value=${o.value}>${o.label}</option>`;
  const sel = html`<select class="select" value=${value} title=${title || null} aria-label=${label || title || null} onChange=${(e) => onChange(e.target.value)}>
    ${options.map((o) => (o.group ? html`<optgroup label=${o.group}>${o.options.map(opt)}</optgroup>` : opt(o)))}
  </select>`;
  return label ? html`<${Field} label=${label}>${sel}<//>` : sel;
}

export function Stepper({ label, value, min, max, step = 1, onChange, format = (v) => v }) {
  const set = (v) => onChange(Math.min(max, Math.max(min, v)));
  const body = html`<div class="stepper">
    <button type="button" aria-label="Decrease" onClick=${() => set(value - step)} disabled=${value <= min}>−</button>
    <span class="stepper-value">${format(value)}</span>
    <button type="button" aria-label="Increase" onClick=${() => set(value + step)} disabled=${value >= max}>+</button>
  </div>`;
  return label ? html`<${Field} label=${label}>${body}<//>` : body;
}

/** Mount a DOM node built by vanilla code (e.g. chordDiagram()) inside a Preact tree. */
export function Vanilla({ node, class: cls = '' }) {
  return html`<div
    class=${cls}
    ref=${(el) => {
      if (el && node && el.firstChild !== node) el.replaceChildren(node);
    }}
  ></div>`;
}
