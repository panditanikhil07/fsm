// Pure helpers for the states.json script model. No React in here.
import { clone } from './format';

export const STATE_TYPES = ['customer_facing', 'router', 'gate'];
export const SLOT_TYPES = ['enum', 'boolean', 'digits', 'name', 'text', 'pin', 'choice', 'system'];
export const TOOL_WHEN = ['on_enter', 'before_asking', 'after_each_dictation', 'after_confirmation', 'on_leave'];
export const INTENT_ACTIONS = ['answer', 'update', 'recall', 'repeat', 'wait', 'end_call', 'smalltalk'];

export const entryState = (script) => Object.keys(script.states || {})[0];
export const langKeys = (script) => Object.values(script.meta?.languages || { english: 'ENGLISH' });

/* ---------- starter scripts ---------- */

const DEFAULT_INTENTS = {
  answer: { description: 'The utterance answers, confirms or denies what the pending question asked.', action: { type: 'answer' } },
  repeat: { description: 'Caller did not hear and asks to repeat the last question.', action: { type: 'repeat' }, keywords: ['repeat', 'say that again', 'pardon'] },
  end_call: { description: 'Caller wants to finish the call.', action: { type: 'end_call' }, keywords: ['bye', 'goodbye', 'that\'s all'] },
  smalltalk: { description: 'Greeting, thanks, or a harmless question about who you are.', action: { type: 'smalltalk' }, keywords: ['hello', 'hi', 'thanks'] },
};

export function normalizeScript(script) {
  if (!script || typeof script !== 'object') return script;
  const { _layout, ...clean } = script;
  return {
    meta: clean.meta || {},
    lanes: clean.lanes || [],
    slots: clean.slots || {},
    groups: clean.groups || {},
    intents: clean.intents || {},
    states: clean.states || {},
  };
}

export function blankScript(base) {
  const b = base?.meta || {};
  return {
    meta: {
      bot_name: b.bot_name || 'Assistant',
      company: b.company || 'Your Company',
      default_language: b.default_language || 'english',
      languages: clone(b.languages || { english: 'ENGLISH', hindi: 'HINDI' }),
      default_max_retries: b.default_max_retries ?? 3,
      max_total_invalid: b.max_total_invalid ?? 6,
      max_state_visits: b.max_state_visits ?? 10,
      max_depth: b.max_depth ?? 40,
      resume_window_hours: b.resume_window_hours ?? 24,
      phone_pattern: b.phone_pattern || '^[6-9]\\d{9}$',
      country_calling_code: b.country_calling_code || '91',
      persona: b.persona || 'A warm, concise voice assistant. Never invents policies, prices or ticket numbers.',
      lexicon: clone(b.lexicon || { yes: ['yes', 'yeah', 'ok'], no: ['no', 'nope'] }),
    },
    lanes: [
      { id: 'START', label: 'Start' },
      { id: 'COLLECT', label: 'Collect' },
      { id: 'END', label: 'End' },
    ],
    slots: {
      caller_name: { type: 'name', description: "Caller's name", label: 'name' },
    },
    groups: {},
    intents: clone(base?.intents && Object.keys(base.intents).length ? base.intents : DEFAULT_INTENTS),
    states: {
      GREETING: {
        prompt: 'Greet the caller once and ask how you can help.',
        required_slots: [], optional_slots: [], skippable: false,
        reply_template: { ENGLISH: 'Hello, this is the assistant. How can I help you today?' },
        next: 'CAPTURE_NAME', type: 'customer_facing', lane: 'START',
      },
      CAPTURE_NAME: {
        prompt: "Ask for the caller's name.",
        required_slots: ['caller_name'], optional_slots: [], skippable: false,
        max_retries: 3, on_exhausted: 'GOODBYE',
        reply_template: { ENGLISH: 'May I have your name, please?' },
        next: 'GOODBYE', type: 'customer_facing', lane: 'COLLECT',
      },
      GOODBYE: {
        prompt: 'Close the call politely.',
        required_slots: [], optional_slots: [], skippable: false, terminal: true,
        reply_template: { ENGLISH: 'Thank you {caller_name}. Goodbye.' },
        next: null, type: 'customer_facing', lane: 'END',
      },
    },
  };
}

export function newStateDef(script, { lane, type = 'customer_facing' } = {}) {
  const replies = Object.fromEntries(langKeys(script).map((k) => [k, '']));
  return {
    prompt: '',
    required_slots: [], optional_slots: [], skippable: false,
    ...(type === 'customer_facing' ? { reply_template: replies } : {}),
    next: null, type, lane: lane || script.lanes?.[0]?.id || 'START',
  };
}

export function uniqueName(existing, base = 'NEW_STATE') {
  const taken = new Set(Object.keys(existing));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

export const toStateId = (s) => s.toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');

/* ---------- mutations (operate on a cloned draft, in place) ---------- */

const refKeys = ['next', 'on_exhausted', 'return_to', 'reask_state'];

export function renameState(script, from, to) {
  if (from === to || !script.states[from] || script.states[to]) return false;
  script.states = Object.fromEntries(Object.entries(script.states).map(([k, v]) => [k === from ? to : k, v]));
  for (const st of Object.values(script.states)) {
    for (const k of refKeys) if (st[k] === from) st[k] = to;
    for (const t of st.transitions || []) if (t.goto === from) t.goto = to;
  }
  for (const g of Object.values(script.groups || {})) {
    if (g.entry === from) g.entry = to;
    if (Array.isArray(g.return_before)) g.return_before = g.return_before.map((s) => (s === from ? to : s));
  }
  for (const sl of Object.values(script.slots || {})) if (sl.collector === from) sl.collector = to;
  if (script._layout?.[from]) { script._layout[to] = script._layout[from]; delete script._layout[from]; }
  return true;
}

export function deleteState(script, name) {
  delete script.states[name];
  if (script._layout) delete script._layout[name];
  for (const st of Object.values(script.states)) {
    if (st.next === name) st.next = null;
    for (const k of ['on_exhausted', 'return_to', 'reask_state']) if (st[k] === name) delete st[k];
    if (st.transitions) st.transitions = st.transitions.filter((t) => t.goto !== name);
    if (st.transitions && !st.transitions.length) delete st.transitions;
  }
}

export function setEntry(script, name) {
  const { [name]: st, ...rest } = script.states;
  script.states = { [name]: st, ...rest };
}

// dragging a handle: first link becomes `next`, any further link becomes a conditional transition
export function connect(script, source, target) {
  const st = script.states[source];
  if (!st || !script.states[target]) return null;
  if (!st.next) { st.next = target; return { kind: 'next' }; }
  st.transitions = [...(st.transitions || []), { condition: '', goto: target }];
  return { kind: 'transition', index: st.transitions.length - 1 };
}

export function removeEdge(script, source, data) {
  const st = script.states[source];
  if (!st) return;
  if (data.kind === 'next') st.next = null;
  else if (data.kind === 'exhausted') delete st.on_exhausted;
  else if (data.kind === 'transition') {
    st.transitions.splice(data.index, 1);
    if (!st.transitions.length) delete st.transitions;
  }
}

export function retargetEdge(script, source, data, target) {
  const st = script.states[source];
  if (!st) return;
  if (data.kind === 'next') st.next = target;
  else if (data.kind === 'exhausted') st.on_exhausted = target;
  else if (data.kind === 'transition') st.transitions[data.index].goto = target;
}

export function slotUsage(script, slot) {
  return Object.entries(script.states || {})
    .filter(([, s]) => [...(s.required_slots || []), ...(s.optional_slots || [])].includes(slot))
    .map(([k]) => k);
}

export function deleteSlot(script, slot) {
  delete script.slots[slot];
  for (const st of Object.values(script.states)) {
    st.required_slots = (st.required_slots || []).filter((s) => s !== slot);
    st.optional_slots = (st.optional_slots || []).filter((s) => s !== slot);
  }
  for (const g of Object.values(script.groups || {})) if (g.clear) g.clear = g.clear.filter((s) => s !== slot);
}

export function renameSlot(script, from, to) {
  if (from === to || !script.slots[from] || script.slots[to]) return false;
  script.slots = Object.fromEntries(Object.entries(script.slots).map(([k, v]) => [k === from ? to : k, v]));
  const swap = (arr) => (arr || []).map((s) => (s === from ? to : s));
  for (const st of Object.values(script.states)) {
    st.required_slots = swap(st.required_slots);
    st.optional_slots = swap(st.optional_slots);
  }
  for (const g of Object.values(script.groups || {})) if (g.clear) g.clear = swap(g.clear);
  return true;
}

export function deleteLane(script, id) {
  script.lanes = script.lanes.filter((l) => l.id !== id);
}
