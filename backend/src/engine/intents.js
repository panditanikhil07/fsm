// Turns classifier intents into (a) tasks for the response writer, (b) scripted info answers.
import { INTENTS, STATES, SLOTS, GROUPS, META, loc } from "../script/index.js";
import { render, pickTemplate, factsFor } from "./render.js";
import { refreshTicketFlags } from "./flow.js";
import { titleCase } from "../utils/text.js";
import { ev } from "./events.js";

// message entries may be a string or an array of variants (rotated by how many bad turns in a row)
const msg = (s, key, extra = {}) => {
  let t = loc(s.language, META.messages[key]) || "";
  if (Array.isArray(t)) t = t[(s.invalid_streak + (s.retries[s.state] || 0)) % t.length];
  return String(t).replace(/\{(\w+)\}/g, (_, k) => extra[k] ?? "");
};
const neededLabel = (s) => SLOTS[s.asking_slot]?.label || SLOTS[STATES[s.state].required_slots[0]]?.label || "";
export const actionOf = (id) => INTENTS[id]?.action || {};

export function recallNames(targets, s) {
  const names = new Set();
  for (const t of targets) {
    if (GROUPS[t]) Object.entries(SLOTS).filter(([, d]) => d.group === t && !["system", "boolean", "choice"].includes(d.type)).forEach(([k]) => names.add(k));
    else if (SLOTS[t]) names.add(t);
  }
  if (t0(names)) return [...names];
  return Object.keys(SLOTS).filter((k) => s.slots[k] !== undefined && SLOTS[k].speak !== false && SLOTS[k].type !== "system");
}
const t0 = (set) => set.size > 0;

export function buildTasks(s, cls, { expectsAnswer }) {
  const tasks = [];
  for (const id of cls.intents) {
    const a = actionOf(id);
    if (a.type === "invalid") tasks.push({ type: "invalid", reason: a.reason, note: a.reason === "no_input" ? "The caller was silent: say you did not hear anything." : "Do NOT say you did not hear/catch it. React to what they actually said in a few words (if off-topic and harmless, answer in one short sentence), then steer back by naming the kind of detail needed." });
    else if (a.type === "smalltalk") tasks.push({ type: "smalltalk", note: "Reply in one friendly sentence; identify yourself only if asked." });
    else if (a.type === "wait") tasks.push({ type: "wait", note: "Tell them to take their time." });
    else if (a.type === "update") tasks.push({ type: "update", labels: cls.update_targets.map((t) => GROUPS[t]?.label || SLOTS[t]?.label || t), note: "Acknowledge you will update it." });
    else if (a.type === "recall") {
      const r = factsFor(s, recallNames(cls.recall_targets, s));
      tasks.push({ type: "recall", ...r, note: "Read these facts back naturally. Mention anything in 'missing' is not noted yet." });
    } else if (a.type === "info" && a.handler === "llm") tasks.push({ type: "answer_question", topic: id, guidance: STATES[a.state]?.prompt, note: "Answer briefly from guidance only." });
  }
  if (!tasks.length && expectsAnswer && cls.intents.includes("answer"))
    tasks.push({ type: "if_no_usable_answer", note: "ONLY if you captured no slot from the utterance, react briefly to what they said and steer back, naming the detail needed (never say 'I didn't hear/catch'); otherwise lead must be empty." });
  return tasks;
}

// scripted fallback when the LLM produced no lead
export function fallbackLead(s, tasks, cls) {
  const parts = [];
  for (const t of tasks) {
    if (t.type === "invalid") {
      const key = t.reason === "no_input" ? "no_input" : t.reason === "off_topic" ? "off_topic" : "invalid";
      const label = neededLabel(s);
      // alternate between a generic reaction and naming exactly what is needed
      const useLabel = key !== "no_input" && label && (s.invalid_streak + (s.retries[s.state] || 0)) % 2 === 1;
      parts.push(useLabel ? msg(s, "need_label", { label }) : msg(s, key));
    }
    else if (t.type === "smalltalk") parts.push(msg(s, "smalltalk"));
    else if (t.type === "wait") parts.push(msg(s, "wait"));
    else if (t.type === "language_switch") parts.push(msg(s, "language_switched"));
    else if (t.type === "update") parts.push(msg(s, "update", { label: t.labels.join(", ") }));
    else if (t.type === "recall") {
      const f = Object.entries(t.facts).map(([k, v]) => `${k}: ${v}`).join("; ");
      parts.push(f ? msg(s, "recall", { facts: f }) : t.blocked?.length ? msg(s, "recall_private") : msg(s, "recall_missing"));
    }
  }
  return parts.join(" ");
}

function chargeText(s) {
  const cfg = STATES.SERVICE_CHARGE_INFO;
  const city = s.slots.city_type && titleCase(s.slots.city_type);
  const cust = s.customer_data.customer_type || (s.slots.address_type === "commercial" ? "Commercial" : s.slots.address_type ? "Residential" : null);
  const row = city && cust ? cfg.charge_table[`${city}+${titleCase(cust)}`] : null;
  if (!row) return render(s, cfg.no_city_type_template);
  return render(s, cfg.reply_template, { charge_cash: row.cash, charge_online: row.online });
}

/** Scripted answers for info intents. `llmAnswered` = the writer already answered the warranty-style question. */
export function infoReplies(s, cls, llmAnswered) {
  const out = [];
  const infos = cls.intents.filter((i) => actionOf(i).type === "info");
  const hasTech = infos.includes("technician_details");
  for (const id of infos) {
    const a = actionOf(id), cfg = STATES[a.state];
    if (id === "timing" && hasTech) continue;
    ev(s, "info_answer", { intent: id, state: a.state, lane: cfg.lane });
    if (a.handler === "charges") out.push(chargeText(s));
    else if (a.handler === "llm") { if (!llmAnswered) out.push(msg(s, a.fallback_message)); }
    else { refreshTicketFlags(s); out.push(render(s, a.template_key ? cfg[a.template_key] : pickTemplate(s, cfg))); }
  }
  return out;
}