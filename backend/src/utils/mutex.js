// Serialises async work per key so two turns of one session never interleave.
const tails = new Map();
export function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  tails.set(key, tail);
  tail.then(() => tails.get(key) === tail && tails.delete(key));
  return run;
}
