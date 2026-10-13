// Static checks on a script. Heuristic, not a substitute for running it on the engine.
import { entryState, langKeys, STATE_TYPES } from './script';

const SPECIAL_RETURN = new Set(['LAST_PENDING_STATE']);
const looksLikeState = (s) => /^[A-Z][A-Z0-9_]+$/.test(s); // engine actions are lower_snake_case, states are UPPER_CASE
const isPlaceholder = (s) => /^\{.*\}$/.test(s); // e.g. "{resume_state}" is resolved at runtime

export function validateScript(script) {
  const issues = [];
  const add = (level, msg, extra = {}) => issues.push({ level, msg, ...extra });
  const states = script.states || {};
  const names = Object.keys(states);
  const slots = script.slots || {};
  const laneIds = (script.lanes || []).map((l) => l.id);

  if (!names.length) { add('error', 'Script has no states.'); return issues; }

  const dupLane = laneIds.find((id, i) => laneIds.indexOf(id) !== i);
  if (dupLane) add('error', `Lane id "${dupLane}" is defined twice.`);
  if (!script.meta?.bot_name) add('warn', 'meta.bot_name is empty.');

  const langs = langKeys(script);
  for (const [name, st] of Object.entries(states)) {
    const at = { state: name };
    if (!STATE_TYPES.includes(st.type)) add('error', `Unknown type "${st.type}".`, at);
    if (!laneIds.includes(st.lane)) add('error', `Lane "${st.lane}" is not defined in lanes.`, at);

    const spoken = st.type === 'customer_facing' && !st.terminal && !st.on_demand;
    if (spoken && !st.reply_template && !st.reply_template_by_reason && !st.reply_template_variants && !st.prompt) {
      add('warn', 'Customer-facing state has no reply template or prompt.', at);
    }
    if (st.reply_template) {
      for (const l of langs) if (!st.reply_template[l]) add('info', `No ${l} reply text.`, at);
    }

    for (const key of ['required_slots', 'optional_slots']) {
      for (const s of st[key] || []) if (!slots[s]) add('error', `${key} refers to unknown slot "${s}".`, at);
    }
    if (st.next && !states[st.next]) add('error', `next → "${st.next}" does not exist.`, at);
    (st.transitions || []).forEach((t, i) => {
      if (!states[t.goto] && !isPlaceholder(t.goto || '')) add('error', `Transition ${i + 1} goes to unknown state "${t.goto}".`, at);
      if (!String(t.condition || '').trim()) add('warn', `Transition ${i + 1} → ${t.goto} has no condition.`, at);
    });
    if (st.on_exhausted && looksLikeState(st.on_exhausted) && !states[st.on_exhausted]) {
      add('warn', `on_exhausted → "${st.on_exhausted}" does not exist.`, at);
    }
    if (st.return_to && !states[st.return_to] && !SPECIAL_RETURN.has(st.return_to)) {
      add('warn', `return_to "${st.return_to}" does not exist.`, at);
    }
    if (st.type === 'customer_facing' && !st.terminal && !st.on_demand && !st.next && !(st.transitions || []).length) {
      add('info', 'No next state and no transitions: the call ends here. Mark it terminal if that is intended.', at);
    }
  }

  for (const [slot, def] of Object.entries(slots)) {
    if (def.type === 'enum' && !(def.values || []).length) add('warn', 'Enum slot has no values.', { slot });
    if (!def.type) add('error', 'Slot has no type.', { slot });
  }
  for (const [g, def] of Object.entries(script.groups || {})) {
    if (def.entry && !states[def.entry]) add('error', `Group "${g}" entry "${def.entry}" does not exist.`);
    for (const s of def.return_before || []) if (!states[s]) add('error', `Group "${g}" return_before "${s}" does not exist.`);
    for (const s of def.clear || []) if (!slots[s]) add('warn', `Group "${g}" clears unknown slot "${s}".`);
  }

  // reachability from the entry state (plus group entries, which the engine jumps to by intent)
  const seen = new Set();
  const stack = [entryState(script), ...Object.values(script.groups || {}).map((g) => g.entry)].filter(Boolean);
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n) || !states[n]) continue;
    seen.add(n);
    const st = states[n];
    [st.next, st.on_exhausted, ...(st.transitions || []).map((t) => t.goto)].forEach((x) => x && stack.push(x));
  }
  for (const [name, st] of Object.entries(states)) {
    if (!seen.has(name) && !st.on_demand) add('warn', 'Not reachable from the entry state through next / transitions.', { state: name });
  }
  return issues;
}

export const countIssues = (issues) => ({
  errors: issues.filter((i) => i.level === 'error').length,
  warns: issues.filter((i) => i.level === 'warn').length,
});
