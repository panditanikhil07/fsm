import { META } from "../script/index.js";
import { hasWord } from "./text.js";

const first = (text, words) => {
  let best = -1;
  for (const w of words) { const m = text.search(new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "iu")); if (m >= 0 && (best < 0 || m < best)) best = m; }
  return best;
};

const NUMBER_ABBR = /\bno\.?\s*[-#:]?\s*(?=[\p{N}])/giu;
const MAX_WORDS = 8;                                  // a yes/no reply is short; long sentences are content, not a yes/no

// Lexicon-based yes/no; used only when the classifier did not return one (offline / failure).
export function yesNo(text) {
  const t = String(text || "").toLowerCase().replace(NUMBER_ABBR, " # ");
  if (t.split(/\s+/).filter(Boolean).length > MAX_WORDS) return null;
  const y = first(t, META.lexicon.yes), n = first(t, META.lexicon.no);
  if (y < 0 && n < 0) return null;
  if (y >= 0 && n >= 0) return n < y ? "no" : "yes";
  return n >= 0 ? "no" : "yes";
}

const FILLER = new Set(["ji", "please", "pls", "sir", "madam", "mam", "maam", "hai", "ha", "hmm", "hm", "umm", "um", "uh", "so", "well", "that", "thats", "that's", "is", "it", "its", "it's", "this", "one", "only", "i", "do", "am", "yes", "no"]);
export function isBareYesNo(text) {
  const words = String(text || "").toLowerCase().replace(/[^\p{L}\s']/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return false;
  const yn = new Set([...META.lexicon.yes, ...META.lexicon.no]);
  return words.some((w) => yn.has(w)) && words.every((w) => yn.has(w) || FILLER.has(w));
}
export { hasWord };
