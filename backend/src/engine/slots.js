// Slot validation / normalisation driven by the registry in states.json.
import { SLOTS, META } from "../script/index.js";
import { digitsFrom, normalizeMobile, validMobile } from "../utils/digits.js";
import { nameTokens } from "../utils/names.js";
import { titleCase, isFilled } from "../utils/text.js";

const YES = new Set(META.lexicon.yes), NO = new Set(META.lexicon.no);

export function normalizeSlot(name, value, ctx = {}) {
  const def = SLOTS[name];
  if (!def || def.type === "system" || value == null) return undefined;
  let v = typeof value === "string" ? value.trim() : value;
  if (v === "" || /^(none|null|unknown|n\/a|na)$/i.test(String(v))) return undefined;
  switch (def.type) {
    case "boolean": {
      if (typeof v === "boolean") return v;
      const s = String(v).toLowerCase();
      return s === "true" || YES.has(s) ? true : s === "false" || NO.has(s) ? false : undefined;
    }
    case "enum": {
      const s = String(v).toLowerCase().replace(/\s+/g, def.values?.some((x) => x.includes("_")) ? "_" : " ");
      if (def.values?.includes(s)) return s;
      for (const [canon, words] of Object.entries(def.synonyms || {})) if (words.includes(s)) return canon;
      return def.strict === false ? String(v).toLowerCase() : undefined;
    }
    case "digits": { const d = normalizeMobile(String(v).replace(/\D/g, "") || digitsFrom(v)); return def.length === 10 ? (validMobile(d) ? d : undefined) : d.length === def.length ? d : undefined; }
    case "pin": { const d = String(v).replace(/\D/g, ""); return d.length === def.length ? d : undefined; }
    case "name": { const t = nameTokens(v); return t.length ? t.join(" ") : (ctx.allowFreeName && String(v).length < 40 ? titleCase(v) : undefined); }
    case "choice": return (ctx.address_options || []).some((o) => o.id === v) ? String(v) : undefined;
    case "text": { const s = String(v).replace(/[.,]+$/, "").slice(0, 120); return def.format === "title" ? titleCase(s) : s; }
    default: return typeof v === "string" ? v : undefined;
  }
}

export function sanitizeCaptured(raw, ctx) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) { const n = normalizeSlot(k, v, ctx); if (isFilled(n)) out[k] = n; }
  return out;
}
