// The FSM core: enter / ask / leave / resolve. Everything state-specific is read from states.json
// (templates, transitions, retries, exhaustion strategy, hooks, flows); no state names are special-cased
// except through the `hook`, `on_leave`, `flow` and `on_exhausted` keys the script declares.
import { META, STATES, STATES_ORDER, COLLECTOR, SLOTS, loc } from "../script/index.js";
import { evalCond } from "./conditions.js";
import { render, interp, interpObj, applySets, pickTemplate, selectedAddress, latestTicket } from "./render.js";
import { callTool } from "./tools.js";
import { ev } from "./events.js";
import { isFilled, titleCase, norm } from "../utils/text.js";
import { normalizeMobile, validMobile } from "../utils/digits.js";
import { nameTokens } from "../utils/names.js";
import { fallbackCapture } from "../llm/fallback.js";

const STOP = Symbol("stop");
const maxRetries = (cfg) => cfg.max_retries ?? META.default_max_retries;
export const wants = (cfg) => new Set([...cfg.required_slots, ...cfg.optional_slots]);
export const isEnding = (cfg) =>
  !!cfg.terminal || (cfg.type === "customer_facing" && !cfg.on_demand && cfg.next == null && !(cfg.transitions || []).length && !cfg.required_slots.length);

// ------------------------------------------------------------- helpers ------
export function place(s, name) {            // move the cursor without speaking
  const cfg = STATES[name];
  if (cfg.lane !== s.lane) ev(s, "lane_switch", { from: s.lane, to: cfg.lane, state: name });
  s.state = name; s.lane = cfg.lane;
  s.path.push(name); s.turn_path.push(name);
  s.phase[name] = undefined;
  ev(s, "state_enter", { state: name, lane: cfg.lane, type: cfg.type });
}

function runTools(s, cfg, when) {
  const results = [];
  for (const tl of cfg.tools || []) {
    if (tl.when !== when) continue;
    if (tl.unless && evalCond(tl.unless, s)) continue;
    results.push({ tool: tl, result: callTool(s, tl.name, interpObj(s, tl.args)) });
  }
  return results;
}

export function refreshTicketFlags(s) {
  const known = s.flags.customer_record_exists && !s.flags.new_customer_context;
  const tickets = known ? s.customer_data.tickets || [] : [];
  const recent = (t) => Date.now() - Date.parse(t.cancelled_at || 0) < 30 * 86_400_000;
  s.flags.has_open_ticket = tickets.some((t) => t.status === "open");
  s.flags.has_cancelled_within_30d = tickets.some((t) => t.status === "cancelled" && recent(t));
  s.flags.has_closed_ticket = tickets.some((t) => t.status === "closed");
  s.flags.ticket_has_technician = !!latestTicket(s)?.technician_name;
}

export function becomeNewCustomer(s) {
  Object.assign(s.flags, { customer_record_exists: false, new_customer_context: true });
  s.customer_data = {};
}

const HANDLERS = {               // states.json `on_transition`
  reset_service_context(s) {
    const g = SLOTS;
    for (const k of Object.keys(g)) if (["new_customer", "address", "address_type", "contact_person"].includes(g[k].group) || ["identity_confirmed", "service_number"].includes(k)) delete s.slots[k];
    s.customer_data = {};
    Object.assign(s.flags, { customer_record_exists: false, new_customer_context: false, Final_Service_Customer_Resolved: false, number_confirmed: false, lookup_result: null, area_mapped: false });
  },
};

// -------------------------------------------------------------- hooks -------
const ON_ENTER = {
  refresh_ticket_flags: (s) => refreshTicketFlags(s),
  count_addresses: (s) => {
    s.flags.address_count = s.flags.customer_record_exists && !s.flags.new_customer_context ? (s.customer_data.addresses || []).length : 0;
  },
  map_area(s, cfg, out) {
    for (const { result } of runTools(s, cfg, "on_enter")) {
      if (result.status === "EXACT_MATCH") {
        Object.assign(s.slots, { area_id: result.area_id, area_name: result.area_name, city_type: result.city_type });
        s.flags.area_mapped = true;
        out.push(render(s, cfg.reply_template));
      } else s.flags.area_mapped = false;           // no announcement; service team maps it internally
    }
  },
  create_ticket(s) {
    if (!s.slots.ticket_id) s.slots.ticket_id = callTool(s, "create_ticket", { product: s.slots.product, brand: s.slots.brand }).ticket_id;
  },
  transfer(s, cfg, out) { doTransfer(s, out); return STOP; },
};

const ON_LEAVE = {
  resolve_service_number(s) {
    if (s.slots.service_number_choice === "same") s.slots.final_service_number = s.caller_number;
  },
  adopt_saved_address(s) {
    if (s.slots.address_confirmed !== true) return;
    const a = selectedAddress(s);
    if (a) {
      for (const k of ["street", "area", "city", "state", "pin_code", "area_id", "area_name", "city_type"]) if (isFilled(a[k])) s.slots[k] = a[k];
      s.flags.area_mapped = !!a.area_id;
    }
    if (!s.slots.address_type) s.slots.address_type = a?.address_type || (s.customer_data.customer_type || "").toLowerCase() || undefined;
    if (!isFilled(s.slots.address_type)) delete s.slots.address_type;
  },
  run_after_confirmation_tools(s, cfg) { if (s.slots.address_confirmed === true) runTools(s, cfg, "after_confirmation"); },
  resolve_rating(s) {
    s.flags.Rating_Resolved = true;
    if (!isFilled(s.slots.call_rating)) s.slots.call_rating = "not_given";
  },
};

// -------------------------------------------------------- jump support ------
// A "jump" temporarily leaves the current state to (re)collect an earlier detail, then returns
// to the state the caller was in (`resume`) once the group's `return_before` boundary is reached.
export function beginJump(s, spec, resume, queue = []) {
  s.jump = { group: spec.group, entry: spec.entry, resume, return_before: spec.return_before, slots: spec.slots, queue };
  for (const k of spec.clear) delete s.slots[k];
  s.loops[spec.entry] = 0; s.retries[spec.entry] = 0;
  ev(s, "jump_start", { group: spec.group, from: resume, to: spec.entry, cleared: spec.clear });
  place(s, spec.entry);
  s.freshEntry = spec.entry;
}

export function finishJump(s, out) {
  const j = s.jump;
  const next = j.queue.shift();
  ev(s, "jump_return", { group: j.group, to: next ? next.entry : j.resume });
  if (next) { beginJump(s, next, j.resume, j.queue); return ask(s, next.entry, out, { mode: "first" }); }
  s.jump = null;
  if (STATES[j.resume].hook) {                       // e.g. REGISTER_COMPLAINT: do not announce the registration twice
    place(s, j.resume);
    return ask(s, j.resume, out, { mode: "reask" });
  }
  return enter(s, j.resume, out);
}

// ------------------------------------------------------------- engine -------
export function enter(s, name, out) {
  const cfg = STATES[name];
  if (!cfg) throw new Error(`Unknown state ${name}`);
  if (++s.depth > META.max_depth) { s.depth = 0; s.jump = null; return enter(s, "RATING_GATE", out); }
  s.loops[name] = (s.loops[name] || 0) + 1;
  if (s.loops[name] > META.max_state_visits && !["RATING_GATE", "CLOSING"].includes(name) && !isEnding(cfg)) { s.jump = null; return enter(s, "RATING_GATE", out); }
  if (cfg.guard && /^flags\./.test(cfg.guard) && !evalCond(cfg.guard, s) && ["CLOSING", "CLOSING_STATUS_ENQUIRY"].includes(name)) return enter(s, "RATING_GATE", out);

  if (s.jump && (cfg.lane === "TRANSFER" || cfg.terminal)) s.jump = null;
  if (s.jump?.return_before.includes(name)) return finishJump(s, out);

  place(s, name);
  applySets(s, cfg.sets);
  if (cfg.announce_template) out.push(render(s, cfg.announce_template));
  for (const x of cfg.announce_extra || []) if (evalCond(x.when, s)) out.push(render(s, x.template));
  if (!cfg.hook) runTools(s, cfg, "on_enter");
  if (cfg.hook && ON_ENTER[cfg.hook]?.(s, cfg, out) === STOP) return;

  if (cfg.terminal) { s.flags.terminal = true; return; }

  if (cfg.type === "router" || cfg.type === "gate") {
    if (cfg.type === "gate") {
      const missing = gateMissing(s);
      if (missing.length) {
        const target = missing.map((k) => COLLECTOR[k] || STATES_ORDER.find((n) => STATES[n].required_slots.includes("street")))
          .sort((a, b) => STATES_ORDER.indexOf(a) - STATES_ORDER.indexOf(b))[0];
        ev(s, "gate_missing", { slots: missing, goto: target });
        return enter(s, target, out);
      }
    }
    return leave(s, name, out);
  }
  if (canSkip(s, name)) { ev(s, "state_skipped", { state: name }); return leave(s, name, out); }
  ask(s, name, out);
}

function gateMissing(s) {
  const cfg = Object.values(STATES).find((c) => c.type === "gate");
  const req = [...cfg.required_slots];
  for (const [cond, slots] of Object.entries(cfg.conditional_required_slots || {})) if (evalCond(cond, s)) req.push(...slots);
  return req.filter((k) => !isFilled(s.slots[k]));
}

function canSkip(s, name) {
  const cfg = STATES[name];
  if (cfg.skip_if) return s.flags.Rating_Resolved && evalCond(cfg.skip_if, s);
  const all = cfg.required_slots.length > 0 && cfg.required_slots.every((k) => isFilled(s.slots[k]));
  return all && (!!cfg.skippable || (!!cfg.accept_prefill && s.freshEntry !== name));
}

function pickNext(s, name) {
  const cfg = STATES[name];
  for (const tr of [...(cfg.transitions || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (!evalCond(tr.condition, s)) continue;
    applySets(s, tr.set);
    if (tr.on_transition) HANDLERS[tr.on_transition]?.(s);
    return interp(s, tr.goto);
  }
  return cfg.next ?? null;
}

export function leave(s, name, out) {
  s.retries[name] = 0; s.invalid_streak = 0;
  const target = pickNext(s, name);
  if (!target) { s.flags.terminal = true; return; }
  if (target === name) return ask(s, name, out, { mode: "retry" });
  enter(s, target, out);
}

// ---- transfer -----------------------------------------------------------------
function doTransfer(s, out) {
  const cfg = STATES.TRANSFER_TO_AGENT;
  const reason = s.flags.transfer_reason || "unsupported_request";
  out.push(render(s, cfg.reply_template_by_reason[reason] || cfg.reply_template_by_reason.unsupported_request));
  const r = callTool(s, "initiate_warm_transfer", { reason });
  const mapped = cfg.tools?.[0]?.on_result?.[r.status] ?? "failed";
  s.flags.transfer_result = mapped === "TRANSFER_COMPLETE" ? "success" : mapped === "CLOSING_CALLBACK" ? "outside_business_hours" : "failed";
  if (s.flags.transfer_result === "failed") s.flags.transfer_failed[reason] = true;
  ev(s, "transfer", { reason, result: s.flags.transfer_result });
  enter(s, pickNext(s, "TRANSFER_TO_AGENT"), out);
}

export function triggerTransfer(s, reason, out) {
  if (s.flags.transfer_failed[reason]) return false;       // no second transfer for the same reason
  s.flags.transfer_reason = reason;
  if (!(reason === "open_ticket" && s.flags.resume_state)) s.flags.resume_state = s.state;
  enter(s, "TRANSFER_TO_AGENT", out);
  return true;
}

// ---- asking ---------------------------------------------------------------------
const firstMissing = (s, name) => STATES[name].required_slots.find((k) => !isFilled(s.slots[k]));

function questionText(s, name, mode) {
  const cfg = STATES[name], phase = s.phase[name];
  s.asking_slot = null;
  if (phase === "confirm" && cfg.confirm_template) return render(s, cfg.confirm_template);
  if (phase === "alternate" && cfg.alternate_ask_template) return render(s, cfg.alternate_ask_template);
  if (mode === "reask" && cfg.reask_state) return questionText(s, cfg.reask_state, "first");
  if (cfg.spoken_once && s.spoken[name] && cfg.followup_template) return render(s, cfg.followup_template);
  const miss = firstMissing(s, name);
  const anyFilled = cfg.required_slots.some((k) => isFilled(s.slots[k]));
  if (cfg.slot_followups?.[miss] && (mode === "followup" || mode === "retry" || (mode === "first" && anyFilled))) {
    s.asking_slot = miss;
    return render(s, cfg.slot_followups[miss]);
  }
  if (miss) s.asking_slot = miss;
  if (mode === "retry" && cfg.recovery_template) return render(s, cfg.recovery_template);
  if (cfg.reply_template || cfg.reply_template_variants) return render(s, pickTemplate(s, cfg));
  return "";                                    // some states are intentionally silent
}

export function ask(s, name, out, { mode = "first" } = {}) {
  const cfg = STATES[name];
  const phase = s.phase[name];
  if (phase === "alternate") runTools(s, cfg, "before_asking_alternate_number");
  if (!phase || phase === "ask") runTools(s, cfg, "before_asking");
  if (cfg.flow === "dictation_choice" && !phase) s.phase[name] = "choice";
  if (cfg.flow === "dictation" && !phase) s.phase[name] = "ask";
  const text = questionText(s, name, mode);
  if (text) out.push(text);
  s.spoken[name] = true;
  s.asked_mode = mode;
  if (isEnding(cfg)) s.flags.terminal = true;
}

// ---- retries / exhaustion ---------------------------------------------------------
export function failAttempt(s, name, out, reason = "unrecognised") {
  const cfg = STATES[name];
  const used = (s.retries[name] = (s.retries[name] || 0) + 1);
  s.invalid_streak++;
  ev(s, "retry", { state: name, used: Math.min(used, maxRetries(cfg)), max: maxRetries(cfg), reason, streak: s.invalid_streak });
  if (s.invalid_streak >= META.max_total_invalid) { ev(s, "give_up", { streak: s.invalid_streak }); return giveUp(s, out); }
  if (used > maxRetries(cfg)) return exhaust(s, name, out);
  ask(s, name, out, { mode: "retry" });
}

function giveUp(s, out) {
  s.invalid_streak = 0;
  if (!triggerTransfer(s, "unsupported_request", out)) { if (s.flags.slow_input_active) callTool(s, "manage_call_settings", { action: "finalize_slow_input", reason: "giving up" }); enter(s, "RATING_GATE", out); }
}

const STRATEGIES = {
  store_as_Other(s, name, out) { s.slots.caller_type = "other"; return leave(s, name, out); },
  store_best_plausible_and_continue(s, name, out, ctx) {
    if (ctx.missing === "last_name") s.slots.last_name = s.slots.first_name || "NA";
    else if (ctx.missing) s.slots[ctx.missing] = nameTokens(ctx.raw)[0] || "NA";
    return leave(s, name, out);
  },
  store_as_heard_and_lock(s, name, out, ctx) {
    if (ctx.missing) s.slots[ctx.missing] = SLOTS[ctx.missing]?.exhaust_default ?? (ctx.heard === "NA" ? "NA" : ctx.heard.toLowerCase());
    return leave(s, name, out);
  },
  map_closest_candidate_else_NA(s, name, out, ctx) {
    const guess = fallbackCapture(ctx.raw, {}, [{ name: "brand", type: "enum", expected: true }]);
    s.slots.brand = guess.brand || "NA";
    return leave(s, name, out);
  },
  skip_and_continue(s, name, out) { ON_LEAVE[STATES[name].on_leave]?.(s, STATES[name]); return leave(s, name, out); },
};

function exhaust(s, name, out) {
  const cfg = STATES[name], raw = s.lastRaw || "";
  const heard = String(raw).replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  ev(s, "exhausted", { state: name, action: cfg.on_exhausted || "default" });
  const ctx = { raw, missing: firstMissing(s, name), heard: heard ? titleCase(heard).slice(0, 60) : "NA" };
  if (STRATEGIES[cfg.on_exhausted]) return STRATEGIES[cfg.on_exhausted](s, name, out, ctx);
  if (s.flags.slow_input_active) callTool(s, "manage_call_settings", { action: "finalize_slow_input", reason: "retries exhausted" });
  if (cfg.exhaust_defaults) { Object.assign(s.slots, cfg.exhaust_defaults); return leave(s, name, out); }
  s.jump = null;
  return enter(s, STATES[cfg.on_exhausted] ? cfg.on_exhausted : "RATING_GATE", out);
}

// ---- number dictation (service number / contact number) ----------------------------
const dictSlot = (cfg) => cfg.required_slots[0];

function handleDictation(s, name, ex, out) {
  const cfg = STATES[name], slot = dictSlot(cfg);
  const digits = normalizeMobile(ex.digits);
  s.digits_heard = digits;
  const lookup = (cfg.tools || []).some((t) => t.when === "after_each_dictation");
  if (lookup) {
    let r = runTools(s, cfg, "after_each_dictation")[0]?.result;
    if (r?.status === "CRM_LOOKUP_ERROR") r = runTools(s, cfg, "after_each_dictation")[0]?.result;
    s.flags.lookup_result = r?.status ?? null;
    if (["INVALID_PHONE", "CRM_LOOKUP_ERROR"].includes(r?.status)) { delete s.slots[slot]; s.phase[name] = "ask"; return failAttempt(s, name, out, "invalid_number"); }
    s.candidate_customer = r.status === "CUSTOMER_FOUND" ? r.customer : null;
    s.candidate_resume = r.resume || null;
  } else if (!validMobile(digits)) { delete s.slots[slot]; s.phase[name] = "alternate"; return failAttempt(s, name, out, "invalid_number"); }
  s.slots[slot] = digits;
  s.phase[name] = "confirm";
  ask(s, name, out);
}

function confirmDictation(s, name, ex, out) {
  const cfg = STATES[name], slot = dictSlot(cfg);
  const lookup = (cfg.tools || []).some((t) => t.when === "after_each_dictation");
  if (ex.digits.length >= 6) return handleDictation(s, name, ex, out);        // corrected number
  if (ex.yn === "yes") {
    runTools(s, cfg, "after_confirmation");
    if (lookup) {
      s.flags.number_confirmed = true;
      s.slots.final_service_number = s.slots[slot];
      if (s.flags.lookup_result === "CUSTOMER_FOUND") Object.assign(s.flags, { customer_record_exists: true, new_customer_context: false }), s.customer_data = s.candidate_customer || {};
      else becomeNewCustomer(s);
      if (s.candidate_resume) { for (const [k, v] of Object.entries(s.candidate_resume)) if (!isFilled(s.slots[k])) s.slots[k] = v; s.flags.resumed_previous = true; }
    }
    return leave(s, name, out);
  }
  if (ex.yn === "no") {
    delete s.slots[slot]; s.flags.number_confirmed = false;
    s.phase[name] = lookup ? "ask" : "alternate";
    return failAttempt(s, name, out, "rejected_number");
  }
  return ex.soft ? ask(s, name, out, { mode: "reask" }) : failAttempt(s, name, out, "no_yes_no");
}

// ---- resolving the caller's reply against the current state ---------------------------
function isResolved(s, name, ex) {
  const cfg = STATES[name];
  if (cfg.resolves_on_any_reply) return isFilled(ex.slots.call_rating) || ex.yn === "no" || !!ex.declined;
  return cfg.required_slots.every((k) => isFilled(s.slots[k]));
}

export function resolveCurrent(s, ex, out) {
  const name = s.state, cfg = STATES[name];
  s.lastRaw = ex.raw;
  const reask = () => ask(s, name, out, { mode: "reask" });

  if (cfg.flow === "dictation" || cfg.flow === "dictation_choice") {
    const phase = s.phase[name] || (cfg.flow === "dictation" ? "ask" : "choice");
    if (phase === "confirm") return confirmDictation(s, name, ex, out);
    if (ex.digits.length >= (cfg.flow === "dictation" ? 1 : 6)) return handleDictation(s, name, ex, out);
    if (phase === "choice") {
      if (ex.yn === "yes") {
        s.slots[dictSlot(cfg)] = interp(s, cfg.default_value);
        if (s.flags.slow_input_active) runTools(s, cfg, "after_confirmation");
        return leave(s, name, out);
      }
      if (ex.yn === "no") { s.phase[name] = "alternate"; return ask(s, name, out); }
    }
    if (ex.fresh) return ask(s, name, out);
    return ex.soft ? reask() : failAttempt(s, name, out, "no_digits");
  }

  if (cfg.flow === "readback_confirm") {
    const group = SLOTS[cfg.required_slots[0]]?.group;
    const changed = ex.changed.some((k) => SLOTS[k]?.group === group && k !== cfg.required_slots[0]);
    const ok = s.slots[cfg.required_slots[0]];
    if (ok === true && !changed) { ON_LEAVE[cfg.on_leave]?.(s, cfg); return leave(s, name, out); }
    if (ok === false || changed) {
      const used = (s.retries[name] = (s.retries[name] || 0) + 1);
      ev(s, "retry", { state: name, used: Math.min(used, maxRetries(cfg)), max: maxRetries(cfg), reason: "address_rejected" });
      if (used > maxRetries(cfg)) return exhaust(s, name, out);
      const complete = STATES.ADDRESS_COLLECT.required_slots.every((k) => isFilled(s.slots[k]));
      delete s.slots[cfg.required_slots[0]];
      if (changed && complete) return ask(s, name, out);                 // correction supplied: read back once more
      for (const k of STATES.ADDRESS_COLLECT.required_slots) if (!changed) delete s.slots[k];   // bare "no": re-collect
      return enter(s, "ADDRESS_COLLECT", out);
    }
    return ex.soft ? reask() : failAttempt(s, name, out, "no_yes_no");
  }

  if (isResolved(s, name, ex)) { ON_LEAVE[cfg.on_leave]?.(s, cfg); return leave(s, name, out); }
  if (ex.progress > 0) return ask(s, name, out, { mode: "followup" });      // partial answer: ask only what is missing
  if (ex.fresh || ex.soft) return ask(s, name, out, { mode: ex.fresh ? "first" : "reask" });
  return failAttempt(s, name, out, ex.invalidReason || "no_slot_found");
}

export { ON_LEAVE, firstMissing };