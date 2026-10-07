import { META } from "../script/index.js";
import { titleCase } from "./text.js";

const L = META.lexicon;
const FILLER = new Set(L.name_filler), NOT_NAME = new Set(L.not_a_name), RELATIONS = new Set(L.relations), SELF = new Set(L.self_words);

const words = (raw) => String(raw).toLowerCase().replace(/[^\p{L}\s'.-]/gu, " ").split(/\s+/).filter(Boolean);

// "my name is rohan kumar" -> ["Rohan", "Kumar"]; [] when it does not look like a name
export function nameTokens(raw, { dropRelations = false } = {}) {
  const toks = words(raw).filter((w) => !FILLER.has(w) && !(dropRelations && RELATIONS.has(w)));
  if (!toks.length || toks.length > 4) return [];
  if (toks.some((w) => NOT_NAME.has(w) || w.length < 2)) return [];
  return toks.map(titleCase);
}
export const isSelfReference = (raw) => {
  const w = words(raw);
  return w.some((x) => SELF.has(x)) && !w.some((x) => RELATIONS.has(x) && x !== "my");
};

const STOP = new Set([...FILLER, ...NOT_NAME, ...RELATIONS]);
const toks = (raw) => String(raw).replace(/[^\p{L}\s'.-]/gu, " ").split(/\s+/).filter(Boolean);

// Full name returned in one slot ("Nikhil Pandita") -> { first: "Nikhil", rest: "Pandita" }
export function splitFullName(value) {
  const t = toks(value).map(titleCase);
  return t.length > 1 ? { first: t[0], rest: t.slice(1).join(" ") } : { first: t[0] || "", rest: "" };
}

// Only a first name came back: take the name-like words that directly follow it in what the caller said.
export function surnameAfter(text, first) {
  const w = toks(text), i = w.findIndex((x) => x.toLowerCase() === String(first).toLowerCase());
  if (i < 0) return "";
  const out = [];
  for (const x of w.slice(i + 1, i + 3)) {
    if (STOP.has(x.toLowerCase()) || x.length < 2) break;
    out.push(titleCase(x));
  }
  return out.join(" ");
}