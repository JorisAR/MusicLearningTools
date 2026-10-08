// Sketch view: song settings, sections (meter, chords, backing) and the arrangement.

import { html, useState } from '../../vendor/preact-htm.js';
import { useStore } from '../../song/store.js';
import {
  createSection,
  makeMeter,
  parseGroups,
  meterLabel,
  chordSlots,
  chordAtSlot,
  withChord,
  parseChordText,
  chordText,
  barTicks,
  uid,
} from '../../song/model.js';
import { DRUM_STYLES } from '../../song/generate/drums.js';
import { BASS_STYLES } from '../../song/generate/bass.js';
import { parseChord, transposeSymbol } from '../../lib/chords.js';
import { KEYS, SCALES, SCALE_GROUPS, pretty } from '../../lib/theory.js';
import { Field, Select, Stepper } from '../../ui/preact-controls.js';

const toOptions = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
const SCALE_OPTIONS = SCALE_GROUPS.map((g) => ({ group: g.label, options: g.ids.map((id) => ({ value: id, label: SCALES[id].name })) }));
const NEXT_NAME = (sections) => {
  const used = new Set(sections.map((s) => s.name));
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !used.has(c)) || `S${sections.length + 1}`;
};

export function Sketch({ app }) {
  const song = useStore(app.songs, (s) => s.song);
  const { songs } = app;
  return html`<div class="sketch">
    <${SongSettings} app=${app} song=${song} />
    <${Arrangement} app=${app} song=${song} />
    ${song.sections.map((sec) => html`<${SectionCard} key=${sec.id} app=${app} song=${song} sec=${sec} />`)}
    <button
      class="btn add-section"
      type="button"
      onClick=${() =>
        songs.update((d) => {
          const last = d.sections[d.sections.length - 1];
          const s = createSection({ name: NEXT_NAME(d.sections), meter: last?.meter, bars: 4, drums: last?.drums, bass: last?.bass });
          d.sections.push(s);
          d.arrangement.push({ section: s.id, repeat: 1 });
        })}
    >
      ＋ Add section
    </button>
  </div>`;
}

function SongSettings({ app, song }) {
  const { songs } = app;
  const set = (fn, key) => songs.update(fn, key);
  const swingLabel = song.swing === 0 ? 'Straight' : song.swing < 0.2 ? 'Light' : song.swing < 0.4 ? 'Swing' : 'Hard';
  return html`<section class="panel song-settings">
    <${Field} label="Tempo">
      <div class="inline">
        <input
          class="num"
          type="number"
          min="30"
          max="300"
          value=${song.tempo}
          onInput=${(e) => +e.target.value >= 30 && set((d) => (d.tempo = +e.target.value), 'tempo')}
        />
        <span class="muted">bpm</span>
      </div>
    <//>
    <${Field} label=${`Swing · ${swingLabel}`}>
      <input
        type="range"
        min="0"
        max="0.5"
        step="0.05"
        value=${song.swing}
        onInput=${(e) => set((d) => (d.swing = +e.target.value), 'swing')}
        title="Delays off-beat eighths (4/4, 3/4…). 0.33 ≈ triplet feel."
      />
    <//>
    <${Select} label="Key" value=${song.key} options=${KEYS.map((k) => ({ value: k, label: pretty(k) }))} onChange=${(v) => set((d) => (d.key = v))} />
    <${Select} label="Scale" value=${song.scale} options=${SCALE_OPTIONS} onChange=${(v) => set((d) => (d.scale = v))} />
    <${Stepper}
      label="Transpose"
      value=${song.transpose}
      min=${-11}
      max=${11}
      format=${(v) => (v > 0 ? `+${v}` : v)}
      onChange=${(v) => set((d) => (d.transpose = v), 'transpose')}
    />
    ${song.transpose !== 0 &&
    html`<p class="muted transpose-note">Chords are entered in ${pretty(song.key)}; playback and Practice are in ${pretty(transposeSymbol(song.key, song.transpose))}.</p>`}
  </section>`;
}

function Arrangement({ app, song }) {
  const { songs } = app;
  const byId = new Map(song.sections.map((s) => [s.id, s]));
  const move = (i, dir) =>
    songs.update((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.arrangement.length) return;
      [d.arrangement[i], d.arrangement[j]] = [d.arrangement[j], d.arrangement[i]];
    });
  return html`<section class="panel arrangement">
    <span class="field-label">Arrangement</span>
    <div class="arr-chain">
      ${song.arrangement.map((a, i) => {
        const sec = byId.get(a.section);
        return html`${i > 0 && html`<span class="arr-arrow">→</span>`}
          <div class="arr-item">
            <button class="arr-move" type="button" title="Move earlier" onClick=${() => move(i, -1)} disabled=${i === 0}>‹</button>
            <span class="arr-name">${sec?.name}</span>
            <span class="arr-meta">${sec && meterLabel(sec.meter)}</span>
            <${Stepper} value=${a.repeat} min=${1} max=${16} format=${(v) => `×${v}`} onChange=${(v) => songs.update((d) => (d.arrangement[i].repeat = v), `rep${i}`)} />
            <button class="arr-move" type="button" title="Move later" onClick=${() => move(i, 1)} disabled=${i === song.arrangement.length - 1}>›</button>
            <button
              class="arr-remove"
              type="button"
              title="Remove from arrangement"
              disabled=${song.arrangement.length === 1}
              onClick=${() => songs.update((d) => d.arrangement.splice(i, 1))}
            >
              ×
            </button>
          </div>`;
      })}
      <select
        class="select arr-add"
        value=""
        aria-label="Add a section to the arrangement"
        onChange=${(e) => {
          const id = e.target.value;
          e.target.value = '';
          if (id) songs.update((d) => d.arrangement.push({ section: id, repeat: 1 }));
        }}
      >
        <option value="">＋ Add…</option>
        ${song.sections.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
      </select>
    </div>
  </section>`;
}

function SectionCard({ app, song, sec }) {
  const { songs } = app;
  const idx = song.sections.findIndex((s) => s.id === sec.id);
  const edit = (fn, key) =>
    songs.update((d) => {
      fn(d.sections[idx], d);
    }, key);
  const [groupsText, setGroupsText] = useState(null);

  const setMeter = (num, den, groups) =>
    edit((s) => {
      const oldBt = barTicks(s.meter);
      s.meter = makeMeter(num, den, groups);
      // Keep chords on the same bar & group when the meter changes.
      const newBt = barTicks(s.meter);
      s.chords = s.chords.map((c) => {
        const bar = Math.floor(c.at / oldBt);
        const frac = (c.at % oldBt) / oldBt;
        return { ...c, at: bar * newBt + snapToGroup(s.meter, frac * newBt) };
      });
      s.chords = s.chords.filter((c, i, arr) => arr.findIndex((x) => x.at === c.at) === i);
    });

  return html`<section class="panel section-card">
    <div class="section-head">
      <input class="section-name" value=${sec.name} aria-label="Section name" onInput=${(e) => edit((s) => (s.name = e.target.value.slice(0, 24)), `name${sec.id}`)} />
      <${Stepper} label="Bars" value=${sec.bars} min=${1} max=${64} onChange=${(v) => edit((s) => {
        s.bars = v;
        s.chords = s.chords.filter((c) => c.at < v * barTicks(s.meter));
      }, `bars${sec.id}`)} />
      <${Field} label="Meter">
        <div class="meter">
          <input class="num" type="number" min="1" max="32" value=${sec.meter.num} aria-label="Beats per bar" onChange=${(e) => setMeter(+e.target.value, sec.meter.den)} />
          <span>/</span>
          <select class="select" value=${sec.meter.den} aria-label="Beat unit" onChange=${(e) => setMeter(sec.meter.num, +e.target.value)}>
            ${[2, 4, 8, 16].map((d) => html`<option value=${d}>${d}</option>`)}
          </select>
          <input
            class=${`groups${groupsText != null && !parseGroups(groupsText, sec.meter.num) ? ' invalid' : ''}`}
            value=${groupsText ?? sec.meter.groups.join('+')}
            title="Beat grouping, e.g. 2+2+3. Chords sit on group starts; drums accent them."
            aria-label="Grouping"
            onInput=${(e) => {
              setGroupsText(e.target.value);
              const g = parseGroups(e.target.value, sec.meter.num);
              if (g) setMeter(sec.meter.num, sec.meter.den, g);
            }}
            onBlur=${() => setGroupsText(null)}
          />
        </div>
      <//>
      <${Select}
        label="Drums"
        value=${sec.drums.gen?.style ?? 'custom'}
        options=${toOptions(DRUM_STYLES)}
        onChange=${(v) => edit((s) => (s.drums = { gen: { style: v } }))}
      />
      <${Select}
        label="Bass"
        value=${sec.bass.gen?.style ?? 'custom'}
        options=${toOptions(BASS_STYLES)}
        onChange=${(v) => edit((s) => (s.bass = { gen: { style: v } }))}
      />
      <div class="section-tools">
        <button
          class="btn"
          type="button"
          title="Duplicate section"
          onClick=${() =>
            songs.update((d) => {
              const copy = { ...structuredClone(d.sections[idx]), id: uid(), name: `${sec.name}′` };
              d.sections.splice(idx + 1, 0, copy);
              d.arrangement.push({ section: copy.id, repeat: 1 });
            })}
        >
          ⧉
        </button>
        <button
          class="btn"
          type="button"
          title="Delete section"
          disabled=${song.sections.length === 1}
          onClick=${() =>
            confirm(`Delete section ${sec.name}?`) &&
            songs.update((d) => {
              d.sections.splice(idx, 1);
              d.arrangement = d.arrangement.filter((a) => a.section !== sec.id);
            })}
        >
          🗑
        </button>
      </div>
    </div>
    <${ChordGrid} sec=${sec} edit=${edit} />
    <${QuickEntry} sec=${sec} edit=${edit} />
  </section>`;
}

function snapToGroup(meter, offset) {
  const unit = barTicks(meter) / meter.num;
  let t = 0;
  let best = 0;
  for (const g of meter.groups) {
    if (Math.abs(t - offset) < Math.abs(best - offset)) best = t;
    t += g * unit;
  }
  return best;
}

function ChordGrid({ sec, edit }) {
  const slots = chordSlots(sec);
  const perBar = sec.meter.groups.length;
  const bars = [];
  for (let b = 0; b < sec.bars; b++) bars.push(slots.slice(b * perBar, (b + 1) * perBar));
  let lastSym = '';
  return html`<div class="chord-grid" style=${{ '--slots': perBar }}>
    ${bars.map(
      (barSlots, b) => html`<div class="bar">
        <span class="bar-num">${b + 1}</span>
        <div class="bar-slots">
          ${barSlots.map((slot) => {
            const sym = chordAtSlot(sec, slot.at);
            const held = !sym && lastSym;
            if (sym) lastSym = sym;
            const bad = sym && !parseChord(sym);
            return html`<input
              class=${`slot${bad ? ' invalid' : ''}${sym ? ' has' : ''}${sym.length > 6 ? ' long' : ''}`}
              value=${sym}
              placeholder=${held ? '·' : ''}
              title=${bad ? 'Can’t read this chord' : held ? `${lastSym} continues` : 'Type a chord, e.g. Dm9, G13, C/D'}
              spellcheck="false"
              autocomplete="off"
              aria-label=${`Bar ${b + 1}, slot ${barSlots.indexOf(slot) + 1}`}
              onInput=${(e) => edit((s) => (s.chords = withChord(s.chords, slot.at, e.target.value)), `chord${sec.id}${slot.at}`)}
            />`;
          })}
        </div>
      </div>`,
    )}
  </div>`;
}

function QuickEntry({ sec, edit }) {
  const [text, setText] = useState(null);
  const apply = (value) => {
    if (value == null || value === chordText(sec)) return setText(null);
    const { chords, bars } = parseChordText(value, sec.meter);
    edit((s) => {
      s.chords = chords;
      s.bars = Math.max(1, bars);
    });
    setText(null);
  };
  return html`<form
    class="quick-entry"
    onSubmit=${(e) => {
      e.preventDefault();
      apply(e.currentTarget.querySelector('input').value);
    }}
  >
    <input
      value=${text ?? chordText(sec)}
      spellcheck="false"
      autocomplete="off"
      aria-label="Quick chord entry"
      title="Bars separated by |. Several chords in a bar share it. % repeats the previous bar, . holds."
      onInput=${(e) => setText(e.target.value)}
      onBlur=${(e) => apply(text == null ? null : e.target.value)}
    />
    <span class="muted">Type bars like <code>Dm9 G13 | Cmaj9 | %</code> and press Enter</span>
  </form>`;
}
