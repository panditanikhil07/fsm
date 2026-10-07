import { META } from "../script/index.js";
import { hasWord } from "./text.js";

const first = (text, words) => {
  let best = -1;
  for (const w of words) { const m = text.search(new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "iu")); if (m >= 0 && (best < 0 || m < best)) best = m; }
  return best;
};
// Lexicon-based yes/no; used only when the classifier did not return one (offline / failure).
export function yesNo(text) {
  const t = String(text || "").toLowerCase();
  const y = first(t, META.lexicon.yes), n = first(t, META.lexicon.no);
  if (y < 0 && n < 0) return null;
  if (y >= 0 && n >= 0) return n < y ? "no" : "yes";
  return n >= 0 ? "no" : "yes";
}
export { hasWord };
