// The song document: creation, validation/migration and time math.
// Time is in ticks: PPQ ticks per quarter note. See docs/design.md.

export const PPQ = 480;
export const VERSION = 1;

// --- meters ----------------------------------------------------------------

/** Ticks in one beat unit of the meter's denominator (quarter = 480, eighth = 240). */
export const unitTicks = (den) => (PPQ * 4) / den;
export const barTicks = (m) => m.num * unitTicks(m.den);

/** Sensible default grouping: 4/4 → 1+1+1+1, 6/8 → 3+3, 7/8 → 2+2+3, 5/8 → 2+3. */
export function defaultGroups(num, den) {
  if (den <= 4) return Array(num).fill(1);
  if (num % 3 === 0 && num > 3) return Array(num / 3).fill(3);
  if (num <= 3) return [num];
  const g = Array(Math.floor(num / 2)).fill(2);
  if (num % 2) g[g.length - 1] = 3;
  return g;
}

export function makeMeter(num = 4, den = 4, groups) {
  num = clampInt(num, 1, 32, 4);
  den = [2, 4, 8, 16].includes(+den) ? +den : 4;
  const g = Array.isArray(groups) && groups.reduce((a, b) => a + b, 0) === num ? groups : defaultGroups(num, den);
  return { num, den, groups: g };
}

/** '2+2+3' → [2,2,3] if it sums to num, else null. */
export function parseGroups(text, num) {
  const g = String(text)
    .split(/[+\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (!g.length || g.some((x) => !Number.isInteger(x) || x < 1)) return null;
  return g.reduce((a, b) => a + b, 0) === num ? g : null;
}

/** Tick offsets (within a bar) where each group starts. */
export function groupStarts(m) {
  const u = unitTicks(m.den);
  const out = [];
  let t = 0;
  for (const g of m.groups) {
    out.push(t);
    t += g * u;
  }
  return out;
}

export function meterLabel(m) {
  const simple = m.groups.every((g) => g === m.groups[0]) && (m.den <= 4 ? m.groups[0] === 1 : true);
  return `${m.num}/${m.den}` + (simple ? '' : ` (${m.groups.join('+')})`);
}

// --- documents --------------------------------------------------------------

/** Section colors (index stored in the song); used as --sec in the UI. */
export const SECTION_COLORS = ['#e8590c', '#2f6fd6', '#8b5cf6', '#12a594', '#d6409f', '#d9a40b', '#3e9b4f', '#6e56cf'];
const mod = (n, m) => ((n % m) + m) % m;

export const uid = () => Math.random().toString(36).slice(2, 8);

export function createSection(partial = {}) {
  return {
    id: partial.id || uid(),
    name: partial.name ?? 'A',
    bars: clampInt(partial.bars, 1, 64, 4),
    meter: makeMeter(partial.meter?.num, partial.meter?.den, partial.meter?.groups),
    color: Number.isInteger(partial.color) ? mod(partial.color, SECTION_COLORS.length) : null,
    chords: (partial.chords || [])
      .filter((c) => c && typeof c.sym === 'string')
      .map((c) => ({ at: Math.max(0, c.at | 0), sym: c.sym, ...(typeof c.gtr === 'string' ? { gtr: c.gtr } : {}) })),
    gtrPos: Number.isInteger(partial.gtrPos) ? Math.min(15, Math.max(1, partial.gtrPos)) : null, // melody position lock
    melody: (partial.melody || []).map((n) => ({ at: n.at | 0, dur: Math.max(1, n.dur | 0), pitch: n.pitch | 0, vel: n.vel ?? 90 })),
    bass: partial.bass?.notes ? { notes: partial.bass.notes } : { gen: { style: partial.bass?.gen?.style ?? 'root5' } },
    drums: partial.drums?.steps ? { steps: partial.drums.steps } : { gen: { style: partial.drums?.gen?.style ?? 'rock' } },
  };
}

export function createSong(partial = {}) {
  const sections = (partial.sections?.length ? partial.sections : [{ name: 'A' }]).map(createSection);
  // Give every section a color, avoiding ones already in use.
  const used = new Set(sections.map((s) => s.color).filter((c) => c != null));
  for (const s of sections) {
    if (s.color != null) continue;
    s.color = [...SECTION_COLORS.keys()].find((c) => !used.has(c)) ?? sections.indexOf(s) % SECTION_COLORS.length;
    used.add(s.color);
  }
  const ids = new Set(sections.map((s) => s.id));
  let arrangement = (partial.arrangement || [])
    .filter((a) => ids.has(a.section))
    .map((a) => ({ section: a.section, repeat: clampInt(a.repeat, 1, 16, 1) }));
  if (!arrangement.length) arrangement = sections.map((s) => ({ section: s.id, repeat: 1 }));
  return {
    v: VERSION,
    title: partial.title || 'Untitled sketch',
    tempo: clampInt(partial.tempo, 30, 300, 100),
    swing: Math.min(0.5, Math.max(0, +partial.swing || 0)),
    key: partial.key || 'C',
    scale: partial.scale || 'major',
    transpose: clampInt(partial.transpose, -11, 11, 0),
    sections,
    arrangement,
  };
}

/** Accepts anything JSON-ish (file, link, old version) and returns a valid song. */
export function normalizeSong(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a song');
  // Future migrations go here: if (raw.v === 1) raw = migrate1to2(raw) …
  return createSong(raw);
}

export const sectionTicks = (sec) => sec.bars * barTicks(sec.meter);

// --- arrangement & timeline ---------------------------------------------------

/** The arrangement unrolled into absolute section instances. */
export function flatten(song) {
  const byId = new Map(song.sections.map((s) => [s.id, s]));
  const out = [];
  let t = 0;
  song.arrangement.forEach((a, arrIndex) => {
    const sec = byId.get(a.section);
    if (!sec) return;
    for (let rep = 0; rep < a.repeat; rep++) {
      const len = sectionTicks(sec);
      out.push({ section: sec, arrIndex, rep, start: t, length: len, index: out.length });
      t += len;
    }
  });
  return out;
}

export const songLength = (song) => flatten(song).reduce((a, i) => a + i.length, 0);

/** Chord slots in a section: one per meter group per bar. */
export function chordSlots(sec) {
  const bt = barTicks(sec.meter);
  const starts = groupStarts(sec.meter);
  const slots = [];
  for (let b = 0; b < sec.bars; b++) for (const g of starts) slots.push({ bar: b, at: b * bt + g });
  return slots;
}

export function chordAtSlot(sec, at) {
  return sec.chords.find((c) => c.at === at)?.sym ?? '';
}

/** Set/clear the chord at a slot; returns a new chords array, sorted. Keeps a voicing lock if the chord is unchanged. */
export function withChord(chords, at, sym) {
  const old = chords.find((c) => c.at === at);
  const rest = chords.filter((c) => c.at !== at);
  const s = sym.trim();
  if (s) rest.push(old?.sym === s && old.gtr ? { at, sym: s, gtr: old.gtr } : { at, sym: s });
  return rest.sort((a, b) => a.at - b.at);
}

/**
 * Quick chord entry: "Dm9 G13 | Cmaj9 % | F/G" → chords for a section.
 * Bars are separated by '|'. Chords in a bar spread over its group slots.
 * '%' repeats the previous bar, '.' or '-' holds. Returns { chords, bars }.
 */
export function parseChordText(text, meter) {
  const bt = barTicks(meter);
  const starts = groupStarts(meter);
  const bars = String(text)
    .split('|')
    .map((b) => b.trim())
    .filter((b, i, arr) => b || (i > 0 && i < arr.length - 1));
  const chords = [];
  let prevBar = [];
  bars.forEach((bar, bi) => {
    let tokens = bar.split(/\s+/).filter(Boolean);
    if (tokens.length === 1 && tokens[0] === '%') tokens = prevBar;
    prevBar = tokens;
    const n = tokens.length;
    tokens.forEach((tok, i) => {
      if (tok === '.' || tok === '-' || tok === '%') return;
      const slot = n >= starts.length ? Math.min(i, starts.length - 1) : Math.round((i * starts.length) / n);
      chords.push({ at: bi * bt + starts[slot], sym: tok });
    });
  });
  // Later chords at the same slot win.
  const dedup = new Map(chords.map((c) => [c.at, c]));
  return { chords: [...dedup.values()].sort((a, b) => a.at - b.at), bars: Math.max(1, bars.length) };
}

/** Inverse of parseChordText, for showing a section as text. */
export function chordText(sec) {
  const bt = barTicks(sec.meter);
  const out = [];
  for (let b = 0; b < sec.bars; b++) {
    const inBar = sec.chords.filter((c) => c.at >= b * bt && c.at < (b + 1) * bt).map((c) => c.sym);
    out.push(inBar.length ? inBar.join(' ') : '.');
  }
  return out.join(' | ');
}

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(+v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}
