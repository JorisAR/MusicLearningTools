// Reusable, themed form controls. Each returns { el, set(value) } so a lesson
// can re-sync controls when state changes from elsewhere (keyboard, URL).

import { h } from './dom.js';

/** Single-choice button group. options: [{ value, label, title? }] */
export function segmented({ label, options, value, onChange, compact = false }) {
  const buttons = options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        class: 'seg-btn',
        title: o.title,
        dataset: { value: o.value },
        onclick: () => onChange(o.value),
      },
      o.label,
    ),
  );
  const group = h('div', { class: `segmented${compact ? ' compact' : ''}`, role: 'group', aria: { label } }, buttons);
  const el = field(label, group);
  const set = (v) =>
    buttons.forEach((b) => {
      const on = b.dataset.value === String(v);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
  set(value);
  return { el, set, setLabels: (fn) => buttons.forEach((b) => (b.textContent = fn(b.dataset.value))) };
}

/** On/off switch. */
export function toggle({ label, value, onChange, hint }) {
  const input = h('input', { type: 'checkbox', role: 'switch', onchange: (e) => onChange(e.target.checked) });
  const el = h(
    'label',
    { class: 'switch', title: hint },
    input,
    h('span', { class: 'switch-track', aria: { hidden: 'true' } }, h('span', { class: 'switch-thumb' })),
    h('span', { class: 'switch-label' }, label),
  );
  const set = (v) => (input.checked = !!v);
  set(value);
  return { el, set };
}

/** Native select, styled. options: [{ value, label }] or groups [{ group, options: [...] }] */
export function select({ label, options, value, onChange }) {
  const opt = (o) => h('option', { value: o.value }, o.label);
  const sel = h(
    'select',
    { class: 'select', onchange: (e) => onChange(e.target.value), aria: { label } },
    options.map((o) => (o.group ? h('optgroup', { label: o.group }, o.options.map(opt)) : opt(o))),
  );
  const el = field(label, sel);
  const set = (v) => (sel.value = String(v));
  set(value);
  return { el, set };
}

/** Multi-select chips (used for tag filters). */
export function chips({ options, selected = [], onChange }) {
  let current = new Set(selected);
  const buttons = options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip',
        dataset: { value: o.value },
        onclick: () => {
          current.has(o.value) ? current.delete(o.value) : current.add(o.value);
          onChange([...current]);
        },
      },
      o.label,
    ),
  );
  const el = h('div', { class: 'chips' }, buttons);
  const set = (vals) => {
    current = new Set(vals);
    buttons.forEach((b) => {
      const on = current.has(b.dataset.value);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
  };
  set(selected);
  return { el, set };
}

function field(label, control) {
  if (!label) return control;
  return h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
}
