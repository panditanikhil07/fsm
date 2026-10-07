import { META, STATES, SLOTS, LANES } from "../script/index.js";
import { callTool } from "./tools.js";
import { enter } from "./flow.js";
import { ev } from "./events.js";
import { isFilled } from "../utils/text.js";

function lookupCaller(s) {
  const r = callTool(s, "fetch_customer_details_by_phone_number", { phone: s.caller_number });
  if (r.status === "CUSTOMER_FOUND") {
    s.customer_data = r.customer;
    Object.assign(s.flags, { customer_record_exists: true, new_customer_context: false });
  } else {
    s.customer_data = {};
    Object.assign(s.flags, { customer_record_exists: false, new_customer_context: true });
  }
  if (r.resume) {                       // previous call from this number was cut off: keep what was captured
    for (const [k, v] of Object.entries(r.resume)) if (SLOTS[k]?.resume && isFilled(v)) s.slots[k] = v;
    s.flags.resumed_previous = true;
    ev(s, "resume_loaded", { slots: Object.keys(r.resume) });
  }
}

export function createSession(id, callerNumber) {
  const s = {
    id, caller_number: String(callerNumber), started_at: new Date().toISOString(), last_active: Date.now(),
    state: "OPENING", lane: STATES.OPENING.lane, language: META.default_language,
    slots: {}, customer_data: {}, history: [], tool_calls: [], events: [],
    metrics: { turns: 0, total_ms: 0, last_turn_ms: 0, classify_ms: 0, capture_ms: 0, fsm_ms: 0, tool_ms: 0 },
    flags: {
      terminal: false, language_locked: false, language_unsupported: false, customer_record_exists: false, new_customer_context: true,
      Final_Service_Customer_Resolved: false, number_confirmed: false, lookup_result: null, slow_input_active: false,
      Rating_Asked: false, Rating_Resolved: false, has_open_ticket: false, has_cancelled_within_30d: false, has_closed_ticket: false,
      ticket_has_technician: false, address_count: 0, area_mapped: false, complaint_registered: false, resumed_previous: false,
      transfer_reason: null, transfer_result: null, resume_state: null, transfer_failed: {},
    },
    phase: {}, retries: {}, loops: {}, spoken: {}, path: [], turn_path: [], depth: 0,
    asking_slot: null, digits_heard: "", candidate_customer: null, candidate_resume: null,
    jump: null, freshEntry: null, invalid_streak: 0, last_reply: "", lastRaw: "",
    llm: { classifier: null, capture: null }, persisted: null,
  };
  lookupCaller(s);
  const out = [];
  s.turn_path = [];
  enter(s, "OPENING", out);
  s.last_reply = out.join(" ").trim();
  s.opening_events = s.events.splice(0);
  return s;
}

export function snapshot(s) {
  const cfg = STATES[s.state];
  const max = cfg.max_retries ?? META.default_max_retries;
  return {
    session_id: s.id, call_id: s.id, caller_number: s.caller_number, started_at: s.started_at,
    assistant: s.flags.terminal ? "" : s.last_reply, state: s.state, lane: s.lane, language: s.language,
    slots: s.slots, flags: s.flags, customer_data: s.customer_data, metrics: s.metrics, tool_calls: s.tool_calls,
    history: s.history, path: [...s.path], events: s.events,
    retry: { state: s.state, used: Math.min(s.retries[s.state] || 0, max), max, streak: s.invalid_streak, max_streak: META.max_total_invalid },
    jump: s.jump ? { group: s.jump.group, entry: s.jump.entry, resume: s.jump.resume, return_before: s.jump.return_before, queued: s.jump.queue.map((q) => q.group) } : null,
    llm: s.llm, persisted: s.persisted, lanes: LANES.map((l) => l.id),
  };
}
