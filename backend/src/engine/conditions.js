// states.json conditions are python-ish; translate once to JS and cache.
const cache = new Map();

function compile(src) {
  if (/^all required slots resolved$/i.test(src.trim())) return () => true;
  const js = src
    .replace(/slots\.language\.requested_unsupported/g, "flags.language_unsupported")
    .replace(/\bis not None\b/g, "!= null").replace(/\bis None\b/g, "== null")
    .replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null")
    .replace(/\band\b/g, "&&").replace(/\bor\b/g, "||").replace(/\bnot\b/g, "!")
    .replace(/([\w.]+)\s+in\s+(\[[^\]]*\])/g, "$2.includes($1)")
    .replace(/(^|[^.\w])transfer_reason\b/g, "$1flags.transfer_reason");
  try { return new Function("slots", "flags", `return !!(${js});`); }
  catch { console.warn(`[script] condition not evaluable, treated as true: ${src}`); return () => true; }
}

export function evalCond(src, session) {
  if (!cache.has(src)) cache.set(src, compile(src));
  try { return cache.get(src)(session.slots, session.flags); } catch { return false; }
}
