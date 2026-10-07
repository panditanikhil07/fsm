// Template interpolation: {slots.x}, {flags.x}, {first_name}, {address_readback} ...
import { META, SLOTS, loc } from "../script/index.js";
import { spaced, isFilled } from "../utils/text.js";
import { evalCond } from "./conditions.js";

export const addressList = (s) => s.customer_data?.addresses || [];
export function selectedAddress(s) {
  const list = addressList(s);
  return list.find((a) => a.id === s.slots.selected_address_id) || (list.length === 1 ? list[0] : null);
}
export const addressOptions = (s) =>
  addressList(s).map((a) => ({ id: a.id, text: [a.street, a.area, a.city].filter(Boolean).join(", ") }));

export function latestTicket(s) {
  const list = (s.customer_data?.tickets || []).filter((t) => t.status === "open");
  return list[list.length - 1] || null;
}

export function derived(s) {
  const a = selectedAddress(s) || {};
  const t = latestTicket(s) || {};
  return {
    bot_name: META.bot_name, company: META.company,
    first_name: s.slots.first_name ?? s.customer_data.first_name ?? "",
    last_name: s.slots.last_name ?? s.customer_data.last_name ?? "",
    digits_spoken: spaced(s.digits_heard),
    pin_digits: spaced(s.slots.pin_code),
    address_readback: [a.street, a.area, a.city, a.state, a.pin_code && spaced(a.pin_code)].filter(Boolean).join(", "),
    address_choices: addressList(s).map((x) => [x.area, x.city].filter(Boolean).join(", ") || x.street).join(" or "),
    area_name: s.slots.area_name ?? a.area_name ?? "",
    contact_person: s.slots.contact_person_at_site ?? "",
    technician_name: t.technician_name ?? "", technician_number: spaced(t.technician_number ?? ""),
    ...s.slots,
  };
}

function lookupPath(s, key, extra = {}) {
  if (key.startsWith("slots.")) return s.slots[key.slice(6)];
  if (key.startsWith("flags.")) return s.flags[key.slice(6)];
  return key in extra ? extra[key] : (derived(s)[key] ?? s.flags[key] ?? s.slots[key] ?? s.customer_data[key]);
}
export function interp(s, v, extra) {
  if (typeof v !== "string") return v;
  const only = v.match(/^\{([\w.]+)\}$/);
  if (only) return lookupPath(s, only[1], extra) ?? "";
  return v.replace(/\{([\w.]+)\}/g, (_, k) => lookupPath(s, k, extra) ?? "");
}
export const interpObj = (s, o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, interp(s, v)]));
export const render = (s, tpl, extra) => (tpl ? interp(s, loc(s.language, tpl), extra) : "");
export const applySets = (s, obj) => { for (const [k, v] of Object.entries(obj || {})) s.flags[k] = interp(s, v); };

// first matching reply_template_variants entry, else reply_template
export function pickTemplate(s, cfg) {
  for (const [cond, variant] of Object.entries(cfg.reply_template_variants || {})) if (evalCond(cond, s)) return variant;
  return cfg.reply_template;
}

// human readable facts for the "recall" intent. never exposes slots marked speak:false
export function factsFor(s, slotNames) {
  const facts = {}, missing = [], blocked = [];
  const pretty = (k, v) => (SLOTS[k].speak === "digits" ? spaced(v) : v);
  const a = selectedAddress(s);
  for (const k of slotNames) {
    const def = SLOTS[k];
    if (!def || def.type === "system" && def.speak === undefined) continue;
    if (def.speak === false) { blocked.push(def.label || k); continue; }
    let v = s.slots[k];
    if (!isFilled(v) && a && a[k] !== undefined) v = a[k];
    if (!isFilled(v) && ["first_name", "last_name"].includes(k)) v = s.customer_data[k];
    if (!isFilled(v) && k === "site_contact_number") v = undefined;
    if (isFilled(v)) facts[def.label || k] = String(pretty(k, v)); else missing.push(def.label || k);
  }
  return { facts, missing, blocked };
}
