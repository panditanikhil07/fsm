export const isSet = (v) => v !== undefined && v !== null && v !== '';
export const show = (v) => (!isSet(v) ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
export const clone = (o) => structuredClone(o);
export const truncate = (s, n = 60) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
export const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
