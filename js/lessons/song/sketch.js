// Sketch view: song settings, a visual arrangement, and section cards with
// Chords / Melody / Bass / Drums tabs.

import { html, useState, useRef } from '../../vendor/preact-htm.js';
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
  groupStarts,
  unitTicks,
  uid,
  SECTION_COLORS,
} from '../../song/model.js';
import { DRUM_STYLES } from '../../song/generate/drums.js';
import { BASS_STYLES } from '../../song/generate/bass.js';
import { parseChord, transposeSymbol, PROGRESSIONS, realize, randomProgression } from '../../lib/chords.js';
import { KEYS, SCALES, SCALE_GROUPS, pretty, mod12 } from '../../lib/theory.js';
import { chordDiagram } from '../../ui/chord-diagram.js';
import { Field, Select, Stepper, Seg, Vanilla } from '../../ui/preact-controls.js';
import { SOUNDS } from '../../engine/instruments.js';
import { PianoRoll } from './pianoroll.js';
import { DrumGrid } from './drumgrid.js';

const toOptions = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
const SCALE_OPTIONS = SCALE_GROUPS.map((g) => ({ group: g.label, options: g.ids.map((id) => ({ value: id, label: SCALES[id].name })) }));
const NEXT_NAME = (sections) => {
  const used = new Set(sections.map((s) => s.name));
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !used.has(c)) || `S${sections.length + 1}`;
};
export const secColor = (sec) => SECTION_COLORS[sec.color ?? 0];

export function Sketch({ app }) {
  const song = useStore(app.songs, (s) => s.song);
  const chordView = useStore(app.ui, (s) => s.chordView);
  const { songs } = app;
  return html`<div class="sketch">
    <${SongSettings} app=${app} song=${song} />
    <${Arrangement} app=${app} song=${song} />
    <div class="sketch-toolbar">
      <span class="field-label">Sections</span>
      <${Seg}
        value=${chordView}
        options=${[
          { value: 'guitar', label: 'Guitar chords', title: 'Show a guitar voicing under every chord' },
          { value: 'piano', label: 'Piano chords' },
          { value: 'off', label: 'Names only' },
        ]}
        onChange=${(v) => app.actions.setUi({ chordView: v })}
      />
    </div>
    ${song.sections.map((sec) => html`<${SectionCard} key=${sec.id} app=${app} song=${song} sec=${sec} />`)}
    <button
      class="btn add-section"
      type="button"
      onClick=${() =>
        songs.update((d) => {
          const last = d.sections[d.sections.length - 1];
          const used = new Set(d.sections.map((s) => s.color));
          const color = [...SECTION_COLORS.keys()].find((c) => !used.has(c)) ?? d.sections.length % SECTION_COLORS.length;
          const s = createSection({ name: NEXT_NAME(d.sections), meter: last?.meter, bars: 4, color, drums: last?.drums.gen ? last.drums : undefined, bass: last?.bass.gen ? last.bass : undefined });
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
        <input class="num" type="number" min="30" max="300" value=${song.tempo} onInput=${(e) => +e.target.value >= 30 && set((d) => (d.tempo = +e.target.value), 'tempo')} />
        <span class="muted">bpm</span>
      </div>
    <//>
    <${Field} label=${`Swing · ${swingLabel}`}>
      <input type="range" min="0" max="0.5" step="0.05" value=${song.swing} onInput=${(e) => set((d) => (d.swing = +e.target.value), 'swing')} title="Delays off-beat eighths (4/4, 3/4…). 0.33 ≈ triplet feel." />
    <//>
    <${Select} label="Key" value=${song.key} options=${KEYS.map((k) => ({ value: k, label: pretty(k) }))} onChange=${(v) => set((d) => (d.key = v))} />
    <${Select} label="Scale" value=${song.scale} options=${SCALE_OPTIONS} onChange=${(v) => set((d) => (d.scale = v))} />
    <${Stepper} label="Transpose" value=${song.transpose} min=${-11} max=${11} format=${(v) => (v > 0 ? `+${v}` : v)} onChange=${(v) => set((d) => (d.transpose = v), 'transpose')} />
    ${song.transpose !== 0 &&
    html`<p class="muted transpose-note">Chords are entered in ${pretty(song.key)}; playback, chord pictures and Practice are in ${pretty(transposeSymbol(song.key, song.transpose))}.</p>`}
  </section>`;
}

// --- arrangement: colored blocks, drag to reorder ----------------------------------

function Arrangement({ app, song }) {
  const { songs } = app;
  const byId = new Map(song.sections.map((s) => [s.id, s]));
  const tick = useStore(app.now, (s) => Math.floor(s.tick / 240));
  const tl = app.timeline();
  const playingArr = tl.instances.find((i) => tick * 240 >= i.start && tick * 240 < i.start + i.length)?.arrIndex;
  const [drag, setDragState] = useState(null); // { from, to, x0, y0, rects, active }
  const dragRef = useRef(null);
  const setDrag = (d) => {
    dragRef.current = d;
    setDragState(d);
  };
  const rowRef = useRef(null);
  const total = song.arrangement.reduce((a, it) => a + (byId.get(it.section) ? byId.get(it.section).bars * barTicks(byId.get(it.section).meter) * it.repeat : 0), 0) || 1;

  const order = song.arrangement.map((_, i) => i);
  if (drag && drag.to !== drag.from) {
    order.splice(drag.from, 1);
    order.splice(drag.to, 0, drag.from);
  }

  const onDown = (e, i) => {
    if (e.target.closest('button, .stepper')) return;
    const rects = [...rowRef.current.querySelectorAll('.arr-block')].map((el) => el.getBoundingClientRect());
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    setDrag({ from: i, to: i, x0: e.clientX, y0: e.clientY, rects, active: false });
  };
  const onMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const active = drag.active || Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6;
    if (!active) return;
    // Closest block centre (works when blocks wrap onto several rows too).
    let to = 0;
    let best = Infinity;
    drag.rects.forEach((r, k) => {
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < best) (best = d), (to = k);
    });
    setDrag({ ...drag, to, active });
  };
  const onUp = (i) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.active && drag.to !== drag.from) {
      songs.update((d) => {
        const [item] = d.arrangement.splice(drag.from, 1);
        d.arrangement.splice(drag.to, 0, item);
      });
    } else if (!drag.active) {
      // a click: jump there and show the section
      const inst = tl.instances.find((x) => x.arrIndex === i);
      if (inst) app.actions.seek(inst.start);
      document.getElementById(`sec-${song.arrangement[i].section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setDrag(null);
  };

  return html`<section class="panel arrangement">
    <div class="arr-head">
      <span class="field-label">Arrangement · drag to reorder, click to jump</span>
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
        <option value="">＋ Add to arrangement…</option>
        ${song.sections.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
      </select>
    </div>
    <div class="arr-row" ref=${rowRef}>
      ${order.map((i) => {
        const a = song.arrangement[i];
        const sec = byId.get(a.section);
        if (!sec) return null;
        const len = sec.bars * barTicks(sec.meter) * a.repeat;
        return html`<div
          key=${`${i}-${a.section}`}
          class=${`arr-block${drag?.active && drag.from === i ? ' dragging' : ''}${playingArr === i ? ' playing' : ''}`}
          style=${{ '--sec': secColor(sec), flexGrow: len / total }}
          onPointerDown=${(e) => onDown(e, i)}
          onPointerMove=${onMove}
          onPointerUp=${() => onUp(i)}
          onPointerCancel=${() => setDrag(null)}
          title=${`${sec.name}: ${sec.bars} bars of ${meterLabel(sec.meter)}, ×${a.repeat}`}
        >
          <div class="arr-top">
            <span class="arr-name">${sec.name}</span>
            <button class="arr-remove" type="button" title="Remove from arrangement" disabled=${song.arrangement.length === 1} onClick=${() => songs.update((d) => d.arrangement.splice(i, 1))}>×</button>
          </div>
          <span class="arr-meta">${sec.bars} bars · ${meterLabel(sec.meter)}</span>
          <${Stepper} value=${a.repeat} min=${1} max=${16} format=${(v) => `×${v}`} onChange=${(v) => songs.update((d) => (d.arrangement[i].repeat = v), `rep${i}`)} />
        </div>`;
      })}
    </div>
  </section>`;
}

// --- section card -----------------------------------------------------------------

function SectionCard({ app, song, sec }) {
  const { songs } = app;
  const idx = song.sections.findIndex((s) => s.id === sec.id);
  const [tab, setTab] = useState('chords');
  const [groupsText, setGroupsText] = useState(null);
  const edit = (fn, key) =>
    songs.update((d) => {
      fn(d.sections[idx], d);
    }, key);

  const setMeter = (num, den, groups) =>
    edit((s) => {
      const oldBt = barTicks(s.meter);
      s.meter = makeMeter(num, den, groups);
      const newBt = barTicks(s.meter);
      // Keep chords on the same bar & (nearest) group when the meter changes.
      s.chords = s.chords
        .map((c) => ({ ...c, at: Math.floor(c.at / oldBt) * newBt + snapToGroup(s.meter, ((c.at % oldBt) / oldBt) * newBt) }))
        .filter((c, i, arr) => arr.findIndex((x) => x.at === c.at) === i);
      const scale = newBt / oldBt;
      s.melody = s.melody.map((n) => ({ ...n, at: Math.round(n.at * scale), dur: Math.max(60, Math.round(n.dur * scale)) }));
    });

  const counts = { melody: sec.melody.length || '', bass: sec.bass.notes ? '✎' : '', drums: sec.drums.steps ? '✎' : '' };
  return html`<section class="panel section-card" id=${`sec-${sec.id}`} style=${{ '--sec': secColor(sec) }}>
    <div class="section-head">
      <button class="sec-color" type="button" title="Change color" onClick=${() => edit((s) => (s.color = ((s.color ?? 0) + 1) % SECTION_COLORS.length))}></button>
      <input class="section-name" value=${sec.name} aria-label="Section name" onInput=${(e) => edit((s) => (s.name = e.target.value.slice(0, 24)), `name${sec.id}`)} />
      <${Stepper}
        label="Bars"
        value=${sec.bars}
        min=${1}
        max=${64}
        onChange=${(v) =>
          edit((s) => {
            s.bars = v;
            const end = v * barTicks(s.meter);
            s.chords = s.chords.filter((c) => c.at < end);
            s.melody = s.melody.filter((n) => n.at < end);
          }, `bars${sec.id}`)}
      />
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
      <div class="section-tools">
        <button
          class="btn"
          type="button"
          title="Duplicate section"
          onClick=${() =>
            songs.update((d) => {
              const copy = { ...structuredClone(d.sections[idx]), id: uid(), name: `${sec.name}′`, color: ((sec.color ?? 0) + 1) % SECTION_COLORS.length };
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
    <div class="sec-tabs" role="tablist">
      ${[
        ['chords', 'Chords'],
        ['melody', 'Melody'],
        ['bass', 'Bass'],
        ['drums', 'Drums'],
      ].map(
        ([id, label]) => html`<button type="button" role="tab" aria-selected=${tab === id} class=${`sec-tab${tab === id ? ' active' : ''}`} onClick=${() => setTab(id)}>
          ${label}${counts[id] ? html` <small>${counts[id]}</small>` : ''}
        </button>`,
      )}
    </div>
    ${tab === 'chords' && html`<${ChordsTab} app=${app} song=${song} sec=${sec} edit=${edit} />`}
    ${tab === 'melody' && html`<${MelodyTab} app=${app} song=${song} sec=${sec} edit=${edit} />`}
    ${tab === 'bass' && html`<${BassTab} app=${app} song=${song} sec=${sec} edit=${edit} />`}
    ${tab === 'drums' && html`<${DrumsTab} app=${app} sec=${sec} edit=${edit} />`}
  </section>`;
}

function snapToGroup(meter, offset) {
  let best = 0;
  for (const t of groupStarts(meter)) if (Math.abs(t - offset) < Math.abs(best - offset)) best = t;
  return best;
}

/** The section's first instance in the timeline, and the playhead relative to it (if playing there). */
function useSectionTime(app, sec) {
  useStore(app.songs, (s) => s.song);
  const tl = app.timeline();
  const inst = tl.instances.find((i) => i.section.id === sec.id);
  const rel = useStore(app.now, (s) => {
    const i = app.timeline().instances.find((x) => x.section.id === sec.id && s.tick >= x.start && s.tick < x.start + x.length);
    return i ? Math.floor((s.tick - i.start) / 30) * 30 : null;
  });
  const playing = useStore(app.ui, (s) => s.playing);
  return { tl, inst, playhead: playing ? rel : null };
}

function chordSpans(tl, inst) {
  if (!inst) return [];
  return tl.chords
    .filter((c) => c.tick < inst.start + inst.length && c.end > inst.start)
    .map((c) => ({
      at: Math.max(0, c.tick - inst.start),
      end: Math.min(inst.length, c.end - inst.start),
      label: pretty(c.sym),
      rootPc: c.chord.rootPc,
      pcs: new Set(c.chord.tones.map((t) => t.pc)),
    }));
}

// --- chords tab -------------------------------------------------------------------

function ChordsTab({ app, song, sec, edit }) {
  const chordView = useStore(app.ui, (s) => s.chordView);
  const { tl } = useSectionTime(app, sec);
  const loadText = (chords, name) => {
    const { chords: parsed, bars } = parseChordText(chords.join(' | '), sec.meter);
    edit((s) => {
      s.chords = parsed;
      s.bars = Math.max(1, bars);
    });
    if (name) app.actions.toast(`Loaded “${name}” in ${pretty(song.key)}`);
  };
  return html`<div class="tab-body">
    <div class="tab-toolbar">
      <select
        class="select"
        value=""
        aria-label="Load a progression"
        onChange=${(e) => {
          const t = PROGRESSIONS[+e.target.value];
          e.target.value = '';
          if (t) loadText(realize(t, song.key), t.name);
        }}
      >
        <option value="">Load a progression…</option>
        ${PROGRESSIONS.map((t, i) => html`<option value=${i}>${t.name}</option>`)}
      </select>
      <button
        class="btn"
        type="button"
        title="Fill this section with a random jazz/fusion progression in the song's key"
        onClick=${() => {
          const r = randomProgression();
          const t = PROGRESSIONS.find((p) => p.name === r.name);
          loadText(realize(t, song.key), r.name);
        }}
      >
        🎲 Random
      </button>
      <${QuickEntry} sec=${sec} edit=${edit} />
    </div>
    <${ChordGrid} app=${app} sec=${sec} edit=${edit} tl=${tl} view=${chordView} />
  </div>`;
}

function ChordGrid({ app, sec, edit, tl, view }) {
  const slots = chordSlots(sec);
  const perBar = sec.meter.groups.length;
  const bars = [];
  for (let b = 0; b < sec.bars; b++) bars.push(slots.slice(b * perBar, (b + 1) * perBar));
  let lastSym = '';
  const occurrence = (at) => tl.chords.find((c) => c.src?.sec === sec.id && c.src.at === at);
  const setLock = (at, key) => edit((s) => (s.chords = s.chords.map((c) => (c.at === at ? (key ? { ...c, gtr: key } : { at: c.at, sym: c.sym }) : c))));

  return html`<div class=${`chord-grid view-${view}`} style=${{ '--slots': perBar }}>
    ${bars.map(
      (barSlots, b) => html`<div class="bar">
        <span class="bar-num">${b + 1}</span>
        <div class="bar-slots">
          ${barSlots.map((slot) => {
            const sym = chordAtSlot(sec, slot.at);
            const held = !sym && lastSym;
            if (sym) lastSym = sym;
            const bad = sym && !parseChord(sym);
            const occ = sym && !bad ? occurrence(slot.at) : null;
            return html`<div class="slot-cell">
              <input
                class=${`slot${bad ? ' invalid' : ''}${sym ? ' has' : ''}${sym.length > 6 ? ' long' : ''}`}
                value=${sym}
                placeholder=${held ? '·' : ''}
                title=${bad ? 'Can’t read this chord' : held ? `${lastSym} continues` : 'Type a chord, e.g. Dm9, G13, C/D'}
                spellcheck="false"
                autocomplete="off"
                aria-label=${`Bar ${b + 1}, slot ${barSlots.indexOf(slot) + 1}`}
                onInput=${(e) => edit((s) => (s.chords = withChord(s.chords, slot.at, e.target.value)), `chord${sec.id}${slot.at}`)}
              />
              ${occ && view === 'guitar' && html`<${GuitarPick} app=${app} occ=${occ} onLock=${(key) => setLock(slot.at, key)} />`}
              ${occ && view === 'piano' && html`<${PianoMini} occ=${occ} onClick=${() => app.actions.audition([...occ.piano.lh, ...occ.piano.rh], 'piano')} />`}
            </div>`;
          })}
        </div>
      </div>`,
    )}
  </div>`;
}

function GuitarPick({ app, occ, onLock }) {
  if (!occ.guitar) return html`<span class="muted small">no voicing</span>`;
  const list = occ.ranked?.length ? occ.ranked : [occ.guitar];
  const i = Math.max(0, list.findIndex((v) => v.key === occ.guitar.key));
  const pick = (dir) => {
    const v = list[(i + dir + list.length) % list.length];
    onLock(v.key);
    app.actions.audition(v.notes.map((n) => n.midi), 'jazzGuitar');
  };
  return html`<div class="gpick">
    <button class="diagram-btn" type="button" title="Hear it" onClick=${() => app.actions.audition(occ.guitar.notes.map((n) => n.midi), 'jazzGuitar')}>
      <${Vanilla} node=${chordDiagram(occ.guitar, occ.chord, { labels: 'intervals' })} />
    </button>
    <div class="gpick-nav">
      <button type="button" title="Previous voicing" onClick=${() => pick(-1)}>‹</button>
      ${occ.locked
        ? html`<button type="button" class="lock" title="You picked this voicing — click to let the planner choose" onClick=${() => onLock(null)}>🔒</button>`
        : html`<span class="rank">${i + 1}/${list.length}</span>`}
      <button type="button" title="Next voicing" onClick=${() => pick(1)}>›</button>
    </div>
  </div>`;
}

/** Compact piano picture of a chord's voicing (left hand + right hand). */
function PianoMini({ occ, onClick }) {
  const notes = [...occ.piano.lh.map((m) => (m < 36 ? m + 12 : m)), ...occ.piano.rh];
  const black = (m) => [1, 3, 6, 8, 10].includes(mod12(m));
  let lo = Math.min(...notes) - 2;
  let hi = Math.max(...notes) + 2;
  while (black(lo)) lo--;
  while (black(hi)) hi++;
  const on = new Set(notes);
  const whites = [];
  for (let m = lo; m <= hi; m++) if (!black(m)) whites.push(m);
  const W = 7;
  const x = new Map(whites.map((m, i) => [m, i * W]));
  for (let m = lo; m <= hi; m++) if (black(m)) x.set(m, x.get(m - 1) + W * 0.65);
  const kind = (m) => {
    const t = occ.chord.tones.find((tt) => tt.pc === mod12(m));
    if (!t) return 'bass';
    if (t.token === '1') return 'root';
    const n = +t.token.replace(/\D/g, '');
    return n === 3 || n === 7 || n === 6 ? 'guide' : n === 5 ? 'fifth' : 'color';
  };
  return html`<button class="pmini-btn" type="button" title="Hear it" onClick=${onClick}>
    <svg class="pmini" viewBox=${`0 0 ${whites.length * W} 30`}>
      ${whites.map((m) => html`<rect class=${`pm-w${on.has(m) ? ` on ${kind(m)}` : ''}`} x=${x.get(m) + 0.3} y="0" width=${W - 0.6} height="30" rx="1" />`)}
      ${[...x.keys()].filter(black).map((m) => html`<rect class=${`pm-b${on.has(m) ? ` on ${kind(m)}` : ''}`} x=${x.get(m)} y="0" width=${W * 0.7} height="18" rx="1" />`)}
    </svg>
  </button>`;
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
      title="Type bars like: Dm9 G13 | Cmaj9 | %  — | separates bars, % repeats a bar, . holds. Press Enter."
      onInput=${(e) => setText(e.target.value)}
      onBlur=${(e) => apply(text == null ? null : e.target.value)}
    />
  </form>`;
}

// --- melody tab -------------------------------------------------------------------

const SNAPS = [
  { value: 480, label: 'Grid 1/4' },
  { value: 240, label: 'Grid 1/8' },
  { value: 160, label: 'Grid 1/8 triplet' },
  { value: 120, label: 'Grid 1/16' },
];

function MelodyTab({ app, song, sec, edit }) {
  const st = useStore(app.ui);
  const { tl, inst, playhead } = useSectionTime(app, sec);
  const len = sec.bars * barTicks(sec.meter);
  const pitches = sec.melody.map((n) => n.pitch + song.transpose);
  const lo = Math.min(55, ...pitches.map((p) => p - 3));
  const hi = Math.max(84, ...pitches.map((p) => p + 3));
  const recording = st.recording === sec.id;
  return html`<div class="tab-body">
    <div class="tab-toolbar">
      <button class=${`btn rec${recording ? ' on' : ''}`} type="button" onClick=${() => app.actions.record(sec.id)} title="Loop this section with a count-in and record from the computer keyboard or a MIDI keyboard">
        ${recording ? '■ Stop recording' : '● Record'}
      </button>
      <${Select} title="Grid / quantize" value=${st.snap} options=${SNAPS} onChange=${(v) => app.actions.setUi({ snap: +v })} />
      <${Select}
        title="Melody sound"
        value=${st.melodySound}
        options=${['altoSax', 'piano', 'epiano', 'jazzGuitar', 'nylon'].map((id) => ({ value: id, label: SOUNDS[id].label }))}
        onChange=${(v) => app.actions.setUi({ melodySound: v })}
      />
      <${Select}
        title="Guitar position for this melody (Practice view)"
        value=${sec.gtrPos ?? ''}
        options=${[{ value: '', label: 'Guitar: auto position' }, ...Array.from({ length: 13 }, (_, i) => ({ value: i + 1, label: `Guitar: position ${i + 1}` }))]}
        onChange=${(v) => edit((s) => (s.gtrPos = v ? +v : null))}
      />
      ${sec.melody.length > 0 && html`<button class="btn" type="button" onClick=${() => confirm('Clear this melody?') && edit((s) => (s.melody = []))}>Clear</button>`}
    </div>
    <p class="muted hint">
      ${recording
        ? 'Recording — play along on ⌨ A W S E D F T G Y H U J K (Z / X = octave down / up) or your MIDI keyboard.'
        : 'Click to add a note, drag to move or lengthen it, double-click to delete. Shaded rows are chord tones.'}
    </p>
    <div class="roll-scroll">
      <${PianoRoll}
        notes=${sec.melody.map((n) => ({ ...n, pitch: n.pitch + song.transpose }))}
        length=${len}
        lo=${lo}
        hi=${hi}
        snap=${st.snap}
        barTicks=${barTicks(sec.meter)}
        beatTicks=${unitTicks(sec.meter.den)}
        chords=${chordSpans(tl, inst)}
        playhead=${playhead}
        pxPerTick=${0.1}
        onChange=${(notes) => edit((s) => (s.melody = notes.map((n) => ({ ...n, pitch: n.pitch - song.transpose }))))}
        onAudition=${(p) => app.actions.audition([p], st.melodySound)}
      />
    </div>
  </div>`;
}

// --- bass tab ---------------------------------------------------------------------

function BassTab({ app, song, sec, edit }) {
  const { tl, inst, playhead } = useSectionTime(app, sec);
  const bassSound = useStore(app.ui, (s) => s.bassSound);
  const len = sec.bars * barTicks(sec.meter);
  const custom = !!sec.bass.notes;
  const notes = custom ? sec.bass.notes : tl.generated[sec.id]?.bass ?? [];
  return html`<div class="tab-body">
    <div class="tab-toolbar">
      <${Select}
        title="Bass style"
        value=${custom ? 'custom' : sec.bass.gen.style}
        options=${[...(custom ? [{ value: 'custom', label: 'Custom (edited)' }] : []), ...toOptions(BASS_STYLES)]}
        onChange=${(v) => v !== 'custom' && edit((s) => (s.bass = { gen: { style: v } }))}
      />
      <${Select}
        title="Bass sound"
        value=${bassSound}
        options=${['bass', 'fingerBass'].map((id) => ({ value: id, label: SOUNDS[id].label }))}
        onChange=${(v) => app.actions.setUi({ bassSound: v })}
      />
    </div>
    <p class="muted hint">${custom ? 'Edited by hand. Pick a style to regenerate it from the chords.' : 'Generated from the chords — edit any note to make it your own.'}</p>
    <div class="roll-scroll">
      <${PianoRoll}
        notes=${notes.map((n) => ({ ...n, pitch: n.pitch + song.transpose }))}
        length=${len}
        lo=${28}
        hi=${55}
        snap=${120}
        barTicks=${barTicks(sec.meter)}
        beatTicks=${unitTicks(sec.meter.den)}
        chords=${chordSpans(tl, inst)}
        playhead=${playhead}
        pxPerTick=${0.1}
        onChange=${(next) => edit((s) => (s.bass = { notes: next.map((n) => ({ ...n, pitch: n.pitch - song.transpose })) }))}
        onAudition=${(p) => app.actions.audition([p], bassSound)}
      />
    </div>
  </div>`;
}

// --- drums tab --------------------------------------------------------------------

function DrumsTab({ app, sec, edit }) {
  const { tl, playhead } = useSectionTime(app, sec);
  const len = sec.bars * barTicks(sec.meter);
  const custom = !!sec.drums.steps;
  const hits = custom ? sec.drums.steps : tl.generated[sec.id]?.drums ?? [];
  return html`<div class="tab-body">
    <div class="tab-toolbar">
      <${Select}
        title="Drum style"
        value=${custom ? 'custom' : sec.drums.gen.style}
        options=${[...(custom ? [{ value: 'custom', label: 'Custom (edited)' }] : []), ...toOptions(DRUM_STYLES)]}
        onChange=${(v) => v !== 'custom' && edit((s) => (s.drums = { gen: { style: v } }))}
      />
    </div>
    <p class="muted hint">${custom ? 'Edited by hand. Pick a style to start over.' : 'Generated for this meter — click any cell to make it your own.'}</p>
    <div class="roll-scroll">
      <${DrumGrid}
        hits=${hits}
        length=${len}
        barTicks=${barTicks(sec.meter)}
        groupTicks=${groupStarts(sec.meter)}
        playhead=${playhead}
        onChange=${(next) => edit((s) => (s.drums = { steps: next }))}
        onAudition=${(voice, vel) => app.actions.auditionDrum(voice, vel)}
      />
    </div>
  </div>`;
}
