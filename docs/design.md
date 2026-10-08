# Design: Song-centered learning suite

> Status: **Phase 1 built** (2026-10-08). Phases 2–4 below are still plans.

## Goal

A place to **quickly sketch music and immediately see how to play it** on your instrument, then practice along. It is explicitly *not* a DAW: no mixing, effects or polish. Every feature should answer "how do I play this?" or "help me practice this".

The existing tools (CAGED Scale Explorer, Chord Explorer) stay, both standalone and as panels inside a song.

## Decisions so far

| Topic | Decision |
| --- | --- |
| Structure | **Song as hub.** Tools open as panels preloaded with the current chord, key or scale, and still exist standalone. |
| Devices | Desktop/laptop and **tablet on a music stand** (landscape, touch). Phone is not a target for the practice view. |
| Meter | Full flexibility from the start: 3/4, 6/8, 12/8, **odd meters** (5/4, 7/8 with groupings like 2+2+3), **per-section meter**, swing amount. |
| Instruments | Guitar, piano (Synthesia-style), sax (all four types as a transposition option; **alto fingerings first**). |
| Melody input | Piano roll (mouse/touch), computer keyboard as a piano, MIDI keyboard (Web MIDI, Chrome/Edge). |
| Backing | Drum style presets and an auto bass line from the chords. **Generate first, then optionally tweak** in an editable grid or lane. |
| Practice aids (v1) | Loop + slow down, count-in + metronome, chord-scale overlay. |
| Guitar melodies | Automatic shift-minimizing fingering, with an optional position/CAGED lock per phrase. |
| Sheet music | Notation display synced with playback, and MusicXML import. **Photo/PDF recognition (OMR) is a TODO for later.** |
| Sound | Sampled instruments loaded on demand from a CDN; the built-in synth is the instant fallback. |
| Saving | Share link (URL-encoded, may drop non-essential data), JSON file import/export, MIDI import/export. |
| Tech | **Preact + htm vendored into the repo, still no build step.** Existing lessons keep working unchanged. |

## Song model

One JSON document. Time is stored in **ticks** (480 per quarter note), so swing, odd meters and tempo changes never touch stored data.

```js
{
  v: 1,
  title: 'Sketch 12',
  tempo: 96,             // quarter-note BPM
  swing: 0.0,            // 0 = straight, 0.33 ≈ triplet swing
  key: 'D', scale: 'dorian',
  transpose: 0,          // whole-song transposition (semitones)
  sections: [{
    id: 'a', name: 'A', bars: 4,
    meter: { num: 7, den: 8, groups: [2, 2, 3] },   // groups drive accents & drum feel
    chords: [{ at: 0, sym: 'Dm9' }, { at: 1680, sym: 'G13' }],
    melody: [{ at: 0, dur: 240, pitch: 69, vel: 90 }],
    bass:  { gen: { style: 'root-5th' } },            // or { notes: [...] } once edited
    drums: { gen: { style: 'fusion' } },               // or { steps: {...} } once edited
    lock:  [{ from: 0, to: 1920, fret: 5 }],           // optional guitar position locks
  }],
  arrangement: [{ section: 'a', repeat: 2 }, { section: 'b', repeat: 1 }],
}
```

- **Generated parts store their recipe, not their notes.** The recipe is regenerated when chords change. Pressing "Edit" materializes the notes into an editable lane. This keeps share links tiny and makes "regenerate from chords" one click.
- Per-section meter is enough for mixed-meter tunes; per-bar meter can come later without changing the format (`bars` can become an array).

## Architecture

```
js/
  vendor/preact+htm         ~10 KB, committed; no npm at runtime
  song/model.js             create / validate / migrate songs, tick math, meters
  song/store.js             current song as reactive state; undo; autosave
  song/codec.js             URL share encoding (compact JSON → deflate → base64url)
  song/midi.js              Standard MIDI File read/write (+ chord detection on import)
  song/musicxml.js          MusicXML subset import (notes, rests, chords, harmony symbols)
  song/generate/            bass.js, drums.js (style presets per meter)
  engine/scheduler.js       look-ahead Web Audio scheduler, loop, tempo %, count-in, metronome
  engine/instruments.js     sample loading (CDN) with synth fallback
  practice/                 "lenses": guitar.js, piano.js, sax.js, notation.js, chordscale.js
  lib/                      existing theory / guitar / chords (unchanged API)
  lessons/                  existing tools, plus song/ (Sketch + Practice views)
```

- **One clock, many lenses.** The scheduler emits "now" (current chord, active and upcoming notes, current scale). Each instrument view renders from that state, so views stay in sync and adding an instrument means adding one lens.
- **Slow down** just scales the tempo. Everything is MIDI-like events, so pitch never changes.
- **Transposition** has two layers. Song transpose moves everything. Instrument transposition (alto E♭, tenor B♭, …) changes only what that lens *displays*.

## Views

**Sketch** (enter ideas fast)
- Section strip with name, bars, meter and repeats; drag to arrange.
- Chord lane: type into a bar grid (`| Dm9 . G13 . |`); chords snap to beats or meter groups.
- Melody piano roll with QWERTY and MIDI recording (quantized).
- Backing: pick drum style and bass style; "Edit" opens a step grid or lane.

**Practice** (play along)
- Transport: play, loop section or bar range, tempo %, count-in, metronome.
- One or two instrument lenses, side by side on desktop and one large lens on a tablet:
  - **Guitar:** chord voicings from the existing engine with voice-leading; melody fingering; chord-scale overlay in the current position.
  - **Piano:** falling notes and a keyboard; chords voiced smoothly (toggle for jazz rootless left hand).
  - **Sax:** fingering diagram (alto first), written-pitch note name, range warnings.
  - **Notation:** staff synced to playback (VexFlow, lazy-loaded).

## Phases

1. ✅ **Foundation:**
   - Preact shell, song model and storage (autosave, JSON file, share link), sections with meters and swing
   - chord lane, drum presets, auto bass, scheduler, samples
   - practice view with the guitar lens (chords) and piano keyboard
   - loop / slow down / count-in / metronome, chord-scale overlay
2. **Melody & instruments:**
   - piano roll and QWERTY/MIDI recording
   - guitar melody fingering with position lock
   - piano falling notes, sax lens and transposition
   - MIDI import/export, editable drum grid and bass lane
3. **Notation:** synced notation display, MusicXML import.
4. **Later / TODO:** photo/PDF OMR, audio (humming) → MIDI, wait-for-me mode with MIDI input, arranger keyboard mode, synth playground, minigames, cloud sync.

## Resolved details

- **Home page:** songs first ("New song" plus the last song), with the tag-filtered tools grid below.
- **Autosave:** cache **only the last song** in the browser so a refresh doesn't lose work. No growing library on the device; songs are kept as share links or files.
- **Piano chords:** smooth voice-led by default (root in the left hand, voice-led chord tones in the right), with a toggle for jazz rootless left-hand voicings.
- **Next step:** build Phase 1 as described above.

## Phase 1 notes (as built)

- Generated bass/drums are stored as recipes (`{ gen: { style } }`); the editable `notes` / `steps` forms are already supported by the model and timeline, but there is no editor UI yet (Phase 2).
- Sections have per-section meter; chord slots sit on meter-group starts. Finer chord placement is a later addition.
- The playhead is polled with a timer (not `requestAnimationFrame`) so the display stays in sync when the window isn't painting.
- Share links use `deflate` (not `deflate-raw`) so the same code runs in Node 20 tests and all browsers.
- Chord-scale suggestions (`js/lib/chordscale.js`) are rules of thumb: quality first, then the chord's degree in the song's key.
