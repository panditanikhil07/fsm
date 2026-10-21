// One caller turn = LLM #1 classify  ->  structural actions (transfer / end / lane jump)
//                 -> LLM #2 capture slots  ->  FSM  ->  LLM #3 writes the whole spoken reply.
// states.json templates are rendered by the FSM but only used as reference wording for LLM #3.
import { performance } from "node:perf_hooks";
import { config } from "../config.js";
import { META, STATES, SLOTS, GROUPS } from "../script/index.js";
import { classify } from "../llm/classifier.js";
import { captureSlots, composeReply, slotSpecs } from "../llm/capture.js";
import { sanitizeCaptured } from "./slots.js";
import { digitsFrom } from "../utils/digits.js";
import { yesNo } from "../utils/yesno.js";
import { isFilled, round } from "../utils/text.js";
import { addressOptions } from "./render.js";
import { enter, wants, resolveCurrent, triggerTransfer, beginJump, becomeNewCustomer } from "./flow.js";
import { planJumps } from "./jump.js";
import { buildTasks, postCaptureTasks, fallbackLead, infoReplies, actionOf } from "./intents.js";
import { ev } from "./events.js";
import { finalizeCall } from "../store/customerStore.js";
import { withLock } from "../utils/mutex.js";

const SOFT_ACTIONS = new Set(["smalltalk", "wait", "repeat", "recall", "info", "update"]);
const SKIPPED_CAPTURE = { slots: {}, rejected: [], source: "skipped", ms: 0, usage: null, prompt_input: null };

/* ================================================================== */
/* Small pure helpers                                                  */
/* ================================================================== */
// Drop only exact (normalised) repeats; segments are never merged into one sentence.
const squash = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

const uniqSegments = (parts) => {
  const seen = new Set();
  return parts.filter((p) => {
    const key = p && squash(p);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const segmentsOf = (reply) => (reply.text ? [reply.text] : []);
const classificationOf = (cls) => ({ intents: cls.intents, classification: cls });

const captureInfo = (cap) => ({
  source: cap.source,
  slots: cap.slots,
  rejected: cap.rejected || [],
  ms: cap.ms,
  usage: cap.usage || null,
  prompt_input: cap.prompt_input ?? null,
});

const replyInfo = (r) =>
  r && {
    source: r.source,
    text: r.text,
    error: r.error,
    ms: r.ms,
    usage: r.usage || null,
    prompt_input: r.prompt_input ?? null,
  };

const retryInfo = (s) => {
  const max = STATES[s.state].max_retries ?? META.default_max_retries;
  return { state: s.state, used: Math.min(s.retries[s.state] || 0, max), max };
};

/* ================================================================== */
/* Context handed to the LLM calls                                     */
/* ================================================================== */
const buildContext = (s) => {
  const expected = [...wants(STATES[s.state], s)].filter((k) => SLOTS[k]);
  const part = (k) => s.slots[k] ?? s.customer_data?.[k];
  return {
    state: s.state,
    lane: s.lane,
    language: s.language,
    pending_question: s.last_reply,
    expected_slots: expected,
    asking_slot: s.asking_slot,
    retries_used: s.retries[s.state] || 0,
    filled_slots: Object.fromEntries(
      Object.entries(s.slots).filter(([k, v]) => isFilled(v) && SLOTS[k]?.speak !== false)
    ),
    registered: !!s.flags.complaint_registered,
    new_customer: !!s.flags.new_customer_context,
    caller_name: [part("first_name"), part("last_name")].filter(Boolean).join(" "),
    address_options: addressOptions(s),
    recent: s.history.slice(-3).map(({ user, assistant }) => ({ user, assistant })),
  };
};

/* ================================================================== */
/* Slot application                                                    */
/* ================================================================== */
const mayOverwrite = (s, k) => {
  const def = SLOTS[k];
  const want = wants(STATES[s.state], s);
  const groupHere = def.group && [...want].some((x) => SLOTS[x]?.group === def.group);
  return want.has(k) || groupHere || !!GROUPS[def.group]?.inline || !!s.jump?.slots.includes(k);
};

// Why a captured slot must not be applied: null = apply, { silent } = skip quietly, { why } = skip and log.
const skipReason = (s, k, v, want) => {
  const def = SLOTS[k];
  if (!def || def.type === "digits") return { silent: true };   // dictated numbers go through the FSM (lookup + read-back)
  if (def.prefill === false && !want.has(k)) return { silent: true };

  const flag = GROUPS[def.group]?.requires_flag;
  if (flag && !s.flags[flag] && !want.has(k)) return { why: flag };

  const cur = s.slots[k];
  if (isFilled(cur) && cur === v) return { silent: true };
  if (isFilled(cur) && !mayOverwrite(s, k)) return { why: "already set" };
  return null;
};

// Side effects of particular slots (language switch, identity rejection).
const onSlotSet = (s, k, v) => {
  if (k === "language") {
    if (v === "hindi" || v === "english") s.language = v;
    s.flags.language_unsupported = v === "other";
  }
  if (k === "identity_confirmed" && v === false) becomeNewCustomer(s);
};

// Fill empties anywhere (future steps); overwrite only what the current step / an active jump is about.
// Whether a value was "stated explicitly" is the capture LLM's job, not a keyword check here.
const applySlots = (s, captured, ex) => {
  const want = wants(STATES[s.state], s);

  for (const [k, v] of Object.entries(captured)) {
    const skip = skipReason(s, k, v, want);
    if (skip) {
      if (skip.why) ev(s, "slot_ignored", { slot: k, why: skip.why });
      continue;
    }

    const asked = want.has(k) || s.jump?.slots.includes(k);
    s.slots[k] = v;
    ex.slots[k] = v;
    ex.changed.push(k);
    if (asked) ex.gained++;
    else ex.volunteered++;
    ev(s, "slot_set", { slot: k, value: v, via: want.has(k) ? "asked" : "volunteered" });
    onSlotSet(s, k, v);
  }
};

// A yes/no answers every unfilled boolean slot the current step asks for.
const applyYesNo = (s, ex) => {
  if (!ex.yn) return;
  for (const k of wants(STATES[s.state], s)) {
    if (SLOTS[k]?.type === "boolean" && !isFilled(s.slots[k]) && !(k in ex.slots)) {
      applySlots(s, { [k]: ex.yn === "yes" }, ex);
    }
  }
};

/* ================================================================== */
/* Flow helpers                                                        */
/* ================================================================== */
const endCall = (s, out) => {
  if (s.flags.Rating_Asked || s.flags.Rating_Resolved) {
    s.flags.Rating_Resolved = true;
    if (!isFilled(s.slots.call_rating)) s.slots.call_rating = "not_given";
    return enter(s, "CLOSING", out);
  }
  return enter(s, "RATING_GATE", out); // ask the rating once, then close
};

const startJumps = (s, plan) => {
  if (plan.specs.length) beginJump(s, plan.specs[0], s.jump?.resume ?? s.state, plan.specs.slice(1));
};

// Plans lane jumps for `targets`. Returns true when the plan ended in a transfer (caller should exit the turn).
const planAndJump = (s, targets, out) => {
  const plan = planJumps(s, targets);
  if (plan.transfer && triggerTransfer(s, plan.transfer, out)) return true;
  startJumps(s, plan);
  return false;
};

// Structural actions that bypass slot capture. Returns true when the turn is finished (transfer / end call).
const runStructuralActions = (s, cls, out) => {
  const transferIntent = cls.intents.find((i) => actionOf(i).type === "transfer");
  const wantsOtherLanguage = cls.language === "other" && s.state !== "OPENING";

  if (transferIntent || wantsOtherLanguage) {
    const action = actionOf(transferIntent);
    if (action.set) Object.assign(s.flags, action.set);
    if (triggerTransfer(s, transferIntent ? action.reason : "unsupported_language", out)) return true;
  }

  if (cls.intents.includes("end_call") && !cls.intents.includes("answer")) {
    endCall(s, out);
    return true;
  }

  return cls.intents.includes("update") && planAndJump(s, cls.update_targets, out);
};

// Caller restated a filled detail with a DIFFERENT value outside the step that owns it.
const implicitUpdateTargets = (s, capSlots, ctx) => {
  const vals = sanitizeCaptured(capSlots, ctx);
  return Object.keys(vals).filter(
    (k) => isFilled(s.slots[k]) && s.slots[k] !== vals[k] && SLOTS[k].type !== "digits" && !mayOverwrite(s, k)
  );
};

/* ================================================================== */
/* Turn record                                                         */
/* ================================================================== */
const resetTurnState = (s) => {
  s.events = [];
  s.turn_path = [];
  s.depth = 0;
  s.freshEntry = null;
  s.metrics.tool_ms = 0;
  s.last_active = Date.now();
};

const buildTurnRecord = (s, { text, before, parts, ms, extra }) => ({
  turn: s.metrics.turns,
  user: text || "(silence)",
  assistant: parts.join("\n"),
  segments: parts,
  from_state: before.state,
  to_state: s.state,
  lane_from: before.lane,
  lane: s.lane,
  lane_changed: before.lane !== s.lane,
  path: [...s.turn_path],
  extracted: extra.extracted || {},
  intents: extra.intents || [],
  events: s.events,
  classification: extra.classification || null,
  capture: extra.capture || null,
  respond: replyInfo(extra.respond),
  retry: retryInfo(s),
  jump: s.jump ? { group: s.jump.group, resume: s.jump.resume } : null,
  latency_ms: round(ms),
  prompt_input: {
    classifier: extra.classification?.prompt_input ?? null,
    slot_capture: extra.capture?.prompt_input ?? null,
    response_builder: extra.respond?.prompt_input ?? null,
  },
});

const makeFinisher = (s, ctx) => async (parts, extra = {}) => {
  const ms = performance.now() - ctx.t0;
  s.metrics.turns++;
  s.metrics.last_turn_ms = round(ms);
  s.metrics.total_ms = round(s.metrics.total_ms + ms);
  s.last_reply = parts.join("\n");

  const item = buildTurnRecord(s, { ...ctx, parts, ms, extra });
  s.history.push(item);

  if (s.flags.terminal) {
    const persisted = await finalizeCall(s, "terminal");
    ev(s, "persisted", { outcome: persisted.outcome, files: persisted.saved });
  }
  return item;
};

/* ================================================================== */
/* LLM stages                                                          */
/* ================================================================== */
const logFallback = (s, call, result) => ev(s, "llm_fallback", { call, error: result.error });

const runClassify = async (s, text, ctx) => {
  const cls = await classify(text, ctx);
  s.metrics.classify_ms = cls.ms;
  s.llm.classifier = cls;
  if (cls.source === "fallback") logFallback(s, "classifier", cls);
  cls.intents.forEach((id) => ev(s, "intent", { id, type: actionOf(id).type }));
  return cls;
};

// Every spoken reply goes through here. mustSay / hints are reference wording, never spoken as-is
// (except as a last-resort fallback inside composeReply if the LLM fails or drops a fact).
const makeSpeaker = (s, { text, cls }) => async ({ mustSay = [], hints = [], tasks = [], result = {} }) => {
  const reply = await composeReply({
    text,
    ctx: buildContext(s), // context AFTER the FSM moved, so the writer sees the new state
    tasks, result, mustSay, hints,
    classification: cls,
    language: s.language,
    terminal: !!s.flags.terminal,
    previousReply: s.last_reply,
  });
  s.metrics.respond_ms = reply.ms;
  s.llm.respond = reply;
  if (reply.source === "fallback") logFallback(s, "respond", reply);
  return reply;
};

const runCapture = async (s, { text, cls, ctx, expected, tasks }) => {
  let cap = SKIPPED_CAPTURE;
  if (expected.length || tasks.length) {
    cap = await captureSlots({
      text,
      ctx: { ...ctx, asking_slot: s.asking_slot },
      specs: slotSpecs(expected, ctx),
      classification: cls,
    });
    if (cap.source === "fallback" || cap.source === "llm_failed") logFallback(s, "capture", cap);
  }
  if (cap.rejected?.length) ev(s, "slots_rejected", { slots: cap.rejected });
  return cap;
};

/* ================================================================== */
/* One turn                                                            */
/* ================================================================== */
async function runTurn(s, rawText) {
  const t0 = performance.now();
  const text = String(rawText ?? "").slice(0, config.maxInputChars).trim();
  const before = { state: s.state, lane: s.lane };
  resetTurnState(s);

  const finish = makeFinisher(s, { text, before, t0 });
  if (s.flags.terminal) return finish([]);

  // ---------------- LLM #1: classify ----------------
  const ctx0 = buildContext(s);
  const cls = await runClassify(s, text, ctx0);
  const speak = makeSpeaker(s, { text, cls });

  const f0 = performance.now();
  const out = [];

  // Early exits (transfer / end call) are written by the LLM too, with the rendered template as reference.
  const exitEarly = async (extra = {}) => {
    s.metrics.fsm_ms = round(performance.now() - f0);
    const respond = await speak({ mustSay: uniqSegments(out) });
    return finish(segmentsOf(respond), { ...classificationOf(cls), respond, ...extra });
  };

  if (runStructuralActions(s, cls, out)) return exitEarly();

  // ---------------- LLM #2: capture slots ONLY ----------------
  const ctx = s.state === before.state ? ctx0 : buildContext(s); // rebuild only if a structural action moved the FSM
  const expected = ctx.expected_slots.filter((k) => SLOTS[k].type !== "digits");
  const tasks = buildTasks(s, cls, { expectsAnswer: expected.length > 0 });
  const isAnswer = cls.intents.includes("answer");
  // true when the caller is answering a pending question and no other intent task applies
  const awaitingAnswer = expected.length > 0 && !tasks.length && isAnswer;

  let cap = await runCapture(s, { text, cls, ctx, expected, tasks });

  // Slots only count when the classifier judged the utterance an answer (or an update).
  const usable = isAnswer || cls.intents.includes("update");
  if (!usable && Object.keys(cap.slots).length) {
    ev(s, "slots_discarded", { slots: Object.keys(cap.slots), why: "classifier: not an answer" });
    cap = { ...cap, slots: {} };
  }
  s.metrics.capture_ms = cap.ms;
  s.llm.capture = cap;

  // Implicit update: restated filled detail outside the step that owns it.
  if (usable && !cls.intents.includes("update") && !s.jump) {
    const diff = implicitUpdateTargets(s, cap.slots, ctx);
    if (diff.length) {
      ev(s, "implicit_update", { slots: diff });
      if (planAndJump(s, diff, out)) return exitEarly({ capture: captureInfo(cap) });
    }
  }

  // ---------------- apply + FSM ----------------
  // yes/no comes from the classifier; the keyword lexicon is only a fallback when the LLM call itself failed.
  const yn = usable ? cls.yes_no ?? (cls.source === "llm" ? null : yesNo(text)) : null;
  const ex = {
    raw: text, digits: digitsFrom(text), yn,
    slots: {}, changed: [], gained: 0, volunteered: 0, fresh: s.freshEntry === s.state,
  };

  const lang = cls.language && cls.language !== "other" ? { language: cls.language } : {};
  const previousLanguage = s.language;
  applySlots(s, sanitizeCaptured({ ...cap.slots, ...lang }, ctx), ex);
  applyYesNo(s, ex);

  const languageSwitched = !!lang.language && s.language !== previousLanguage;
  ex.progress = ex.gained + ex.volunteered;
  if (languageSwitched) {
    tasks.push({ type: "language_switch", language: s.language, note: "Confirm briefly that you will continue in this language." });
  }

  const invalid = cls.intents.map(actionOf).find((a) => a.type === "invalid");
  ex.soft = languageSwitched || (!ex.progress && !invalid && cls.intents.some((i) => SOFT_ACTIONS.has(actionOf(i).type)));
  ex.invalidReason = invalid?.reason;
  if (ex.progress) s.invalid_streak = 0;

  // The reply writer answers info questions itself, so the template info line is skipped when an answer task exists.
  const llmAnswers = tasks.some((t) => t.type === "answer_question");
  const info = infoReplies(s, cls, llmAnswers);
  if (info.length || tasks.some((t) => ["recall", "update"].includes(t.type))) {
    ex.soft ||= !ex.progress && !invalid;
  }

  const sceneOut = [];
  resolveCurrent(s, ex, sceneOut);
  s.metrics.fsm_ms = round(performance.now() - f0 - cap.ms);

  // ---------------- LLM #3: write the whole reply ----------------
  const outcomeTasks = postCaptureTasks(ex, awaitingAnswer, invalid); // tasks that depend on what capture found
  const retried = s.events.some((e) => e.type === "retry");

  // Old scripted lead lines become optional wording for the writer instead of being spoken directly.
  const needsInvalidHint = !ex.progress && (retried || (awaitingAnswer && !ex.soft && !ex.fresh));
  const hints = tasks.length
    ? [fallbackLead(s, tasks, cls)]
    : needsInvalidHint
      ? [fallbackLead(s, [{ type: "invalid", reason: ex.invalidReason || "nonsense" }], cls)]
      : [];

  const respond = await speak({
    mustSay: uniqSegments([...info, ...sceneOut]), // rendered states.json templates = reference, not output
    hints: uniqSegments(hints),
    tasks: [...tasks, ...outcomeTasks],
    result: {
      progress: ex.progress > 0,
      slots_saved: ex.slots,
      invalid_reason: ex.invalidReason ?? null,
      retried,
      language_switched: languageSwitched,
    },
  });

  return finish(segmentsOf(respond), {
    ...classificationOf(cls),
    extracted: { ...ex.slots, ...(ex.yn && { _yn: ex.yn }), ...(ex.digits && { _digits: ex.digits }) },
    capture: captureInfo(cap),
    respond,
  });
}

export const handleTurn = (s, text) => withLock(s.id, () => runTurn(s, text));