// Splits a spoken / typed Indian address into { street, area, city, state, pin_code }.
//   "house number 45, sector 62, noida, up 201301"
//   "45 gaur city 2 noida uttar pradesh 201301"
//   "street MG Road city Noida"            (labelled)
//   "Noida"                                (single answer -> goes to the slot that was just asked)
// Only fields that are really present in the words are returned; nothing is guessed.
import { digitsFrom } from "./digits.js";
import { titleCase } from "./text.js";

export const ADDRESS_KEYS = ["street", "area", "city", "state", "pin_code"];

const STATES = {
  "andhra pradesh": ["ap"], "arunachal pradesh": [], assam: [], bihar: ["br"], chhattisgarh: ["cg"], goa: [], gujarat: ["gj"],
  haryana: ["hr"], "himachal pradesh": ["hp"], jharkhand: ["jh"], karnataka: ["ka"], kerala: ["kl"], "madhya pradesh": ["mp"],
  maharashtra: ["mh"], manipur: [], meghalaya: [], mizoram: [], nagaland: [], odisha: ["od", "orissa"], punjab: ["pb"], rajasthan: ["rj"],
  sikkim: [], "tamil nadu": ["tn"], telangana: ["ts"], tripura: [], "uttar pradesh": ["up", "uttarpradesh"], uttarakhand: ["uk", "uttaranchal"],
  "west bengal": ["wb"], delhi: ["dl"], chandigarh: ["ch"], "jammu and kashmir": ["jk", "j&k"], ladakh: [], puducherry: ["pondicherry"],
};
const CITIES = ["new delhi", "delhi", "noida", "greater noida", "ghaziabad", "gurgaon", "gurugram", "faridabad", "mumbai", "navi mumbai", "thane", "pune", "nagpur",
  "nashik", "aurangabad", "kolkata", "howrah", "siliguri", "durgapur", "chennai", "coimbatore", "madurai", "trichy", "salem", "bengaluru", "bangalore", "mysuru", "mysore",
  "mangaluru", "mangalore", "hubli", "hyderabad", "secunderabad", "warangal", "vijayawada", "visakhapatnam", "vizag", "guntur", "tirupati", "kochi", "cochin",
  "thiruvananthapuram", "trivandrum", "kozhikode", "calicut", "thrissur", "ahmedabad", "surat", "vadodara", "baroda", "rajkot", "gandhinagar", "jaipur", "jodhpur",
  "udaipur", "kota", "ajmer", "bikaner", "lucknow", "kanpur", "agra", "varanasi", "prayagraj", "allahabad", "meerut", "bareilly", "aligarh", "moradabad", "gorakhpur",
  "mathura", "jhansi", "bhopal", "indore", "gwalior", "jabalpur", "ujjain", "patna", "gaya", "ranchi", "jamshedpur", "dhanbad", "bhubaneswar", "cuttack", "raipur",
  "bilaspur", "chandigarh", "mohali", "panchkula", "ludhiana", "amritsar", "jalandhar", "patiala", "dehradun", "haridwar", "roorkee", "haldwani", "shimla", "jammu",
  "srinagar", "guwahati", "imphal", "shillong", "panaji", "margao", "ambala", "karnal", "panipat", "sonipat", "rohtak", "hisar", "noida extension"]
  .sort((a, b) => b.length - a.length);

const HOUSE = /^(?:house|flat|plot|shop|building|bldg|tower|floor|room|villa|unit|h|hno|no|number|apartment|apt|door|office)$/i;
const ROAD = /^(?:road|rd|street|st|marg|lane|path|gali|chowk|avenue|ave|highway|bypass|colony road)$/i;
const START_LOCALITY = /^(?:sector|sec|phase|ph|block|pocket|ward|zone)$/i;
const END_LOCALITY = /^(?:nagar|vihar|enclave|extension|ext|puram|city|society|heights|apartments|residency|garden|gardens|park|layout|hills|market|bazaar|town|gram|colony|estate|township|kunj|bagh|ganj|pur|tola|mohalla)$/i;
const FILLER_HEAD = /^(?:(?:my|mera|meri|our|the)\s+)?(?:(?:complete|full|current|service|site)\s+)?(?:address|pata|ghar\s+ka\s+pata)\s*(?:is|hai|:)?\s*|^(?:it\s*(?:is|'s)|its|i\s+live\s+(?:at|in)|i\s+am\s+(?:at|in)|we\s+live\s+(?:at|in)|mera\s+ghar|ye|yeh|this\s+is)\s+/i;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const spanRe = (word) => new RegExp(`(^|[^\\p{L}\\p{N}])(${esc(word)})(?=[^\\p{L}\\p{N}]|$)`, "iu");

const STATE_LOOKUP = (() => {
  const m = new Map();
  for (const [name, abbr] of Object.entries(STATES)) { m.set(name, name); for (const a of abbr) m.set(a, name); m.set(name.replace(/\s+/g, ""), name); }
  return m;
})();
const STATE_WORDS = [...STATE_LOOKUP.keys()].sort((a, b) => b.length - a.length);

// find a 6-digit PIN anywhere (contiguous digits, "pin 201 301", or six consecutive spoken digits) -> { pin, rest }
function takePin(text) {
  let m = text.match(/(?<!\d)(\d{6})(?!\d)/);
  if (m) return { pin: m[1], rest: text.replace(m[0], " ") };
  m = text.match(/\bpin\s*(?:code)?\s*(?:is|:)?\s*(\d{3})[\s-]?(\d{3})(?!\d)/i);
  if (m) return { pin: m[1] + m[2], rest: text.replace(m[0], " ") };
  const toks = text.split(/\s+/);
  for (let i = 0; i + 6 <= toks.length; i++) {
    const ds = toks.slice(i, i + 6).map((t) => digitsFrom(t));
    if (ds.every((d) => d.length === 1)) return { pin: ds.join(""), rest: [...toks.slice(0, i), ...toks.slice(i + 6)].join(" ") };
  }
  return { pin: "", rest: text };
}

const cleanChunk = (s) => String(s).replace(/\b(pin\s*code|pincode|pin)\b/gi, " ").replace(/[.,;:]+\s*$/g, "").replace(/^\s*[.,;:-]+/g, "").replace(/\s+/g, " ").trim();

// "my house number is 45" -> "House Number 45"
export function cleanStreet(s) {
  return String(s || "").replace(/^(?:my|mera|meri|the|our)\s+/i, "").replace(/\b(number|no\.?)\s+(?:is|hai)\s+/i, "$1 ").replace(/\s+/g, " ").trim();
}

const LEAD_JUNK = /^(?:(?:no|not|nope|nahi|actually|sorry|wrong|incorrect|galat|instead|please|the|my|it|its|it's|is|hai|and|aur|yes|haan|ok|okay|should|be|change|update|correct)\b[\s,.-]*)+/i;
const ONLY_JUNK = /^(?:(?:city|state|area|locality|street|pin|code|pincode|address|is|hai|the|a|an|my|to|ka|ki|ke|number|no|not)\b[\s,.-]*)*$/i;
function stripJunk(chunk) { const c = String(chunk).replace(LEAD_JUNK, "").trim(); return ONLY_JUNK.test(c) ? "" : c; }

function classify(chunk) {
  const toks = chunk.split(/\s+/).filter(Boolean);
  const hasRoad = toks.some((t) => ROAD.test(t));
  const hasHouse = /^[a-z]?[-/]?\d/i.test(toks[0] || "") || (toks.some((t) => HOUSE.test(t)) && /\d/.test(chunk));   // "office" / "shop" alone is not a house number
  const hasStartLoc = toks.some((t) => START_LOCALITY.test(t));
  const hasEndLoc = toks.some((t, i) => i > 0 && END_LOCALITY.test(t));
  return { toks, hasRoad, hasHouse, hasStartLoc, hasEndLoc };
}

// "45 sector 62" -> { street: "45", area: "sector 62" };  "12 mg road sector 15" -> street "12 mg road", area "sector 15"
function splitStreetArea(chunk) {
  const toks = chunk.split(/\s+/).filter(Boolean);
  const isNum = (t) => /^[a-z]?[-/]?\d/i.test(t);
  let roadAt = -1;
  toks.forEach((t, i) => { if (ROAD.test(t)) roadAt = i; });
  const startAt = toks.findIndex((t) => START_LOCALITY.test(t));
  const endAt = toks.findIndex((t, i) => i > 0 && END_LOCALITY.test(t));
  let from = -1;                                                  // where the locality begins
  if (startAt >= 0) from = startAt;
  if (endAt >= 0) {
    let f = endAt - 1;                                            // "Gaur City": the name before the marker belongs to the area
    if (f < 0 || isNum(toks[f]) || HOUSE.test(toks[f]) || ROAD.test(toks[f])) f = endAt;
    if (from < 0 || f < from) from = f;
  }
  if (roadAt >= 0 && (from < 0 || roadAt < from)) return { street: toks.slice(0, roadAt + 1).join(" "), area: toks.slice(roadAt + 1).join(" ") };
  if (from >= 0) return { street: toks.slice(0, from).join(" "), area: toks.slice(from).join(" ") };
  return { street: chunk, area: "" };
}

/**
 * @param text   raw utterance
 * @param opts   asking: slot that was just asked (a lone chunk answers it); wanted: which keys to return
 */
export function parseAddress(text, { asking = null, wanted = ADDRESS_KEYS, strict = false } = {}) {
  let t = String(text || "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return {};
  const out = {};

  // 1. PIN
  const { pin, rest } = takePin(t);
  if (pin) out.pin_code = pin;
  t = rest;

  // 2. explicit labels: "city Noida", "state: UP", "area Gaur City", "street MG Road"
  // "the city is Gurgaon", "state hai UP": an explicit "is" makes the label unambiguous anywhere in the sentence
  const isRe = /\b(street|area|locality|city|state)\s+(?:is|hai)\s+([^,]+?)(?=,|\b(?:street|area|locality|city|state|pin\s*code|pincode)\s+(?:is|hai)\b|$)/gi;
  const isHits = [];
  let mi;
  while ((mi = isRe.exec(t))) { const k = mi[1].toLowerCase() === "locality" ? "area" : mi[1].toLowerCase(); const v = cleanChunk(mi[2]); if (v) { out[k] ||= v; isHits.push(mi[0]); } }
  for (const h of isHits) t = t.replace(h, " , ");
  const labelStart = /^\s*(?:street|area|locality|city|state)\b/i.test(t);     // "city Noida state UP": labels may follow each other without commas
  const labelRe = new RegExp(`${labelStart ? "\\b" : "(?:^|,)\\s*"}(street|area|locality|city|state)\\s*(?:is|hai|:|-)?\\s+([^,]+?)(?=,|\\b(?:street|area|locality|city|state|pin\\s*code|pincode)\\b|$)`, "gi");
  let m;
  const labelled = [];
  while ((m = labelRe.exec(t))) {
    const k = m[1].toLowerCase() === "locality" ? "area" : m[1].toLowerCase();
    const v = cleanChunk(m[2]);
    if (v) { out[k] ||= v; labelled.push(m[0]); }
  }
  for (const l of labelled) t = t.replace(l, " , ");
  t = t.replace(/^\s*,+|,+\s*$/g, "").trim();

  if (out.state) out.state = STATE_LOOKUP.get(out.state.toLowerCase()) || out.state;

  // 3. head filler ("my address is", "i live at")
  t = t.replace(FILLER_HEAD, "").trim();

  // 4. state (full name / abbreviation) — abbreviations only when they stand alone at the end, before the pin, or after a comma
  if (!out.state) {
    for (const w of STATE_WORDS) {
      const abbr = w.length <= 3;
      const re = spanRe(w);
      const hit = t.match(re);
      if (!hit) continue;
      const idx = hit.index + hit[1].length, after = t.slice(idx + w.length).trim(), before = t.slice(0, idx).trim();
      const ok = !abbr || (!after || /^,/.test(after)) || /,\s*$/.test(before);
      if (!ok) continue;
      if (w === "delhi" && CITIES.some((c) => c.includes("delhi") && spanRe(c).test(t)) && !/(delhi)[^]*\bdelhi\b/i.test(t)) continue;   // a lone Delhi/New Delhi is the city
      out.state = titleCase(STATE_LOOKUP.get(w));
      t = (t.slice(0, idx) + " , " + t.slice(idx + w.length)).replace(/\s+/g, " ");
      break;
    }
  }

  // 5. known cities
  if (!out.city) {
    for (const c of CITIES) {
      const hit = t.match(spanRe(c));
      if (!hit) continue;
      const idx = hit.index + hit[1].length;
      out.city = titleCase(c);
      t = (t.slice(0, idx) + " , " + t.slice(idx + c.length)).replace(/\s+/g, " ");
      break;
    }
  }

  // 6. what is left: street + area (+ maybe an unknown city when a state was found)
  const chunks = t.split(",").map(cleanChunk).map(stripJunk).filter(Boolean);
  const classified = chunks.map((c) => ({ c, ...classify(c) }));
  let street = out.street, area = out.area;
  const leftovers = [];
  for (const k of classified) {
    if (k.hasHouse || k.hasRoad) {
      if (k.hasStartLoc || k.hasEndLoc || k.hasRoad) { const sp = splitStreetArea(k.c); if (!street && sp.street) street = sp.street; if (!area && sp.area) area = sp.area; if (sp.tail) leftovers.push(sp.tail); }
      else if (!street) street = k.c; else leftovers.push(k.c);
    } else if (k.hasStartLoc || k.hasEndLoc) {
      const sp = splitStreetArea(k.c);
      if (!area) area = sp.area || k.c; else leftovers.push(k.c);
      if (sp.street && !street) street = sp.street;
    } else leftovers.push(k.c);
  }
  // unknown city: the chunk right before a recognised state ("..., kanpur, up")
  if (!out.city && out.state && leftovers.length && classified.length) {
    const last = leftovers[leftovers.length - 1];
    if (last.split(/\s+/).length <= 2 && !/\d/.test(last)) { out.city = titleCase(last); leftovers.pop(); }
  }
  // remaining unclassified chunks fill the gaps in order (street, then area)
  const gapFill = !strict && (!asking || asking === "street" || asking === "area");   // strict: only fields with structural evidence
  for (const l of gapFill ? leftovers : []) {
    if (asking === "area" && !area) area = l;
    else if (asking === "street" && !street) street = l;
    else if (!street) street = l; else if (!area) area = l;
  }
  if (street) out.street ||= cleanStreet(street);
  if (area) out.area ||= area;

  // 7. a lone chunk answers whatever was just asked
  const found = ADDRESS_KEYS.filter((k) => out[k]);
  if (!found.length && !strict) {
    const lone = cleanChunk(chunks.join(" ")) || cleanChunk(t);
    if (asking && lone && lone.split(/\s+/).length <= 8) {
      if (asking === "state") { const st = STATE_LOOKUP.get(lone.toLowerCase()); if (st) out.state = titleCase(st); }       // an unknown word is not a state
      else if (asking === "street") out.street = cleanStreet(lone);
      else if (asking === "city") { if (!/\d/.test(lone) && lone.split(/\s+/).length <= 3) out.city = lone; }
      else if (asking !== "pin_code") out[asking] = lone;
    }
  }

  const res = {};
  for (const k of wanted) if (out[k]) res[k] = k === "pin_code" ? out[k] : titleCase(out[k]);
  return res;
}

// LLM output sanity pass: fill what it left empty, and fix a street that swallowed city / state / pin / the whole sentence.
export function repairAddress(vals, text, { asking = null, expected = ADDRESS_KEYS } = {}) {
  const wanted = ADDRESS_KEYS.filter((k) => expected.includes(k));
  if (!wanted.length) return vals;
  const p = parseAddress(text, { asking, wanted, strict: true });
  const out = { ...vals };
  const lc = (s) => String(s || "").toLowerCase();
  for (const k of wanted) if (!out[k] && p[k]) out[k] = p[k];
  const swallow = (v) => ["city", "state", "area"].some((k) => p[k] && lc(v).includes(lc(p[k]))) || /\b\d{6}\b/.test(String(v));
  for (const k of ["street", "area"]) if (out[k] && p[k] && p[k] !== out[k] && swallow(out[k])) out[k] = p[k];
  return out;
}