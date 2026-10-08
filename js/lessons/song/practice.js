// Practice view: what's playing now, and how to play it (guitar, piano & sax lenses).

import { html, useEffect, useRef } from '../../vendor/preact-htm.js';
import { useStore } from '../../song/store.js';
import { chordIndexAt, instanceAt } from '../../song/timeline.js';
import { createFretboard } from '../../ui/fretboard.js';
import { toneLabel, toneKind, noteNameFor } from '../../lib/chords.js';
import { spellScale, pretty, mod12, SHARP_NAMES, KEYS } from '../../lib/theory.js';
import { midiAt } from '../../lib/guitar.js';
import { SAXES, toWritten, noteLabel, fingering, WRITTEN_LOW, ALTERNATES } from '../../lib/sax.js';
import { Seg, Toggle, Select } from '../../ui/preact-controls.js';
import { SaxDiagram } from '../../ui/sax-diagram.js';
import { secColor } from './sketch.js';

/** Melody notes around a tick: the one sounding (or about to) and the next few. */
function melodyAt(tl, tick, ahead = 4) {
  const m = tl.melody;
  const i = m.findIndex((n) => n.tick + n.dur > tick);
  if (i === -1) return { cur: null, next: m.slice(0, ahead) }; // past the end: the song loops back
  const cur = m[i].tick <= tick + 30 ? m[i] : null;
  const from = cur ? i + 1 : i;
  return { cur, next: m.slice(from, from + ahead) };
}

export function Practice({ app }) {
  useStore(app.songs, (s) => s.song);
  const st = useStore(app.ui);
  const tl = app.timeline();
  const ci = useStore(app.now, (s) => chordIndexAt(app.timeline(), s.tick));
  const tick = useStore(app.now, (s) => Math.floor(s.tick / 30) * 30);

  if (!tl.chords.length && !tl.melody.length)
    return html`<section class="panel empty-state">
      <p>Nothing to practice yet. Head to <button class="link" type="button" onClick=${() => app.actions.setUi({ view: 'sketch' })}>Sketch</button> and type a few chords, like <code>Dm9 | G13 | Cmaj9</code>.</p>
    </section>`;

  const idx = Math.max(0, ci);
  const cur = tl.chords[idx] ?? null;
  const next = tl.chords.length ? tl.chords[(idx + 1) % tl.chords.length] : null;
  const inst = instanceAt(tl, tick);
  const mel = melodyAt(tl, tick);
  const hasMelody = tl.melody.length > 0;
  const set = (p) => app.actions.setUi(p);

  return html`<div class="practice">
    <${SectionChips} app=${app} tl=${tl} inst=${inst} />
    ${cur &&
    html`<div class="now-row">
      <${NowNext} cur=${cur} next=${next} />
      <${ChordStrip} app=${app} tl=${tl} inst=${inst} ci=${idx} />
    </div>`}
    <section class="panel lens-bar">
      <div class="lens-toggles">
        <${Toggle} label="Guitar" value=${st.lenses.guitar} onChange=${(v) => set({ lenses: { ...st.lenses, guitar: v } })} />
        <${Toggle} label="Piano" value=${st.lenses.piano} onChange=${(v) => set({ lenses: { ...st.lenses, piano: v } })} />
        <${Toggle} label="Sax" value=${st.lenses.sax} onChange=${(v) => set({ lenses: { ...st.lenses, sax: v } })} />
        <${Toggle} label="Scale overlay" value=${st.scaleOverlay} onChange=${(v) => set({ scaleOverlay: v })} title="Show the chord-scale around your hand" />
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
      </div>
    </section>
    ${st.lenses.guitar && html`<${GuitarLens} app=${app} cur=${cur} next=${next} mel=${mel} hasMelody=${hasMelody} st=${st} inst=${inst} />`}
    ${st.lenses.piano && html`<${PianoLens} app=${app} cur=${cur} next=${next} mel=${mel} st=${st} tl=${tl} />`}
    ${st.lenses.sax && html`<${SaxLens} app=${app} cur=${cur} mel=${mel} hasMelody=${hasMelody} st=${st} />`}
    ${!st.lenses.guitar && !st.lenses.piano && !st.lenses.sax && html`<p class="muted">Turn on a lens above to see how to play along.</p>`}
  </div>`;
}

function SectionChips({ app, tl, inst }) {
  return html`<div class="section-chips" role="group" aria-label="Sections">
    ${tl.instances.map((i) => {
      const reps = tl.instances.filter((x) => x.arrIndex === i.arrIndex).length;
      return html`<button
        type="button"
        class=${`chip sec-chip${inst?.index === i.index ? ' active' : ''}`}
        style=${{ '--sec': secColor(i.section) }}
        onClick=${() => app.actions.seek(i.start)}
        title="Jump here (with “Loop section”, practice just this part)"
      >
        ${i.section.name}${reps > 1 ? html`<small> ${i.rep + 1}/${reps}</small>` : ''}
      </button>`;
    })}
  </div>`;
}

function NowNext({ cur, next }) {
  const tones = cur.chord.tones.map((t) => html`<span class=${`mini-tone ${toneKind(cur.chord, t.pc)}`}>${pretty(t.token === '1' ? 'R' : t.token)}</span>`);
  const chordLink = `#/lesson/chord-explorer?chord=${encodeURIComponent(cur.sym)}`;
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
    ${next &&
    html`<div class="next">
      <span class="field-label">Next</span>
      <span class="next-chord">${pretty(next.sym)}</span>
      <span class="muted">${next.scale.name.replace(/ \(.*\)$/, '')}</span>
    </div>`}
  </section>`;
}

// The scale explorer only offers these key spellings.
function toKey(root) {
  const pcs = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = pcs[root[0]];
  for (const ch of root.slice(1)) pc += ch === '#' ? 1 : -1;
  return KEYS[mod12(pc)];
}

function ChordStrip({ app, tl, inst, ci }) {
  const bars = tl.bars.filter((b) => b.inst === inst.index);
  return html`<section class="panel chord-strip" style=${{ '--sec': secColor(inst.section) }}>
    <span class="field-label">${inst.section.name} · ${bars.length} bars</span>
    <div class="strip-bars">
      ${bars.map((b, bi) => {
        const inBar = tl.chords.map((c, i) => ({ c, i })).filter(({ c }) => c.tick >= b.tick && c.tick < b.tick + b.length);
        const holdIdx = chordIndexAt(tl, b.tick);
        return html`<div class="strip-bar">
          <span class="bar-num">${bi + 1}</span>
          ${inBar.map(({ c, i }) => html`<button type="button" class=${`strip-chord${i === ci ? ' current' : ''}`} onClick=${() => app.actions.seek(c.tick)}>${pretty(c.sym)}</button>`)}
          ${!inBar.length && holdIdx >= 0 && html`<span class=${`strip-hold${holdIdx === ci ? ' current' : ''}`}>%</span>`}
        </div>`;
      })}
    </div>
  </section>`;
}

// --- lenses ----------------------------------------------------------------------

function label(st, chord, pc) {
  if (!chord) return SHARP_NAMES[pc];
  return st.labels === 'notes' ? pretty(noteNameFor(chord, pc)) : pretty(toneLabel(chord, pc));
}

const LensLegend = ({ melody }) => html`<div class="legend">
  <span class="legend-item"><span class="legend-dot root"></span>Root</span>
  <span class="legend-item"><span class="legend-dot guide"></span>3rd / 7th</span>
  <span class="legend-item"><span class="legend-dot color"></span>Extensions</span>
  ${melody && html`<span class="legend-item"><span class="legend-dot melody"></span>Melody note</span>`}
  <span class="legend-item"><span class="legend-dot common"></span>Stays for the next chord</span>
  <span class="legend-item"><span class="legend-dot ghost"></span>Coming next</span>
  <span class="legend-item"><span class="legend-dot faint"></span>Chord-scale</span>
</div>`;

const FRETS = 17;

function GuitarLens({ app, cur, next, mel, hasMelody, st, inst }) {
  const host = useRef(null);
  const fb = useRef(null);
  const mode = hasMelody ? st.guitarMode : 'chords';
  useEffect(() => {
    fb.current = createFretboard({ frets: FRETS, onNoteClick: (s, f) => app.actions.audition([midiAt(s, f)], 'jazzGuitar') });
    host.current.append(fb.current.el);
    return () => fb.current.el.remove();
  }, []);

  useEffect(() => {
    const notes = new Map();
    const v = cur?.guitar;
    const showChords = mode !== 'melody' && v;
    const showMelody = mode !== 'chords';
    const melAnchor = (mel.cur?.gtr || mel.next[0]?.gtr)?.pos;
    if (st.scaleOverlay && cur && (showChords || showMelody)) {
      const scale = spellScale(toKey(cur.scale.root), cur.scale.scale);
      const anchor = showMelody && melAnchor ? melAnchor : v?.minFret || 1;
      const lo = Math.max(0, anchor - 2);
      const hi = Math.min(FRETS, showMelody && melAnchor ? anchor + 5 : Math.max(v?.maxFret ?? 0, anchor + 3) + 2);
      for (let s = 0; s < 6; s++)
        for (let f = lo; f <= hi; f++) {
          const n = scale.get(mod12(midiAt(s, f)));
          if (n) notes.set(`${s}:${f}`, { label: pretty(n.degree), classes: ['faint'] });
        }
    }
    if (showChords) {
      if (next?.guitar && next !== cur && !showMelody) for (const n of next.guitar.notes) notes.set(`${n.s}:${n.f}`, { label: label(st, next.chord, n.pc), classes: ['ghost'] });
      for (const n of v.notes) {
        const stays = !showMelody && next?.guitar && next !== cur && next.guitar.frets[n.s] === n.f;
        notes.set(`${n.s}:${n.f}`, { label: label(st, cur.chord, n.pc), classes: [toneKind(cur.chord, n.pc), stays && 'common', showMelody && 'quiet'].filter(Boolean) });
      }
    }
    if (showMelody) {
      mel.next.forEach((n, i) => {
        if (n.gtr) notes.set(`${n.gtr.s}:${n.gtr.f}`, { label: String(i + 1), classes: ['ghost', 'upcoming'] });
      });
      if (mel.cur?.gtr) notes.set(`${mel.cur.gtr.s}:${mel.cur.gtr.f}`, { label: label(st, cur?.chord, mod12(mel.cur.pitch)), classes: ['melody'] });
    }
    fb.current.update({ notes });
  }, [cur, next, mel.cur, mel.next[0], st.labels, st.scaleOverlay, mode]);

  const pos = (mel.cur || mel.next[0])?.gtr?.pos;
  return html`<section class="panel lens">
    <div class="lens-head">
      <h3>Guitar</h3>
      <span class="muted">
        ${mode !== 'chords' && pos ? `Melody in position ${pos}${inst?.section.gtrPos ? ' (locked)' : ''} · ` : ''}
        ${cur?.guitar && mode !== 'melody' ? `${cur.guitar.tags.join(' · ')} · ${cur.guitar.frets.map((f) => (f < 0 ? 'x' : f)).join('-')}` : ''}
      </span>
      <div class="lens-head-ctl">
        ${hasMelody &&
        html`<${Seg}
          value=${mode}
          options=${[
            { value: 'chords', label: 'Chords' },
            { value: 'melody', label: 'Melody' },
            { value: 'both', label: 'Both' },
          ]}
          onChange=${(v) => app.actions.setUi({ guitarMode: v })}
        />`}
        <${Seg}
          value=${st.region}
          options=${[
            { value: 'auto', label: 'Auto', title: 'Chord voicings anywhere on the neck, voice-led' },
            { value: 'low', label: 'Low' },
            { value: 'mid', label: 'Mid' },
            { value: 'high', label: 'High' },
          ]}
          onChange=${(v) => app.actions.setUi({ region: v })}
        />
      </div>
    </div>
    <div class="board-scroll" ref=${host}></div>
    <${LensLegend} melody=${hasMelody} />
  </section>`;
}

// --- piano -------------------------------------------------------------------------

const LOW = 36; // C2
const HIGH = 84; // C6
const KW = 22;
const isBlack = (m) => [1, 3, 6, 8, 10].includes(mod12(m));
const LAYOUT = (() => {
  const whites = [];
  for (let m = LOW; m <= HIGH; m++) if (!isBlack(m)) whites.push(m);
  const x = new Map(whites.map((m, i) => [m, i * KW]));
  for (let m = LOW; m <= HIGH; m++) if (isBlack(m)) x.set(m, x.get(m - 1) + KW * 0.68);
  return { whites, x, width: whites.length * KW };
})();
const fit = (m) => {
  while (m < LOW) m += 12;
  while (m > HIGH) m -= 12;
  return m;
};

function PianoLens({ app, cur, next, mel, st, tl }) {
  const held = useStore(app.now, (s) => s.held.join(','));
  const heldSet = new Set(held ? held.split(',').map(Number) : []);
  const playing = new Map();
  if (cur) {
    for (const m of cur.piano.lh) playing.set(fit(m), 'lh');
    for (const m of cur.piano.rh) playing.set(fit(m), 'rh');
  }
  const melodyKey = mel.cur ? fit(mel.cur.pitch) : null;
  const ghost = new Set(next && next !== cur ? [...next.piano.lh, ...next.piano.rh].map(fit) : []);
  const scalePcs = st.scaleOverlay && cur ? new Set(spellScale(toKey(cur.scale.root), cur.scale.scale).keys()) : new Set();

  const key = (m) => {
    const black = isBlack(m);
    const on = playing.get(m);
    const kind = on ? toneKind(cur.chord, mod12(m)) : '';
    const x = LAYOUT.x.get(m);
    const w = black ? KW * 0.64 : KW;
    const h = black ? 72 : 118;
    const cx = x + w / 2;
    const cls = ['pkey', black ? 'black' : 'white', on && `on ${kind}`, m === melodyKey && 'melody', heldSet.has(m) && 'held'].filter(Boolean).join(' ');
    return html`<g class=${cls} onClick=${() => app.actions.audition([m], 'piano')}>
      <rect x=${x + 0.5} y="0" width=${w - 1} height=${h} rx="3" />
      ${!on && m !== melodyKey && scalePcs.has(mod12(m)) && m >= 48 && html`<circle class="pscale" cx=${cx} cy=${h - 12} r="3" />`}
      ${ghost.has(m) && !on && html`<circle class="pghost" cx=${cx} cy=${h - 26} r="6" />`}
      ${(on || m === melodyKey) && html`<text x=${cx} y=${h - 10} class="plabel">${label(st, cur?.chord, mod12(m))}</text>`}
      ${!black && mod12(m) === 0 && html`<text x=${cx} y=${h + 14} class="poct">C${m / 12 - 1}</text>`}
    </g>`;
  };
  const lhNames = cur ? cur.piano.lh.map((m) => SHARP_NAMES[mod12(m)]).join(' ') : '';
  const falling = st.pianoMode === 'falling';
  return html`<section class="panel lens">
    <div class="lens-head">
      <h3>Piano</h3>
      <span class="muted">${cur ? (st.rootless ? 'Rootless left hand' : `LH ${lhNames} · RH ${cur.piano.rh.length} notes`) : ''}</span>
      <div class="lens-head-ctl">
        <${Seg}
          value=${st.pianoMode}
          options=${[
            { value: 'keys', label: 'Keys' },
            { value: 'falling', label: 'Falling notes', title: 'Synthesia-style: notes fall onto the keys' },
          ]}
          onChange=${(v) => app.actions.setUi({ pianoMode: v })}
        />
        <${Toggle} label="Rootless" value=${st.rootless} onChange=${(v) => app.actions.setUi({ rootless: v })} title="Jazz left-hand voicings without the root" />
      </div>
    </div>
    ${falling &&
    html`<div class="falling-opts">
      ${[
        ['melody', 'Melody'],
        ['chords', 'Chords'],
        ['bass', 'Bass'],
      ].map(([k, l]) => html`<${Toggle} label=${l} value=${st.falling[k]} onChange=${(v) => app.actions.setUi({ falling: { ...st.falling, [k]: v } })} />`)}
    </div>`}
    <div class="board-scroll">
      <div class="piano-wrap" style=${{ minWidth: `${LAYOUT.whites.length * 15}px` }}>
        ${falling && html`<${FallingNotes} app=${app} tl=${tl} st=${st} />`}
        <svg class="piano" viewBox=${`0 0 ${LAYOUT.width} 136`}>
          ${LAYOUT.whites.map(key)}
          ${[...LAYOUT.x.keys()].filter(isBlack).map(key)}
        </svg>
      </div>
    </div>
  </section>`;
}

/** Canvas of notes falling onto the keyboard; redrawn every animation frame while shown. */
function FallingNotes({ app, tl, st }) {
  const ref = useRef(null);
  const live = useRef({ tl, st });
  live.current = { tl, st };
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = ref.current;
      if (!canvas) return;
      const { tl, st } = live.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const pos = app.player.position();
      const t = pos && !pos.countIn ? pos.tick : app.now.get().tick;
      const bar = tl.bars.find((b) => t >= b.tick && t < b.tick + b.length) ?? tl.bars[0];
      const span = (bar ? bar.length : 1920) * 2; // two bars of look-ahead
      const sx = w / LAYOUT.width;
      const css = getComputedStyle(canvas);
      const colors = { melody: css.getPropertyValue('--accent'), chords: css.getPropertyValue('--chord'), bass: css.getPropertyValue('--muted') };

      ctx.strokeStyle = css.getPropertyValue('--border');
      ctx.lineWidth = 1;
      for (const b of tl.bars) {
        if (b.tick < t || b.tick > t + span) continue;
        const y = h - ((b.tick - t) / span) * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      const drawNote = (pitch, start, dur, color, alpha) => {
        if (start > t + span || start + dur < t) return;
        const m = fit(pitch);
        const kw = (isBlack(m) ? KW * 0.64 : KW) * sx;
        const x = LAYOUT.x.get(m) * sx;
        const y1 = Math.min(h + 4, h - ((start - t) / span) * h);
        const y0 = Math.max(-4, h - ((start + dur - t) / span) * h);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        roundRect(ctx, x + 1.5, y0, kw - 3, y1 - y0, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
      };
      if (st.falling.bass) for (const n of tl.bassLine) drawNote(n.pitch, n.tick, n.dur, colors.bass, 0.55);
      if (st.falling.chords) for (const c of tl.chords) for (const p of [...c.piano.lh, ...c.piano.rh]) drawNote(p, c.tick, c.end - c.tick - 20, colors.chords, 0.45);
      if (st.falling.melody) for (const n of tl.melody) drawNote(n.pitch, n.tick, n.dur, colors.melody, 0.95);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return html`<canvas class="falling" ref=${ref}></canvas>`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (h <= 0) return;
  r = Math.min(r, h / 2, w / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// --- sax ---------------------------------------------------------------------------

function SaxLens({ app, cur, mel, hasMelody, st }) {
  const sax = st.sax;
  const saxOptions = Object.entries(SAXES).map(([value, s]) => ({ value, label: s.label }));
  const head = html`<div class="lens-head">
    <h3>Sax</h3>
    <span class="muted">Written pitch for ${SAXES[sax].short.toLowerCase()} (sounds ${SAXES[sax].semis} semitones lower)</span>
    <div class="lens-head-ctl">
      <${Select} title="Saxophone" value=${sax} options=${saxOptions} onChange=${(v) => app.actions.setUi({ sax: v })} />
    </div>
  </div>`;

  if (hasMelody) {
    const note = mel.cur || mel.next[0];
    if (!note) return html`<section class="panel lens">${head}<p class="muted">The melody has ended.</p></section>`;
    const written = toWritten(note.pitch, sax);
    const keys = fingering(written);
    const alts = ALTERNATES[written];
    const upcoming = mel.cur ? mel.next : mel.next.slice(1);
    return html`<section class="panel lens sax-lens">
      ${head}
      <div class="sax-main">
        <div class="sax-now">
          <span class="field-label">${mel.cur ? 'Now' : 'Next'}</span>
          <span class="sax-note">${pretty(noteLabel(written))}</span>
          <span class="muted">concert ${pretty(noteLabel(note.pitch))}</span>
          ${!keys && html`<span class="sax-warn">${written < WRITTEN_LOW ? 'Below the sax’s range' : 'Altissimo: above the normal range'}</span>`}
          ${alts && html`<span class="muted small">Also try: ${alts.map((a) => a.name).join(', ')}</span>`}
        </div>
        ${keys && html`<${SaxDiagram} keys=${keys} label=${noteLabel(written)} />`}
        <div class="sax-upcoming">
          <span class="field-label">Coming up</span>
          <div class="sax-next-row">
            ${upcoming.map((n) => {
              const w = toWritten(n.pitch, sax);
              return html`<div class="sax-next">
                <span>${pretty(noteLabel(w))}</span>
                ${fingering(w) ? html`<${SaxDiagram} keys=${fingering(w)} small=${true} />` : html`<span class="muted small">out of range</span>`}
              </div>`;
            })}
          </div>
        </div>
      </div>
    </section>`;
  }

  // No melody: show the chord tones (written) to practise arpeggios.
  if (!cur) return null;
  const tones = cur.chord.tones.map((t) => {
    let w = toWritten(60 + t.pc, sax);
    while (w < 64) w += 12;
    while (w > 76) w -= 12;
    return { t, w };
  });
  return html`<section class="panel lens sax-lens">
    ${head}
    <p class="muted">No melody in this song yet. Here are the chord tones of <strong>${pretty(cur.sym)}</strong> as written notes; arpeggiate them!</p>
    <div class="sax-next-row">
      ${tones.map(
        ({ t, w }) => html`<div class="sax-next">
          <span><b>${pretty(noteLabel(w))}</b> <small class="muted">${pretty(t.token === '1' ? 'R' : t.token)}</small></span>
          ${fingering(w) && html`<${SaxDiagram} keys=${fingering(w)} small=${true} />`}
        </div>`,
      )}
    </div>
  </section>`;
}
