// Practice view: what's playing now, and how to play it (guitar & piano lenses).

import { html, useEffect, useRef } from '../../vendor/preact-htm.js';
import { useStore } from '../../song/store.js';
import { chordIndexAt, instanceAt } from '../../song/timeline.js';
import { createFretboard } from '../../ui/fretboard.js';
import { toneLabel, toneKind, noteNameFor } from '../../lib/chords.js';
import { spellScale, pretty, mod12, SHARP_NAMES } from '../../lib/theory.js';
import { midiAt } from '../../lib/guitar.js';
import { Seg, Toggle } from '../../ui/preact-controls.js';

export function Practice({ app }) {
  useStore(app.songs, (s) => s.song);
  const st = useStore(app.ui);
  const tl = app.timeline();
  const ci = useStore(app.now, (s) => chordIndexAt(app.timeline(), s.tick));
  const tick = useStore(app.now, (s) => Math.floor(s.tick / 120) * 120);

  if (!tl.chords.length)
    return html`<section class="panel empty-state">
      <p>No chords yet. Head to <button class="link" type="button" onClick=${() => app.actions.setUi({ view: 'sketch' })}>Sketch</button> and type a few, like <code>Dm9 | G13 | Cmaj9</code>.</p>
    </section>`;

  const idx = Math.max(0, ci);
  const cur = tl.chords[idx];
  const next = tl.chords[(idx + 1) % tl.chords.length];
  const inst = instanceAt(tl, tick);
  const set = (p) => app.actions.setUi(p);

  return html`<div class="practice">
    <${SectionChips} app=${app} tl=${tl} inst=${inst} />
    <div class="now-row">
      <${NowNext} cur=${cur} next=${next} tl=${tl} />
      <${ChordStrip} app=${app} tl=${tl} inst=${inst} ci=${idx} />
    </div>
    <section class="panel lens-bar">
      <div class="lens-toggles">
        <${Toggle} label="Guitar" value=${st.lenses.guitar} onChange=${(v) => set({ lenses: { ...st.lenses, guitar: v } })} />
        <${Toggle} label="Piano" value=${st.lenses.piano} onChange=${(v) => set({ lenses: { ...st.lenses, piano: v } })} />
        <${Toggle} label="Scale overlay" value=${st.scaleOverlay} onChange=${(v) => set({ scaleOverlay: v })} title="Show the chord-scale around the voicing" />
      </div>
      <div class="lens-options">
        <${Seg}
          value=${st.labels}
          options=${[
            { value: 'intervals', label: 'Intervals' },
            { value: 'notes', label: 'Notes' },
          ]}
          onChange=${(v) => set({ labels: v })}
        />
        <${Seg}
          label=""
          value=${st.region}
          options=${[
            { value: 'auto', label: 'Auto', title: 'Guitar voicings: anywhere, voice-led' },
            { value: 'low', label: 'Low' },
            { value: 'mid', label: 'Mid' },
            { value: 'high', label: 'High' },
          ]}
          onChange=${(v) => set({ region: v })}
        />
        <${Toggle} label="Rootless piano" value=${st.rootless} onChange=${(v) => set({ rootless: v })} title="Jazz left-hand voicings without the root" />
      </div>
    </section>
    ${st.lenses.guitar && html`<${GuitarLens} app=${app} cur=${cur} next=${next} st=${st} />`}
    ${st.lenses.piano && html`<${PianoLens} app=${app} cur=${cur} next=${next} st=${st} />`}
    ${!st.lenses.guitar && !st.lenses.piano && html`<p class="muted">Turn on a lens above to see how to play along.</p>`}
  </div>`;
}

function SectionChips({ app, tl, inst }) {
  return html`<div class="section-chips" role="group" aria-label="Sections">
    ${tl.instances.map((i) => {
      const reps = tl.instances.filter((x) => x.arrIndex === i.arrIndex).length;
      return html`<button
        type="button"
        class=${`chip${inst?.index === i.index ? ' active' : ''}`}
        onClick=${() => app.actions.seek(i.start)}
        title="Jump here (with “Loop section”, practice just this part)"
      >
        ${i.section.name}${reps > 1 ? html`<small> ${i.rep + 1}/${reps}</small>` : ''}
      </button>`;
    })}
  </div>`;
}

function NowNext({ cur, next, tl }) {
  const tones = cur.chord.tones.map((t) => html`<span class=${`mini-tone ${toneKind(cur.chord, t.pc)}`}>${pretty(t.token === '1' ? 'R' : t.token)}</span>`);
  const chordLink = `#/lesson/chord-explorer?tab=chord&chord=${encodeURIComponent(cur.sym)}`;
  const scaleLink = `#/lesson/caged-scales?key=${encodeURIComponent(toKey(cur.scale.root))}&scale=${cur.scale.scale}&chord=7`;
  return html`<section class="panel now-next">
    <div class="now">
      <span class="field-label">Now</span>
      <h2 class="now-chord">${pretty(cur.sym)}</h2>
      <div class="mini-tones">${tones}</div>
      <p class="now-scale">
        <span class="scale-name">${cur.scale.name}</span>
        <span class="muted"> · ${cur.scale.why}</span>
      </p>
      <p class="now-links">
        <a href=${chordLink} target="_blank" rel="noopener">All voicings ↗</a>
        <a href=${scaleLink} target="_blank" rel="noopener">Scale on the neck ↗</a>
      </p>
    </div>
    <div class="next">
      <span class="field-label">Next</span>
      <span class="next-chord">${pretty(next.sym)}</span>
      <span class="muted">${next.scale.name.replace(/ \(.*\)$/, '')}</span>
    </div>
  </section>`;
}

// The scale explorer only offers these key spellings.
function toKey(root) {
  const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const pcs = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = pcs[root[0]];
  for (const ch of root.slice(1)) pc += ch === '#' ? 1 : -1;
  return KEYS[mod12(pc)];
}

function ChordStrip({ app, tl, inst, ci }) {
  const bars = tl.bars.filter((b) => b.inst === inst.index);
  return html`<section class="panel chord-strip">
    <span class="field-label">${inst.section.name} · ${bars.length} bars</span>
    <div class="strip-bars">
      ${bars.map((b, bi) => {
        const inBar = tl.chords.map((c, i) => ({ c, i })).filter(({ c }) => c.tick >= b.tick && c.tick < b.tick + b.length);
        const holding = !inBar.length ? tl.chords[chordIndexAt(tl, b.tick)] : null;
        return html`<div class="strip-bar">
          <span class="bar-num">${bi + 1}</span>
          ${inBar.map(
            ({ c, i }) => html`<button type="button" class=${`strip-chord${i === ci ? ' current' : ''}`} onClick=${() => app.actions.seek(c.tick)}>
              ${pretty(c.sym)}
            </button>`,
          )}
          ${holding && html`<span class=${`strip-hold${chordIndexAt(tl, b.tick) === ci ? ' current' : ''}`}>%</span>`}
        </div>`;
      })}
    </div>
  </section>`;
}

// --- lenses --------------------------------------------------------------------

function label(st, chord, pc) {
  return st.labels === 'notes' ? pretty(noteNameFor(chord, pc)) : pretty(toneLabel(chord, pc));
}

function GuitarLens({ app, cur, next, st }) {
  const host = useRef(null);
  const fb = useRef(null);
  useEffect(() => {
    fb.current = createFretboard({ frets: 15, onNoteClick: (s, f) => app.actions.audition([midiAt(s, f)], 'jazzGuitar') });
    host.current.append(fb.current.el);
    return () => fb.current.el.remove();
  }, []);

  useEffect(() => {
    const notes = new Map();
    const v = cur.guitar;
    if (st.scaleOverlay && v) {
      const scale = spellScale(toKey(cur.scale.root), cur.scale.scale);
      const lo = Math.max(0, (v.minFret || 1) - 2);
      const hi = Math.min(15, Math.max(v.maxFret, 3) + 2);
      for (let s = 0; s < 6; s++)
        for (let f = lo; f <= hi; f++) {
          const n = scale.get(mod12(midiAt(s, f)));
          if (n) notes.set(`${s}:${f}`, { label: pretty(n.degree), classes: ['faint'] });
        }
    }
    if (next?.guitar && next !== cur) for (const n of next.guitar.notes) notes.set(`${n.s}:${n.f}`, { label: label(st, next.chord, n.pc), classes: ['ghost'] });
    if (v)
      for (const n of v.notes) {
        const stays = next?.guitar && next !== cur && next.guitar.frets[n.s] === n.f;
        notes.set(`${n.s}:${n.f}`, { label: label(st, cur.chord, n.pc), classes: [toneKind(cur.chord, n.pc), stays && 'common'].filter(Boolean) });
      }
    fb.current.update({ notes });
  }, [cur, next, st.labels, st.scaleOverlay]);

  return html`<section class="panel lens">
    <div class="lens-head">
      <h3>Guitar</h3>
      <span class="muted">${cur.guitar ? `${cur.guitar.tags.join(' · ')} · ${cur.guitar.frets.map((f) => (f < 0 ? 'x' : f)).join('-')}` : 'No playable voicing'}</span>
    </div>
    <div class="board-scroll" ref=${host}></div>
    <${LensLegend} />
  </section>`;
}

const LensLegend = () => html`<div class="legend">
  <span class="legend-item"><span class="legend-dot root"></span>Root</span>
  <span class="legend-item"><span class="legend-dot guide"></span>3rd / 7th</span>
  <span class="legend-item"><span class="legend-dot color"></span>Extensions</span>
  <span class="legend-item"><span class="legend-dot common"></span>Stays for the next chord</span>
  <span class="legend-item"><span class="legend-dot ghost"></span>Next chord</span>
  <span class="legend-item"><span class="legend-dot faint"></span>Chord-scale</span>
</div>`;

// Piano keyboard, C2–C6.
const LOW = 36;
const HIGH = 84;
const isBlack = (m) => [1, 3, 6, 8, 10].includes(mod12(m));

function PianoLens({ app, cur, next, st }) {
  const W = 22;
  const whites = [];
  for (let m = LOW; m <= HIGH; m++) if (!isBlack(m)) whites.push(m);
  const xOf = new Map();
  whites.forEach((m, i) => xOf.set(m, i * W));
  for (let m = LOW; m <= HIGH; m++) if (isBlack(m)) xOf.set(m, xOf.get(m - 1) + W * 0.68);

  const fit = (m) => {
    while (m < LOW) m += 12;
    while (m > HIGH) m -= 12;
    return m;
  };
  const playing = new Map();
  for (const m of cur.piano.lh) playing.set(fit(m), 'lh');
  for (const m of cur.piano.rh) playing.set(fit(m), 'rh');
  const ghost = new Set(next && next !== cur ? [...next.piano.lh, ...next.piano.rh].map(fit) : []);
  const scalePcs = st.scaleOverlay ? new Set(spellScale(toKey(cur.scale.root), cur.scale.scale).keys()) : new Set();

  const key = (m) => {
    const black = isBlack(m);
    const on = playing.get(m);
    const kind = on ? toneKind(cur.chord, mod12(m)) : '';
    const x = xOf.get(m);
    const w = black ? W * 0.64 : W;
    const h = black ? 72 : 118;
    const cx = x + w / 2;
    return html`<g class=${`pkey ${black ? 'black' : 'white'}${on ? ` on ${kind}` : ''}`} onClick=${() => app.actions.audition([m], 'piano')}>
      <rect x=${x + 0.5} y="0" width=${w - 1} height=${h} rx="3" />
      ${!on && scalePcs.has(mod12(m)) && m >= 48 && html`<circle class="pscale" cx=${cx} cy=${h - 12} r="3" />`}
      ${ghost.has(m) && !on && html`<circle class="pghost" cx=${cx} cy=${h - 26} r="6" />`}
      ${on && html`<text x=${cx} y=${h - 10} class="plabel">${label(st, cur.chord, mod12(m))}</text>`}
      ${!black && mod12(m) === 0 && html`<text x=${cx} y=${h + 14} class="poct">C${m / 12 - 1}</text>`}
    </g>`;
  };
  const width = whites.length * W;
  const lhNames = cur.piano.lh.map((m) => SHARP_NAMES[mod12(m)]).join(' ');
  return html`<section class="panel lens">
    <div class="lens-head">
      <h3>Piano</h3>
      <span class="muted">${st.rootless ? 'Rootless left hand' : `LH ${lhNames} · RH ${cur.piano.rh.length} notes`}</span>
    </div>
    <div class="board-scroll">
      <svg class="piano" viewBox=${`0 0 ${width} 136`} style=${{ minWidth: `${whites.length * 15}px` }}>
        ${whites.map(key)}
        ${[...xOf.keys()].filter(isBlack).map(key)}
      </svg>
    </div>
  </section>`;
}
