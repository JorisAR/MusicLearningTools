// Hash router: works on GitHub Pages / any static host with zero config.
//   #/                          → home
//   #/?tag=guitar&type=tool     → home, filtered
//   #/lesson/caged-scales?key=A → a lesson with its own state in the URL

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function buildHash(path, params = {}) {
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const q = new URLSearchParams(clean).toString();
  return `#${path}${q ? `?${q}` : ''}`;
}

/** Update the URL's params without adding history entries or re-routing. */
export function replaceParams(params) {
  const { path } = parseHash();
  history.replaceState(null, '', buildHash(path, params));
}

export function onRoute(handler) {
  window.addEventListener('hashchange', () => handler(parseHash()));
  handler(parseHash());
}
