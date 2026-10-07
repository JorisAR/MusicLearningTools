// The lesson registry — the only file you need to touch to add a lesson to the site.
//
// Each entry:
//   id       – URL slug: #/lesson/<id>
//   title    – card + page title
//   summary  – one-line description on the home page
//   type     – one of TYPES below (home page filter)
//   tags     – free-form tags (home page filter chips are built from these)
//   load     – () => import(...) of a module whose default export is
//              { mount(el, ctx) → cleanup? }   (see README.md)
//   status   – optional: 'planned' shows a dimmed "coming soon" card

export const TYPES = {
  tool: { label: 'Tool', plural: 'Tools' },
  lesson: { label: 'Lesson', plural: 'Lessons' },
  game: { label: 'Game', plural: 'Games' },
  reference: { label: 'Reference', plural: 'Reference' },
};

export const LESSONS = [
  {
    id: 'caged-scales',
    title: 'CAGED Scale Explorer',
    summary: 'Every mode and scale across the neck, one CAGED shape at a time. Climb the brightness ladder, see which notes move, hear it over a drone.',
    type: 'tool',
    tags: ['guitar', 'scales', 'modes', 'caged', 'fretboard'],
    load: () => import('./lessons/caged-scales/caged-scales.js'),
  },
  {
    id: 'chord-explorer',
    title: 'Chord Explorer',
    summary: 'Type any chord (Cmaj9, C/D, G13♯11) and get every sensible voicing. Build progressions that voice-lead close together.',
    type: 'tool',
    tags: ['guitar', 'chords', 'jazz', 'voicings', 'progressions'],
    load: () => import('./lessons/chord-explorer/chord-explorer.js'),
  },
  {
    id: 'fretboard-notes',
    title: 'Fretboard Note Finder',
    summary: 'A quick-fire game: find every C on the neck before the timer runs out.',
    type: 'game',
    tags: ['guitar', 'fretboard', 'notes'],
    status: 'planned',
  },
  {
    id: 'interval-ear',
    title: 'Interval Ear Trainer',
    summary: 'Hear two notes, name the interval. Builds the ear behind every scale.',
    type: 'game',
    tags: ['ear training', 'intervals'],
    status: 'planned',
  },
];

export const getLesson = (id) => LESSONS.find((l) => l.id === id);
