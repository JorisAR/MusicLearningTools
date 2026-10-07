import { h } from './ui/dom.js';
import { segmented, chips } from './ui/controls.js';
import { onRoute, replaceParams } from './router.js';
import { LESSONS, TYPES, getLesson } from './lessons.js';

const app = document.getElementById('app');
const SITE_TITLE = 'Music Learning Tools';
let cleanup = null;

// --- theme toggle (system default, user override remembered) --------------
const THEME_KEY = 'mlt-theme';
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try {
  applyTheme(localStorage.getItem(THEME_KEY));
} catch {}
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const isDark =
    document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = isDark ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
});

// --- routing ---------------------------------------------------------------
// Lessons write their state with history.replaceState (no hashchange), so every
// hashchange here is real navigation: links, back/forward, or a pasted URL.
onRoute(({ path, params }) => {
  const m = path.match(/^\/lesson\/([\w-]+)/);
  cleanup?.();
  cleanup = null;
  window.scrollTo(0, 0);
  if (m) renderLesson(m[1], params);
  else renderHome(params);
});

// --- home ------------------------------------------------------------------
function renderHome(params) {
  document.title = SITE_TITLE;
  const state = {
    q: params.q || '',
    type: params.type || 'all',
    tags: params.tags ? params.tags.split(',') : [],
  };

  const allTags = [...new Set(LESSONS.flatMap((l) => l.tags))].sort();
  const typesPresent = Object.keys(TYPES).filter((t) => LESSONS.some((l) => l.type === t));

  const grid = h('div', { class: 'card-grid' });
  const count = h('p', { class: 'result-count' });

  const sync = () => {
    replaceParams({
      q: state.q,
      type: state.type === 'all' ? '' : state.type,
      tags: state.tags.join(','),
    });
    typeCtl.set(state.type);
    tagCtl.set(state.tags);
    draw();
  };

  const search = h('input', {
    class: 'search',
    type: 'search',
    placeholder: 'Search tools & lessons…',
    value: state.q,
    oninput: (e) => {
      state.q = e.target.value;
      sync();
    },
  });

  const typeCtl = segmented({
    label: 'Type',
    value: state.type,
    options: [{ value: 'all', label: 'All' }, ...typesPresent.map((t) => ({ value: t, label: TYPES[t].plural }))],
    onChange: (v) => {
      state.type = v;
      sync();
    },
  });

  const tagCtl = chips({
    options: allTags.map((t) => ({ value: t, label: `#${t}` })),
    selected: state.tags,
    onChange: (v) => {
      state.tags = v;
      sync();
    },
  });

  function draw() {
    const q = state.q.trim().toLowerCase();
    const list = LESSONS.filter(
      (l) =>
        (state.type === 'all' || l.type === state.type) &&
        state.tags.every((t) => l.tags.includes(t)) &&
        (!q || [l.title, l.summary, ...l.tags].join(' ').toLowerCase().includes(q)),
    );
    count.textContent = `${list.length} ${list.length === 1 ? 'item' : 'items'}`;
    grid.replaceChildren(
      ...(list.length
        ? list.map(card)
        : [h('div', { class: 'empty' }, 'Nothing matches those filters yet.')]),
    );
  }

  app.replaceChildren(
    h(
      'section',
      { class: 'hero' },
      h('h1', {}, 'Practice tools for ', h('span', { class: 'accent-text' }, 'musicians')),
      h('p', { class: 'lede' }, 'Small, focused, interactive. Pick a tool, tweak it, learn by ear and by eye.'),
    ),
    h(
      'section',
      { class: 'filters' },
      h('div', { class: 'filters-row' }, search, typeCtl.el),
      tagCtl.el,
    ),
    count,
    grid,
  );
  draw();
}

function card(l) {
  const planned = l.status === 'planned';
  const body = [
    h(
      'div',
      { class: 'card-top' },
      h('span', { class: `type-pill type-${l.type}` }, TYPES[l.type]?.label ?? l.type),
      planned && h('span', { class: 'soon' }, 'Coming soon'),
    ),
    h('h3', { class: 'card-title' }, l.title),
    h('p', { class: 'card-summary' }, l.summary),
    h('div', { class: 'card-tags' }, l.tags.map((t) => h('span', { class: 'tag' }, `#${t}`))),
  ];
  return planned
    ? h('div', { class: 'card planned', aria: { disabled: 'true' } }, body)
    : h('a', { class: 'card', href: `#/lesson/${l.id}` }, body);
}

// --- lesson ----------------------------------------------------------------
async function renderLesson(id, params) {
  const lesson = getLesson(id);
  if (!lesson || !lesson.load) {
    app.replaceChildren(
      h('div', { class: 'empty' }, 'That tool doesn’t exist (yet). ', h('a', { href: '#/' }, 'Back home')),
    );
    return;
  }
  document.title = `${lesson.title} · ${SITE_TITLE}`;
  const mountPoint = h('div', { class: 'lesson-body' });
  app.replaceChildren(
    h(
      'header',
      { class: 'lesson-head' },
      h('a', { class: 'back', href: '#/' }, '← All tools'),
      h('h1', {}, lesson.title),
      h('p', { class: 'lede' }, lesson.summary),
    ),
    mountPoint,
  );
  const token = (renderLesson.token = {});
  const mod = await lesson.load();
  if (renderLesson.token !== token) return; // navigated away while loading
  cleanup = mod.default.mount(mountPoint, { params, setParams: replaceParams, lesson }) || null;
}
