// One caller turn = LLM #1 classify  ->  structural actions (transfer / end / lane jump)
//                 -> LLM #2 capture slots + write lead  ->  FSM  ->  lead + scripted question.
import { performance } from "node:perf_hooks";
import { config } from "../config.js";
import { META, STATES, SLOTS, GROUPS, INTENTS, loc } from "../script/index.js";
import { hasWord } from "../utils/text.js";
import { classify } from "../llm/classifier.js";
import { captureAndRespond, slotSpecs } from "../llm/capture.js";
import { sanitizeCaptured } from "./slots.js";
import { digitsFrom } from "../utils/digits.js";
import { splitFullName, surnameAfter } from "../utils/names.js";
import { yesNo, isBareYesNo } from "../utils/yesno.js";
import { repairAddress, ADDRESS_KEYS } from "../utils/address.js";
import { isFilled, round } from "../utils/text.js";
import { addressOptions } from "./render.js";
import { enter, ask, wants, resolveCurrent, triggerTransfer, beginJump, becomeNewCustomer } from "./flow.js";
import { planJumps } from "./jump.js";
import { buildTasks, fallbackLead, infoReplies, actionOf } from "./intents.js";
import { ev } from "./events.js";
import { finalizeCall } from "../store/customerStore.js";
import { withLock } from "../utils/mutex.js";

const SOFT = new Set(["smalltalk", "wait", "repeat", "recall", "info", "update"]);

function buildContext(s) {
  const cfg = STATES[s.state];
  const expected = [...wants(cfg, s)].filter((k) => SLOTS[k]);
  const opts = addressOptions(s);
  return {
    state: s.state, lane: s.lane, language: s.language,
    pending_question: s.last_reply, expected_slots: expected, asking_slot: s.asking_slot, retries_used: s.retries[s.state] || 0,
    filled_slots: Object.fromEntries(Object.entries(s.slots).filter(([k, v]) => isFilled(v) && SLOTS[k]?.speak !== false)),
    registered: !!s.flags.complaint_registered, new_customer: !!s.flags.new_customer_context,
    caller_name: [s.slots.first_name ?? s.customer_data.first_name, s.slots.last_name ?? s.customer_data.last_name].filter(Boolean).join(" "),
    address_options: opts,
    recent: s.history.slice(-3).map((h) => ({ user: h.user, assistant: h.assistant })),
  };
}

function mayOverwrite(s, k) {
  const def = SLOTS[k], want = wants(STATES[s.state], s);
  const groupHere = [...want].some((x) => SLOTS[x]?.group && SLOTS[x].group === def.group);
  return want.has(k) || groupHere || !!GROUPS[def.group]?.inline || !!s.jump?.slots.includes(k);
}

// Fill empties anywhere (future steps); overwrite only what the current step / an active jump is about.
const mentions = (text, words) => words.some((w) => hasWord(text, String(w).toLowerCase()));

function applySlots(s, captured, ex) {
  const want = wants(STATES[s.state], s);
  for (const [k, v] of Object.entries(captured)) {
    const def = SLOTS[k], cur = s.slots[k];
    if (def.type === "digits") continue;                                  // dictated numbers go through the FSM (lookup + read-back)
    if (def.prefill === false && !want.has(k)) continue;
    // e.g. address_type: "house" inside an address is not the caller saying the place is residential
    if (def.explicit_when_volunteered && !want.has(k) && !s.jump?.slots.includes(k) && !mentions(String(ex.raw).toLowerCase(), def.explicit_when_volunteered)) { ev(s, "slot_ignored", { slot: k, why: "not stated explicitly" }); continue; }
    const g = GROUPS[def.group];
    if (g?.requires_flag && !s.flags[g.requires_flag] && !want.has(k)) { ev(s, "slot_ignored", { slot: k, why: g.requires_flag }); continue; }
    const may = mayOverwrite(s, k);
    if (isFilled(cur) && cur === v) continue;
    if (isFilled(cur) && !may) { ev(s, "slot_ignored", { slot: k, why: "already set" }); continue; }
    s.slots[k] = v;
    ex.slots[k] = v;
    ex.changed.push(k);
    if (want.has(k) || s.jump?.slots.includes(k)) ex.gained++; else ex.volunteered++;
    ev(s, "slot_set", { slot: k, value: v, via: want.has(k) ? "asked" : "volunteered" });
    if (k === "language") {
      if (v === "hindi" || v === "english") s.language = v;
      s.flags.language_unsupported = v === "other";
    }
    if (k === "identity_confirmed" && v === false) becomeNewCustomer(s);
  }
}

const dedupe = (parts) => { const seen = new Set(); return parts.filter((x) => x && !seen.has(x) && seen.add(x)); };

// A language claim from the classifier only counts if the caller actually names that language.
// (Models over-detect "other" on short address fragments like "ph-4 ug-6 sec2a vasundhara".)
function languageNamed(text, language) {
  const def = SLOTS.language, words = [language, ...(def.synonyms?.[language] || [])];
  return words.some((w) => hasWord(text, String(w).toLowerCase()) || text.includes(w));
}

function endCall(s, out) {
  if (s.flags.Rating_Asked || s.flags.Rating_Resolved) {
    s.flags.Rating_Resolved = true;
    if (!isFilled(s.slots.call_rating)) s.slots.call_rating = "not_given";
    return enter(s, "CLOSING", out);
  }
  return enter(s, "RATING_GATE", out);          // ask the rating once, then close
}

async function runTurn(s, rawText) {
  const t0 = performance.now();
  const text = String(rawText ?? "").slice(0, config.maxInputChars).trim();
  const before = { state: s.state, lane: s.lane };
  s.events = []; s.turn_path = []; s.depth = 0; s.freshEntry = null; s.metrics.tool_ms = 0; s.last_active = Date.now();

  const finish = async (assistant, extra = {}) => {
    const ms = performance.now() - t0;
    s.metrics.turns++; s.metrics.last_turn_ms = round(ms); s.metrics.total_ms = round(s.metrics.total_ms + ms);
    s.last_reply = assistant;
    const item = {
      turn: s.metrics.turns, user: text || "(silence)", assistant, from_state: before.state, to_state: s.state,
      lane_from: before.lane, lane: s.lane, lane_changed: before.lane !== s.lane, path: [...s.turn_path],
      extracted: extra.extracted || {}, intents: extra.intents || [], events: s.events, classification: extra.classification || null,
      capture: extra.capture || null, retry: { state: s.state, used: Math.min(s.retries[s.state] || 0, STATES[s.state].max_retries ?? META.default_max_retries), max: STATES[s.state].max_retries ?? META.default_max_retries },
      jump: s.jump ? { group: s.jump.group, resume: s.jump.resume } : null, latency_ms: round(ms),
    };
    s.history.push(item);
    if (s.flags.terminal) await finalizeCall(s, "terminal").then((p) => { ev(s, "persisted", { outcome: p.outcome, files: p.saved }); });
    return item;
  };

  if (s.flags.terminal) return finish("");

  // ---------------- LLM #1: classify ----------------
  const ctx = buildContext(s);
  const cls = await classify(text, ctx);
  if (cls.language && !languageNamed(text, cls.language)) { ev(s, "language_claim_ignored", { claimed: cls.language }); cls.language = null; }
  s.metrics.classify_ms = cls.ms; s.llm.classifier = cls;
  if (cls.source === "fallback") ev(s, "llm_fallback", { call: "classifier", error: cls.error });
  for (const id of cls.intents) ev(s, "intent", { id, type: actionOf(id).type });

  const f0 = performance.now();
  const out = [];
  const transferIntent = cls.intents.find((i) => actionOf(i).type === "transfer");
  const wantsOther = cls.language === "other" && s.state !== "OPENING";

  // ---- structural actions that bypass slot capture ----
  if (transferIntent || wantsOther) {
    const a = actionOf(transferIntent);
    if (a.set) Object.assign(s.flags, a.set);
    if (triggerTransfer(s, wantsOther && !transferIntent ? "unsupported_language" : a.reason, out)) {
      s.metrics.fsm_ms = round(performance.now() - f0);
      return finish(dedupe(out).join(" "), { intents: cls.intents, classification: cls });
    }
  }
  if (cls.intents.includes("end_call") && !cls.intents.includes("answer")) {
    endCall(s, out);
    s.metrics.fsm_ms = round(performance.now() - f0);
    return finish(dedupe(out).join(" "), { intents: cls.intents, classification: cls });
  }
  if (cls.intents.includes("update")) {
    const plan = planJumps(s, cls.update_targets);
    if (plan.transfer && triggerTransfer(s, plan.transfer, out)) {
      s.metrics.fsm_ms = round(performance.now() - f0);
      return finish(dedupe(out).join(" "), { intents: cls.intents, classification: cls });
    }
    if (plan.specs.length) beginJump(s, plan.specs[0], s.jump?.resume ?? s.state, plan.specs.slice(1));
  }

  // ---------------- LLM #2: capture slots + write lead ----------------
  const ctx2 = s.state === before.state ? ctx : buildContext(s);
  let cfg = STATES[s.state];
  const expectedAll = ctx2.expected_slots;
  const expectedNonDigit = expectedAll.filter((k) => SLOTS[k].type !== "digits");
  const tasks = buildTasks(s, cls, { expectsAnswer: expectedNonDigit.length > 0 });
  // A bare "yes" / "no" / "haan" to an either/or question ("Hindi or English?", "residential or commercial?",
  // "this number or a different one?") does not pick an option. Never let it fill a slot; ask the caller to choose.
  const wantNow = wants(cfg, s);
  const bareYN = isBareYesNo(text);
  const choiceQuestion = bareYN && !cfg.flow && !cfg.resolves_on_any_reply
    && ![...wantNow].some((k) => SLOTS[k]?.type === "boolean")
    && expectedNonDigit.some((k) => ["enum", "choice"].includes(SLOTS[k].type))
    && !cls.intents.some((i) => ["transfer", "info", "recall", "update", "repeat", "wait", "end_call"].includes(actionOf(i).type));
  let cap = { slots: {}, lead: "", source: "skipped", ms: 0 };
  if (choiceQuestion) { ev(s, "yes_no_to_choice", { state: s.state }); cap.source = "rule"; }
  else if (expectedNonDigit.length || tasks.length) {
    cap = await captureAndRespond({ text, ctx: { ...ctx2, asking_slot: s.asking_slot }, specs: slotSpecs(expectedNonDigit, ctx2), tasks, classification: cls, language: s.language });
    if (cap.source === "fallback") ev(s, "llm_fallback", { call: "capture", error: cap.error });
  }
  if (cap.rejected?.length) ev(s, "slots_rejected", { slots: cap.rejected });
  // a bare yes/no can only answer a boolean question
  if (bareYN) {
    const keep = Object.fromEntries(Object.entries(cap.slots).filter(([k]) => SLOTS[k]?.type === "boolean"));
    if (Object.keys(keep).length !== Object.keys(cap.slots).length) { ev(s, "slots_discarded", { slots: Object.keys(cap.slots).filter((k) => !(k in keep)), why: "bare yes/no is not a choice" }); cap = { ...cap, slots: keep }; }
  }
  // slots only count when the classifier judged the utterance an answer (or an update)
  const usable = cls.intents.includes("answer") || cls.intents.includes("update");
  if (!usable && Object.keys(cap.slots).length) { ev(s, "slots_discarded", { slots: Object.keys(cap.slots), why: "classifier: not an answer" }); cap = { ...cap, slots: {} }; }
  // address fields: fix a street that swallowed the city / pin, and fill fields the model left out ("house 45, sector 62, noida ...")
  // (at the read-back step any field may be corrected: "no, the city is Ghaziabad")
  const addrExpected = STATES[s.state].flow === "readback_confirm" ? ADDRESS_KEYS : [...wantNow].filter((k) => ADDRESS_KEYS.includes(k));
  if (usable && !bareYN && addrExpected.length && !choiceQuestion) {
    const fixed = repairAddress(cap.slots, text, { expected: addrExpected });
    const delta = Object.keys(fixed).filter((k) => fixed[k] !== cap.slots[k]);
    if (delta.length) { ev(s, "address_repaired", { fields: delta }); cap = { ...cap, slots: fixed }; }
  }
  s.metrics.capture_ms = cap.ms; s.llm.capture = cap;

  // implicit update: the caller restated a filled detail with a DIFFERENT value outside the step that owns it
  if (usable && !cls.intents.includes("update") && !s.jump) {
    const vals = sanitizeCaptured(cap.slots, ctx2);
    const diff = Object.keys(vals).filter((k) => isFilled(s.slots[k]) && s.slots[k] !== vals[k] && SLOTS[k].type !== "digits" && !mayOverwrite(s, k));
    if (diff.length) {
      ev(s, "implicit_update", { slots: diff });
      const plan = planJumps(s, diff);
      if (plan.transfer && triggerTransfer(s, plan.transfer, out)) { s.metrics.fsm_ms = round(performance.now() - f0); return finish(dedupe(out).join(" "), { intents: cls.intents, classification: cls, capture: { source: cap.source, lead: cap.lead, slots: cap.slots, ms: cap.ms } }); }
      if (plan.specs.length) { beginJump(s, plan.specs[0], s.jump?.resume ?? s.state, plan.specs.slice(1)); cfg = STATES[s.state]; }
    }
  }

  // ---------------- apply + FSM ----------------
  const short = text.split(/\s+/).length <= 6;
  const lexYn = yesNo(text), llmYn = short ? cls.yes_no : null;
  // a plain "yes"/"haan" is certain; otherwise trust the model's reading over the keyword lexicon (e.g. "house no 45" is not a "no")
  const yn = !usable ? null : bareYN ? (lexYn ?? llmYn) : cls.source === "llm" ? (llmYn ?? lexYn) : (lexYn ?? llmYn);
  const ex = { raw: text, digits: digitsFrom(text), yn,
    slots: {}, changed: [], gained: 0, volunteered: 0, fresh: s.freshEntry === s.state };
  const lang = cls.language && cls.language !== "other" ? { language: cls.language } : {};
  const switchedFrom = s.language;
  const vals = sanitizeCaptured({ ...cap.slots, ...lang }, ctx2);
  // names: a full name must fill BOTH first_name and last_name
  if (vals.first_name && !isFilled(s.slots.last_name) && !vals.last_name) {
    const { first, rest } = splitFullName(vals.first_name);
    const last = rest || surnameAfter(text, first);
    vals.first_name = first;
    if (last) { vals.last_name = last; ev(s, "name_completed", { first_name: first, last_name: last }); }
  }
  applySlots(s, vals, ex);
  // plain yes/no answers to boolean questions
  if (ex.yn) for (const k of wants(STATES[s.state], s)) {
    if (SLOTS[k]?.type === "boolean" && !isFilled(s.slots[k]) && !(k in ex.slots)) applySlots(s, { [k]: ex.yn === "yes" }, ex);
  }
  const languageSwitched = !!lang.language && s.language !== switchedFrom;
  ex.progress = ex.gained + ex.volunteered;
  if (languageSwitched) tasks.push({ type: "language_switch", language: s.language, note: "Confirm briefly that you will continue in this language." });
  const invalid = cls.intents.map((i) => actionOf(i)).find((a) => a.type === "invalid");
  ex.soft = languageSwitched || (!ex.progress && !invalid && cls.intents.some((i) => SOFT.has(actionOf(i).type)));
  ex.invalidReason = invalid?.reason ?? (choiceQuestion && !ex.progress ? "pick_one" : undefined);
  if (ex.progress) s.invalid_streak = 0;

  const llmAnswered = !!cap.lead && cap.source === "llm" && tasks.some((t) => t.type === "answer_question");
  const info = infoReplies(s, cls, llmAnswered);
  if (info.length || tasks.some((t) => ["recall", "update"].includes(t.type))) ex.soft ||= !ex.progress && !invalid;

  const lastReply = s.last_reply;
  const sceneOut = [];
  resolveCurrent(s, ex, sceneOut);
  s.metrics.fsm_ms = round(performance.now() - f0 - cap.ms);

  // lead = LLM text, else a scripted fallback line when the turn needs one
  const conditional = tasks.filter((t) => t.type === "if_no_usable_answer");
  const real = tasks.filter((t) => t.type !== "if_no_usable_answer");
  const retried = s.events.some((e) => e.type === "retry");
  let lead = cap.lead || "";
  if (!real.length && ex.progress) lead = "";                       // happy path: scripted line only
  else if (!lead && real.length) lead = fallbackLead(s, real, cls);
  else if (!lead && (retried || (conditional.length && !ex.progress && !ex.soft && !ex.fresh)))
    lead = fallbackLead(s, [{ type: "invalid", reason: ex.invalidReason || "nonsense" }], cls);

  let assistant = dedupe([lead, ...info, ...sceneOut]).join(" ").trim();
  if (assistant && assistant === lastReply && !s.flags.terminal && STATES[s.state].recovery_template) assistant = loc(s.language, STATES[s.state].recovery_template);
  return finish(assistant, { extracted: { ...ex.slots, ...(ex.yn ? { _yn: ex.yn } : {}), ...(ex.digits ? { _digits: ex.digits } : {}) }, intents: cls.intents, classification: cls, capture: { source: cap.source, lead: cap.lead, slots: cap.slots, ms: cap.ms } });
}

export const handleTurn = (s, text) => withLock(s.id, () => runTurn(s, text));