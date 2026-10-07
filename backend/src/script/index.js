// Loads and validates states.json — the single source of truth for lanes, states,
// slot schemas, groups (jump targets), intents, lexicons and system messages.
import { readFileSync } from "node:fs";
import { config } from "../config.js";

const SCRIPT = JSON.parse(readFileSync(config.statesPath, "utf8"));

export const META = SCRIPT.meta;
export const LANES = SCRIPT.lanes;
export const SLOTS = SCRIPT.slots;
export const GROUPS = SCRIPT.groups || {};
export const INTENTS = SCRIPT.intents;
export const LANE_IDS = LANES.map((l) => l.id);

export const STATES = Object.fromEntries(
  Object.entries(SCRIPT.states).map(([name, st]) => [
    name,
    { ...st, name, type: st.type || "customer_facing", required_slots: st.required_slots || [],
      optional_slots: st.optional_slots || [], next: st.next ?? null },
  ]),
);
export const STATES_ORDER = Object.keys(STATES);

export const wantSet = (cfg) => new Set([...(cfg.required_slots || []), ...(cfg.optional_slots || [])]);
export const langKey = (language) => META.languages[language] || META.languages[META.default_language];
export const loc = (language, obj) => {
  if (!obj) return "";
  const k = langKey(language);
  return obj[k] ?? obj[k.toLowerCase()] ?? obj[langKey(META.default_language)] ?? "";
};

// slot -> first state that collects it (used by the readiness gate)
export const COLLECTOR = (() => {
  const map = {};
  for (const [name, c] of Object.entries(STATES)) {
    if (c.type === "gate") continue;
    for (const k of c.required_slots) map[k] ||= name;
  }
  for (const [k, def] of Object.entries(SLOTS)) if (def.collector) map[k] = def.collector;
  map.area_id = map.area_name = STATES_ORDER.find((n) => STATES[n].type === "router" && (STATES[n].tools || []).some((t) => t.name === "fetch_nearest_areas"));
  return map;
})();

export const capturableSlots = () =>
  Object.entries(SLOTS).filter(([, d]) => d.type !== "system").map(([k]) => k);

export const groupOf = (slot) => SLOTS[slot]?.group || null;

// ---- fail fast on a broken script ----
(function validate() {
  const bad = [];
  for (const [name, st] of Object.entries(STATES)) {
    if (!LANE_IDS.includes(st.lane)) bad.push(`${name}: unknown lane ${st.lane}`);
    const targets = [st.next, ...(st.transitions || []).map((t) => t.goto)];
    if (st.on_exhausted && STATES[st.on_exhausted] !== undefined) targets.push(st.on_exhausted);
    for (const t of targets) if (t && !String(t).includes("{") && !STATES[t]) bad.push(`${name} -> ${t}`);
    for (const k of [...st.required_slots, ...st.optional_slots]) if (!SLOTS[k]) bad.push(`${name}: slot ${k} missing from registry`);
  }
  for (const [g, def] of Object.entries(GROUPS)) {
    if (def.entry && !STATES[def.entry]) bad.push(`group ${g}: entry ${def.entry}`);
    for (const r of def.return_before || []) if (!STATES[r]) bad.push(`group ${g}: return_before ${r}`);
  }
  for (const [id, it] of Object.entries(INTENTS))
    if (it.action?.state && !STATES[it.action.state]) bad.push(`intent ${id}: state ${it.action.state}`);
  if (bad.length) throw new Error("states.json is inconsistent:\n  " + bad.join("\n  "));
})();

// What the frontend needs to render lanes / states / slots dynamically.
export function publicScript() {
  return {
    meta: { bot_name: META.bot_name, company: META.company, default_max_retries: META.default_max_retries, max_total_invalid: META.max_total_invalid },
    lanes: LANES,
    states: Object.fromEntries(Object.entries(STATES).map(([k, s]) => [k, {
      lane: s.lane, type: s.type, on_demand: !!s.on_demand, terminal: !!s.terminal, next: s.next,
      required_slots: s.required_slots, optional_slots: s.optional_slots, max_retries: s.max_retries ?? META.default_max_retries,
      on_exhausted: s.on_exhausted ?? null, goto: [...new Set((s.transitions || []).map((t) => t.goto))],
    }])),
    slot_descriptions: Object.fromEntries(Object.entries(SLOTS).map(([k, d]) => [k, d.description])),
    slots: Object.fromEntries(Object.entries(SLOTS).map(([k, d]) => [k, { type: d.type, group: d.group || null, label: d.label || k }])),
    groups: Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, { label: g.label, entry: g.entry || null }])),
    intents: Object.fromEntries(Object.entries(INTENTS).map(([k, i]) => [k, { description: i.description, type: i.action.type }])),
  };
}
