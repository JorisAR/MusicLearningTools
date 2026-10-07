# Music Learning Tools

Small, interactive music practice tools. Plain HTML/CSS/JS (native ES modules): **no framework, no build step, no dependencies.**


**DISCLAIMER:** This is 100% vibe coded. I am working on this to both explore possibilities, but also work on my music skills.

| Tool | What it does |
| --- | --- |
| **CAGED Scale Explorer** | Any mode or scale across the neck, one CAGED shape at a time. Brightness ladder, "show what changes" compare, drone, playback. |
| **Chord Explorer** | Type any chord symbol and get every sensible voicing. Build progressions that voice-lead close together. Includes a shape library. |

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
js/app.js                     Router wiring, home page (search + type + tag filters), lesson mounting
js/router.js                  Hash router: #/lesson/<id>?key=value…
js/lessons.js                 ★ Lesson registry: add an entry here to put a lesson on the site
js/lib/theory.js              Pure theory: pitch classes, degree spelling, scales & modes
js/lib/guitar.js              Tunings, fretboard math, CAGED shape data
js/lib/chords.js              Chord parser, voicing search, progression voice-leading, random chords
js/lib/audio.js               Plucked-string synth, strum, drone (Web Audio, no samples)
js/ui/dom.js                  h() / svg() element helpers, loadCss()
js/ui/controls.js             segmented(), toggle(), select(), chips()
js/ui/fretboard.js            Reusable horizontal SVG fretboard
js/ui/chord-diagram.js        Reusable vertical chord box
js/lessons/<id>/              One folder per lesson (JS + optional CSS)
js/lessons/_template/         Starter lesson to copy (not deployed)
tests/                        node --test suites
scripts/serve.js              No-cache dev server
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

## CAGED Scale Explorer

- **Scales:** the 7 modes, major/minor pentatonic, blues, harmonic and melodic minor, Lydian dominant, Phrygian dominant, altered, half-whole diminished and whole tone. Add more in `SCALES` (`js/lib/theory.js`) by writing their degrees, e.g. `['1','2','b3','4','5','6','b7']`.
- **Brightness ladder:** Lydian → Ionian → Mixolydian → Dorian → Aeolian → Phrygian → Locrian. Each step lowers exactly one note.
- **Show changes:** compares against a suggested scale, the previous scale you looked at, or any scale you pick. Notes that differ get a ring and the other scale's notes appear as dashed ghosts.
- **Chord tones:** highlight the triad or 7th chord inside the scale. **Drone:** root + fifth so you can hear each mode's color.
- Shortcuts: `M` major/minor · `,` `.` darker/brighter · `P` pentatonic · `←/→` or `0–5` shapes · `[ ]` key · `R C D F` toggles · `L` labels · `N` drone · `Space` play.

Shapes are data in `js/lib/guitar.js` (`CAGED_SHAPES`). Each shape is a root anchor plus a fret window per string. Edit the numbers to change a fingering.

## Chord Explorer

- **Chord finder:** understands symbols like `Cmaj9`, `F#m7b5`, `G13#11`, `C/D`, `D6/9`, `E7alt`, `Bbm(maj7)`, `C9sus4` and `Ebmaj7#11`.
  - Voicings are found by searching every 4-fret window. Each one must be playable with 4 fingers (or a barre) and keep the root or slash note in the bass. Optional tones like the 5th may be dropped.
  - Results are grouped by bass string and labeled Drop 2 / Drop 3 / Shell / Close.
  - **Rootless & inversions** lets the bass player take the root.
- **Shape library:** shown when the input is empty. Lists movable shapes for 26 chord types in any root.
- **Progression builder:** type chords (`Dm9 G13 Cmaj9`) or load or randomize a template.
  - The planner picks voicings that keep the hand close and the top voice smooth.
  - Use ‹ › on a chord to step through alternatives, best-fitting first. A chosen voicing gets locked 🔒 and the rest re-plan around it.
  - The neck view shows the current chord, the next chord as ghosts, and which fingers stay put.
  - Shortcuts: `Space` play · `←/→` move between chords · `↑/↓` cycle voicing.
- Tweak the voicing taste in `evaluate()` (scoring) and `transitionCost()` (voice-leading) in `js/lib/chords.js`.
