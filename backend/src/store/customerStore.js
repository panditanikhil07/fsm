// JSON-file persistence: customers (profile, addresses, tickets, last_call) and call logs.
// In-memory maps are the source of truth; every mutation is flushed with an atomic write.
import path from "node:path";
import { config } from "../config.js";
import { META, SLOTS } from "../script/index.js";
import { readJson, writeJsonAtomic } from "../utils/atomicJson.js";
import { withLock } from "../utils/mutex.js";
import { isFilled } from "../utils/text.js";

const CUSTOMERS_FILE = path.join(config.dataDir, "customers.json");
const CALLS_FILE = path.join(config.dataDir, "calls.json");
const AREAS_FILE = path.join(config.dataDir, "areas.json");

const RESUMABLE = new Set(["incomplete", "dropped"]);
const customers = new Map();
let calls = [];
let areas = [];
let ticketSeq = 1000;
let loaded = false;

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const digits = (p) => String(p || "").replace(/\D/g, "");
const hasName = (c) => !!(c?.first_name || c?.last_name);

function normalize(rec) {
  const c = {
    phone_number: digits(rec.phone_number), first_name: rec.first_name || "", last_name: rec.last_name || "",
    customer_type: rec.customer_type || rec.Customer_Type || "", caller_type: rec.caller_type || "",
    addresses: Array.isArray(rec.addresses) ? rec.addresses : [], tickets: Array.isArray(rec.tickets) ? rec.tickets : [],
    last_call: rec.last_call || null, updated_at: rec.updated_at || new Date().toISOString(),
  };
  // legacy shape: { ticket_id, latest_address }
  if (rec.ticket_id && !c.tickets.some((t) => t.ticket_id === rec.ticket_id))
    c.tickets.push({ ticket_id: rec.ticket_id, status: rec.ticket_status || "open", created_at: c.updated_at });
  if (rec.latest_address && !c.addresses.length)
    c.addresses.push({ id: "ADDR-1", street: String(rec.latest_address), area: "", city: "", state: "", pin_code: "" });
  if (!c.last_call && rec.last_state) c.last_call = { status: "incomplete", last_state: rec.last_state, ended_at: c.updated_at, slots: {} };
  return c;
}

export async function initStore() {
  if (loaded) return;
  customers.clear();
  for (const r of await readJson(CUSTOMERS_FILE, [])) { const c = normalize(r); if (c.phone_number) customers.set(c.phone_number, c); }
  calls = await readJson(CALLS_FILE, []);
  areas = await readJson(AREAS_FILE, []);
  for (const c of customers.values()) for (const t of c.tickets) ticketSeq = Math.max(ticketSeq, Number(String(t.ticket_id).replace(/\D/g, "")) || 0);
  loaded = true;
}

const flushCustomers = () => writeJsonAtomic(CUSTOMERS_FILE, [...customers.values()]);
const flushCalls = () => writeJsonAtomic(CALLS_FILE, calls.slice(-config.maxCallLog));

// ---------------------------------------------------------------- reads -----
export function lookupCustomer(phone) {
  const rec = customers.get(digits(phone));
  if (!rec) return { status: "CUSTOMER_NOT_FOUND" };
  const last = rec.last_call;
  const fresh = RESUMABLE.has(last?.status) && Date.now() - Date.parse(last.ended_at || 0) < META.resume_window_hours * 3_600_000;
  const resume = fresh && last.slots && Object.keys(last.slots).length ? clone(last.slots) : null;
  if (!hasName(rec)) return { status: "CUSTOMER_NOT_FOUND", resume };
  return { status: "CUSTOMER_FOUND", customer: clone(rec), resume };
}
export const listCustomers = () => [...customers.values()].map(clone);
export const getCustomer = (phone) => clone(customers.get(digits(phone)));
export const listCalls = (limit = 50) => clone(calls.slice(-limit).reverse());

export function mapArea({ pin_code, city, area }) {
  const hit = areas.find((a) => (pin_code && a.pin_prefixes?.some((p) => String(pin_code).startsWith(p))))
    || areas.find((a) => city && area && a.city.toLowerCase() === String(city).toLowerCase() && a.area_name.toLowerCase() === String(area).toLowerCase());
  return hit ? { status: "EXACT_MATCH", area_id: hit.area_id, area_name: hit.area_name, city_type: hit.city_type } : { status: "NO_EXACT_MATCH" };
}
export const nextTicketId = () => `T-${++ticketSeq}`;

// --------------------------------------------------------------- writes -----
function addressOf(s) {
  const sl = s.slots;
  if (!["street", "area", "city", "state", "pin_code"].every((k) => isFilled(sl[k]))) return null;
  return { street: sl.street, area: sl.area, city: sl.city, state: sl.state, pin_code: sl.pin_code, area_id: sl.area_id || null,
    area_name: sl.area_name || null, city_type: sl.city_type || null, address_type: sl.address_type || null };
}
const sameAddress = (a, b) => a.pin_code === b.pin_code && String(a.street).toLowerCase() === String(b.street).toLowerCase();

function outcomeOf(s, forced) {
  if (s.flags.transfer_result === "success") return "transferred";
  if (s.flags.transfer_result === "outside_business_hours") return "callback_requested";
  if (s.flags.complaint_registered && s.slots.ticket_id) return "completed";
  return forced || "incomplete";
}

function upsertServiceCustomer(s, outcome) {
  const key = s.slots.final_service_number || s.caller_number;
  const rec = customers.get(key) || normalize({ phone_number: key });
  const now = new Date().toISOString();
  rec.first_name = s.slots.first_name || s.customer_data.first_name || rec.first_name;
  rec.last_name = s.slots.last_name || s.customer_data.last_name || rec.last_name;
  rec.caller_type = s.slots.caller_type || rec.caller_type;
  if (!rec.customer_type && s.slots.address_type) rec.customer_type = s.slots.address_type === "residential" ? "Residential" : "Commercial";
  const addr = addressOf(s);
  let addrId = null;
  if (addr) {
    let existing = rec.addresses.find((a) => sameAddress(a, addr));
    if (!existing) { existing = { id: `ADDR-${rec.addresses.length + 1}`, ...addr }; rec.addresses.push(existing); }
    else Object.assign(existing, Object.fromEntries(Object.entries(addr).filter(([, v]) => v)));
    addrId = existing.id;
  }
  const ticket = s.slots.ticket_id && rec.tickets.find((t) => t.ticket_id === s.slots.ticket_id);
  if (s.slots.ticket_id && !ticket)
    rec.tickets.push({ ticket_id: s.slots.ticket_id, status: "open", product: s.slots.product, brand: s.slots.brand,
      address_id: addrId, created_at: now, call_id: s.id, call_rating: s.slots.call_rating ?? null });
  else if (ticket) Object.assign(ticket, { product: s.slots.product, brand: s.slots.brand, address_id: addrId ?? ticket.address_id, call_rating: s.slots.call_rating ?? null });
  rec.last_call = { call_id: s.id, status: outcome, ended_at: now, last_state: s.state };
  rec.updated_at = now;
  customers.set(key, rec);
  return rec;
}

function saveResumable(s, outcome) {
  const key = s.caller_number;
  const rec = customers.get(key) || normalize({ phone_number: key });
  const keep = Object.fromEntries(Object.entries(s.slots).filter(([k, v]) => SLOTS[k]?.resume && isFilled(v)));
  rec.last_call = { call_id: s.id, status: outcome, ended_at: new Date().toISOString(), last_state: s.state, slots: keep };
  rec.updated_at = rec.last_call.ended_at;
  customers.set(key, rec);
  return rec;
}

// Called once when a call ends (terminal state, hang-up, idle timeout or reset).
export function finalizeCall(s, endedBy = "terminal") {
  if (s.persisted) return Promise.resolve(s.persisted);
  const outcome = outcomeOf(s, endedBy === "terminal" ? "ended" : "dropped");
  const final = { outcome, ended_by: endedBy, saved: [] };
  s.persisted = final;                        // claim synchronously so double-finalize is impossible
  return withLock("store", async () => {
    const touched = [];
    if (outcome === "completed" || outcome === "transferred" || outcome === "callback_requested") touched.push(upsertServiceCustomer(s, outcome));
    else if (!s.slots.final_service_number || s.slots.final_service_number === s.caller_number) touched.push(saveResumable(s, outcome));
    // an unresolved resume snapshot must not survive a finished call
    const caller = customers.get(s.caller_number);
    if (caller && outcome !== "incomplete" && outcome !== "dropped" && caller.last_call?.slots) delete caller.last_call.slots;

    calls.push({
      call_id: s.id, caller_number: s.caller_number, service_number: s.slots.final_service_number || null,
      started_at: s.started_at, ended_at: new Date().toISOString(), outcome, ended_by: endedBy, language: s.language,
      final_state: s.state, ticket_id: s.slots.ticket_id || null, rating: s.slots.call_rating ?? null,
      transfer_reason: s.flags.transfer_reason || null, resumed_previous: !!s.flags.resumed_previous,
      slots: clone(s.slots), path: [...s.path], metrics: clone(s.metrics),
      tool_calls: s.tool_calls.map((t) => ({ name: t.name, status: t.result?.status ?? null, at: t.at })),
      transcript: s.history.map((h) => ({ turn: h.turn, user: h.user, assistant: h.assistant, state: h.to_state, lane: h.lane })),
    });
    await flushCustomers(); await flushCalls();
    final.saved = ["customers.json", "calls.json"];
    final.record = clone(touched[0] || null);
    return final;
  });
}

// ------------------------------------------------------------ admin helpers --
export function patchTicket(phone, ticketId, patch) {
  return withLock("store", async () => {
    const rec = customers.get(digits(phone));
    const t = rec?.tickets.find((x) => x.ticket_id === ticketId);
    if (!t) return null;
    Object.assign(t, patch, patch.status === "closed" ? { closed_at: new Date().toISOString() } : {}, patch.status === "cancelled" ? { cancelled_at: new Date().toISOString() } : {});
    await flushCustomers();
    return clone(t);
  });
}
export function deleteCustomer(phone) {
  return withLock("store", async () => { const ok = customers.delete(digits(phone)); await flushCustomers(); return ok; });
}