# Music Learning Tools

Small, interactive music practice tools. Plain HTML/CSS/JS (native ES modules): **no framework, no build step, no dependencies.**


**DISCLAIMER:** This is 100% vibe coded. I am working on this to both explore possibilities, but also work on my music skills.

| Tool | What it does |
| --- | --- |
| **Song Sketchpad** | Sketch chords, melodies, bass and drums per section (any meter, swing), then practice along on guitar, piano (incl. falling notes) and sax. MIDI import/export. |
| **CAGED Scale Explorer** | Any mode or scale across the neck, one CAGED shape at a time. Brightness ladder, "show what changes" compare, drone, playback. |
| **Chord Explorer** | Type any chord symbol and get every sensible voicing, plus a library of movable shapes. Send a voicing straight to your song. |

## Run locally

```bash
npm run dev
```

Then open http://localhost:5173. `scripts/serve.js` is a tiny Node static server with caching turned off, so edits show up on reload. Any static server works, but ES modules need HTTP; opening `index.html` directly won't work.

```bash
npm test
```

Tests run with Node's built-in test runner and cover the theory, CAGED and chord code.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` runs the tests and publishes the site on every push to `main`.

One-time setup: on GitHub go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. After that, every push to `main` goes live at `https://<user>.github.io/<repo>/`.

You can also upload the folder to any static host, including a sub-path like `example.com/music/`. Paths are relative and routing uses the URL hash, so no server config is needed.

## Project layout

```
index.html                    App shell (header, <main id="app">, footer)
css/theme.css                 The one theme: design tokens (light/dark), components, fretboard & chord diagrams
js/app.js                     Router wiring, home page (songs + tools grid), lesson mounting
js/router.js                  Hash router: #/lesson/<id>?key=value…
js/lessons.js                 ★ Lesson registry: add an entry here to put a lesson on the site
js/vendor/preact-htm.js       Preact + hooks + htm, vendored (no build step, no CDN)
js/lib/theory.js              Pure theory: pitch classes, degree spelling, scales & modes
js/lib/guitar.js              Tunings, fretboard math, CAGED shape data
js/lib/chords.js              Chord parser, voicing search, voice-leading, transposition
js/lib/chordscale.js          Which scale fits a chord in a key (Dm9 in C → D Dorian)
js/lib/piano.js               Voice-led & rootless piano voicings
js/lib/fingering.js           Guitar fingering for melodies (hand-position model, optional lock)
js/lib/sax.js                 Sax transposition (alto/tenor/soprano/bari) and written-pitch fingerings
js/lib/audio.js               Plucked-string synth, strum, drone, shared AudioContext
js/song/model.js              Song document: meters, sections, arrangement, quick chord entry
js/song/timeline.js           Song → bars, chords (with guitar/piano voicings, chord-scales), audio events
js/song/generate/             Drum and bass generators (style presets for any meter)
js/song/store.js              Tiny reactive store + useStore hook; song store with undo & last-song cache
js/song/codec.js              Share links (deflate + base64url) and JSON files
js/song/midi.js               Standard MIDI File export/import (chord detection, meter changes, sections)
js/song/demos.js              Demo songs & the "new song" template
js/engine/player.js           Look-ahead Web Audio scheduler (loop, tempo %, count-in)
js/engine/instruments.js      Sampled instruments (FluidR3 via CDN, on demand), synth drums, click, mixer
js/ui/                        dom helpers, vanilla & Preact controls, fretboard, chord diagram, sax diagram
js/lessons/<id>/              One folder per lesson (JS + optional CSS)
js/lessons/song/              Song Sketchpad: song.js (controller), sketch.js, practice.js, pianoroll.js, drumgrid.js
js/lessons/_template/         Starter lesson to copy (not deployed)
tests/                        node --test suites
scripts/serve.js              No-cache dev server
docs/design.md                The learning-suite design & roadmap
.github/workflows/deploy.yml  Test + deploy to GitHub Pages
```

## Adding a lesson

1. Copy `js/lessons/_template/` to `js/lessons/my-lesson/` and rename the file.
2. Add an entry to `LESSONS` in `js/lessons.js` (id, title, summary, type, tags, `load`).
3. Done. It appears on the home page, filterable by its tags and type, at `#/lesson/my-lesson`.

A lesson module's default export is `{ mount(rootEl, { params, setParams }) → cleanup }`:

- `params` is the URL query, so state is shareable and bookmarkable.
- `setParams(obj)` writes state back to the URL without adding history entries.
- Return a cleanup function that removes global listeners and stops audio.

Planned ideas can be listed with `status: 'planned'` (no `load`). They show as dimmed "coming soon" cards.

## Theming

Everything reads from CSS custom properties at the top of `css/theme.css`. The colors carry meaning across all tools:

| Token | Meaning |
| --- | --- |
| `--accent` | Root |
| `--chord` | Chord tones / guide tones (3rd, 7th) |
| `--changed` | What's different: changed scale notes, chord extensions & alterations |

## Song Sketchpad

Open it from **Songs** on the home page (new song, continue the last one, or a demo).

**Sketch**
- **Arrangement:** colored blocks sized by length. Drag to reorder, click to jump there, `×N` for repeats.
- **Sections** have a name, color, bars and meter with grouping (`7/8` as `2+2+3`), and four tabs:
  - **Chords:** a bar grid (one slot per group) or quick entry `Dm9 G13 | Cmaj9 | %`. **Load a progression…** / **🎲 Random** fill the section in the song's key. With **Guitar chords** on, each chord shows its voicing; use ‹ › to pick another (a pick is locked 🔒 and the rest of the song re-voices around it). **Piano chords** shows compact keyboards instead.
  - **Melody:** a piano roll (click to add, drag to move/lengthen, double-click or right-click to delete, arrows nudge). Chord tones are shaded. **● Record** loops the section with a count-in and records from the computer keyboard (**⌨ Keys**: `A W S E D F T G Y H U J K`, `Z`/`X` octave) or a **MIDI keyboard** (Chrome/Edge), quantized to the grid. Optionally lock the guitar position for this melody.
  - **Bass / Drums:** pick a style to generate from the chords and meter. The result is shown in a roll / step grid, and editing any note turns it into your own part. Pick a style again to regenerate.
- **Song settings:** tempo, swing, key/scale (used for chord-scale suggestions and "Load a progression"), transpose.

**Practice**
- Transport: ⏮ previous section · ▶/❚❚ play-pause · ■ stop (back to the start) · ⏭ next section; speed 40–130 % (no pitch change), loop song / section, count-in, click. Mute chords, bass, drums or melody to play that part yourself.
- **Now / Next** shows the chord, its tones and a suggested scale; the strip shows the current section.
- Lenses:
  - **Guitar:** chords (voice-led, Auto/Low/Mid/High), melody (fingered by position, next notes numbered), or both, plus the chord-scale around your hand.
  - **Piano:** keys or **falling notes** (Synthesia-style; melody, chords and bass toggles); voice-led or rootless; keys you hold on ⌨ / MIDI light up.
  - **Sax:** alto, tenor, soprano or bari. Written note, concert note, fingering diagram, alternates and the next notes. Without a melody it shows the chord tones to arpeggiate.

**Files & sharing:** only the last song is cached in this browser. **Song ▾** → copy a share link (whole song in the URL), save/open a `.song.json`, **export MIDI** (tracks: chords, bass, melody, drums + chord symbols and section markers), or **open a MIDI file**. Imported files keep their meter changes and sections; chord symbols are detected from the harmony when the file has none.

Shortcuts: `Space` play/pause · `Esc` stop · `Shift+←/→` sections · `←/→` chords (Practice) · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo.

Sounds: chords, bass and melody use FluidR3 GM samples loaded on demand from `gleitz.github.io` (cached by the browser); a synth fills in until they arrive. Drums and click are synthesized.

## CAGED Scale Explorer

- **Scales:** the 7 modes, major/minor pentatonic, blues, harmonic and melodic minor, Lydian dominant, Phrygian dominant, altered, half-whole diminished and whole tone. Add more in `SCALES` (`js/lib/theory.js`) by writing their degrees, e.g. `['1','2','b3','4','5','6','b7']`.
- **Brightness ladder:** Lydian → Ionian → Mixolydian → Dorian → Aeolian → Phrygian → Locrian. Each step lowers exactly one note.
- **Show changes:** compares against a suggested scale, the previous scale you looked at, or any scale you pick. Notes that differ get a ring and the other scale's notes appear as dashed ghosts.
- **Chord tones:** highlight the triad or 7th chord inside the scale. **Drone:** root + fifth so you can hear each mode's color.
- Shortcuts: `M` major/minor · `,` `.` darker/brighter · `P` pentatonic · `←/→` or `0–5` shapes · `[ ]` key · `R C D F` toggles · `L` labels · `N` drone · `Space` play.

Shapes are data in `js/lib/guitar.js` (`CAGED_SHAPES`). Each shape is a root anchor plus a fret window per string. Edit the numbers to change a fingering.

## Chord Explorer

- Understands symbols like `Cmaj9`, `F#m7b5`, `G13#11`, `C/D`, `D6/9`, `E7alt`, `Bbm(maj7)`, `C9sus4`, `Ebmaj7#11`.
- Voicings are found by searching every 4-fret window. Each must be playable with 4 fingers (or a barre) and keep the root or slash note in the bass, while optional tones like the 5th may be dropped. Results are grouped by bass string and labeled Drop 2 / Drop 3 / Shell / Close. **Rootless & inversions** lets the bass player take the root.
- **Shape library** (empty input): movable shapes for 26 chord types in any root.
- **+ Add to song** appends the chord, with that exact voicing locked, as a new bar of your current song. Progressions, voice-leading and playback live in the Song Sketchpad.
- Tweak the voicing taste in `evaluate()` (scoring) and `transitionCost()` (voice-leading) in `js/lib/chords.js`.
