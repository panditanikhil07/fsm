// Offline / LLM-failure fallbacks. 100% schema-driven (keywords, synonyms, lexicons all come from
// states.json) so the bot still works without an API key, just less smartly.
import { INTENTS, GROUPS, SLOTS } from "../script/index.js";
import { digitsFrom } from "../utils/digits.js";
import { yesNo } from "../utils/yesno.js";
import { hasWord, norm, titleCase } from "../utils/text.js";
import { nameTokens, isSelfReference } from "../utils/names.js";

const anyKeyword = (t, kws = []) => kws.some((k) => (k.includes(" ") ? t.includes(k) : hasWord(t, k)));

export function fallbackClassify(text, ctx) {
  const t = norm(text);
  const intents = [];
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return { intents: ["no_input"], update_targets: [], recall_targets: [], yes_no: null, language: null, reason: "empty" };
  const yn = yesNo(t);
  const expected = new Set(ctx.expected_slots || []);
  for (const [id, it] of Object.entries(INTENTS)) {
    if (["answer", "update", "recall", "smalltalk"].includes(id)) continue;
    if (it.keywords && anyKeyword(t, it.keywords)) intents.push(id);
  }
  const targetsFor = () => {
    const slots = Object.entries(SLOTS).filter(([, d]) => anyKeyword(t, d.keywords)).map(([k]) => k);
    if (slots.length) return slots;
    return Object.entries(GROUPS).filter(([, g]) => anyKeyword(t, g.keywords)).map(([k]) => k);
  };
  let update_targets = [], recall_targets = [];
  if (anyKeyword(t, INTENTS.recall.keywords)) { intents.unshift("recall"); recall_targets = targetsFor(); }
  else if (anyKeyword(t, INTENTS.update.keywords) && !intents.some((i) => INTENTS[i].action.type === "transfer")) {
    const tg = targetsFor().filter((x) => !expected.has(x));
    if (tg.length) { intents.unshift("update"); update_targets = tg; }
  }
  // anything that is not a pure control/info request is treated as an answer attempt;
  // whether it really is one is decided later (no slot captured => retry)
  const nonAnswer = intents.some((i) => ["repeat", "wait", "end_call", "recall", "info", "transfer"].includes(INTENTS[i].action.type));
  if (!nonAnswer) intents.push("answer");
  return { intents, update_targets, recall_targets, yes_no: yn, language: null, reason: "keyword fallback" };
}

// returns raw (un-validated) slot guesses for the slots we were asked to look for
export function fallbackCapture(text, ctx, specs) {
  const t = norm(text), out = {};
  if (ctx.answerless) return out;                // classifier said this is not an answer (recall, info, wait ...)
  const textSlots = specs.filter((s) => s.type === "text" && s.expected);
  for (const s of specs) {
    if (!s.expected && !s.volunteer) continue;
    const def = SLOTS[s.name];
    switch (s.type) {
      case "boolean": { const y = yesNo(t); if (y) out[s.name] = y === "yes"; break; }
      case "enum": {
        const table = { ...Object.fromEntries((def.values || []).map((v) => [v, [v.replace(/_/g, " ")]])), ...(def.synonyms || {}) };
        for (const [value, words] of Object.entries(table)) {
          const all = [...new Set([...(words || []), ...((def.synonyms || {})[value] || [])])];
          if (all.some((w) => hasWord(t, w.toLowerCase()) || hasWord(t, `${w.toLowerCase()}s`))) { out[s.name] = value; break; }
        }
        if (!out[s.name] && s.name === "call_rating") { const m = t.match(/\b([0-5])\b/) || []; if (m[1]) out.call_rating = m[1]; else if (/\b(skip|decline|no rating|pass)\b/.test(t)) out.call_rating = "declined"; }
        if (!out[s.name] && s.name === "service_number_choice") { const y = yesNo(t); if (y) out[s.name] = y === "yes" ? "same" : "different"; }
        break;
      }
      case "pin": { const d = String(text).match(/(?<!\d)\d{6}(?!\d)/)?.[0] || digitsFrom(text); if (d.length === 6) out[s.name] = d; break; }
      case "name": {
        if (s.name === "last_name" && specs.some((x) => x.name === "first_name" && x.expected)) break;   // handled with first_name
        const self = def.self_reference && isSelfReference(text) && ctx.caller_name;
        const toks = nameTokens(text, { dropRelations: !!def.self_reference });
        if (self) out[s.name] = ctx.caller_name;
        else if (toks.length) {
          if (s.name === "first_name") { out.first_name = toks[0]; if (toks.length > 1 && specs.some((x) => x.name === "last_name" && x.expected)) out.last_name = toks.slice(1).join(" "); }
          else out[s.name] = toks.join(" ");
        }
        break;
      }
      case "choice": {
        const opts = ctx.address_options || [];
        const ord = [/\b(first|1st|pehla|1)\b/, /\b(second|2nd|doosra|2)\b/, /\b(third|3rd|teesra|3)\b/];
        const hit = ord.map((re, i) => (re.test(t) && opts[i] ? opts[i].id : null)).filter(Boolean);
        if (hit.length === 1) out[s.name] = hit[0];
        else { const m = opts.filter((o) => o.text.toLowerCase().split(/[\s,]+/).some((w) => w.length > 3 && t.includes(w))); if (m.length === 1) out[s.name] = m[0].id; }
        break;
      }
      default: break;
    }
  }
  // free-text address fields: "city Noida", comma list, or a direct answer to the slot we just asked for
  if (textSlots.length) {
    const labelRe = /\b(street|area|locality|city|state)\s*(?:is|:)?\s+([a-z0-9 .\-/]+?)(?=,|\b(?:street|area|locality|city|state|pin\s*code|pincode)\b|$)/gi;
    let m;
    while ((m = labelRe.exec(String(text)))) { const k = m[1].toLowerCase() === "locality" ? "area" : m[1].toLowerCase(); if (textSlots.some((x) => x.name === k)) out[k] ||= titleCase(m[2].trim()); }
    const stripped = String(text).replace(/\b\d{6}\b/g, " ").replace(/\b(pin\s*code|pincode|pin)\b/gi, " ");
    const parts = stripped.split(",").map((p) => p.trim()).filter(Boolean);
    const missing = textSlots.filter((x) => !out[x.name]);
    const isAnswer = !yesNo(t) || parts.join(" ").split(/\s+/).length > 2;      // a bare yes/no is never an address part
    if (isAnswer && ctx.asking_slot && textSlots.some((x) => x.name === ctx.asking_slot) && !out[ctx.asking_slot] && parts.length <= 1 && parts[0]) out[ctx.asking_slot] = titleCase(parts[0]);
    else if (isAnswer && parts.length >= 2 && missing.length >= 2 && !textSlots.some((x) => out[x.name])) missing.forEach((x, i) => { if (parts[i]) out[x.name] = titleCase(parts[i]); });
  }
  return out;
}
