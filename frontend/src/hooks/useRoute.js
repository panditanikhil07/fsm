import { useEffect, useState } from 'react';

// Hash routing: works under the Vite `base: '/fsm'` with no server-side rewrites.
const read = () => {
  const raw = window.location.hash.replace(/^#/, '') || '/test';
  const [path, qs = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
};

// A view with unsaved work can register a guard; returning false cancels the navigation.
let guard = null;
export const setNavGuard = (fn) => { guard = fn; };
export const navigate = (to) => {
  if (guard && !guard()) return;
  window.location.hash = to;
};

export function useRoute() {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
