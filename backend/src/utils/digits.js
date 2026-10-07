import { META } from "../script/index.js";

const { digit_words: WORDS, digit_multipliers: MULT } = META.lexicon;

// "nine double eight 7 7 ..." -> "98877..."
export function digitsFrom(raw) {
  let out = "", mult = 1;
  for (const tk of String(raw || "").toLowerCase().split(/[\s,;:.-]+/).filter(Boolean)) {
    if (tk in MULT) { mult = MULT[tk]; continue; }
    let d = null;
    if (/\d/.test(tk)) d = tk.replace(/\D/g, "");
    else if (tk in WORDS) d = String(WORDS[tk]);
    if (d !== null) out += mult > 1 && d.length === 1 ? d.repeat(mult) : d;
    mult = 1;
  }
  return out;
}

export function normalizeMobile(d) {
  const cc = META.country_calling_code;
  if (d.length === cc.length + 10 && d.startsWith(cc)) return d.slice(cc.length);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d;
}
const PHONE_RE = new RegExp(META.phone_pattern);
export const validMobile = (d) => PHONE_RE.test(d);
