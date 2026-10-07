// Tool layer. Every call is recorded on the session (shown in the UI) and timed.
import { performance } from "node:perf_hooks";
import { config } from "../config.js";
import { lookupCustomer, mapArea, nextTicketId } from "../store/customerStore.js";
import { validMobile } from "../utils/digits.js";
import { round } from "../utils/text.js";

const withinHours = (range) => {
  const [a, b] = String(range).split("-").map((x) => x.split(":").map(Number));
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
  return m >= a[0] * 60 + a[1] && m <= b[0] * 60 + b[1];
};

const TOOLS = {
  manage_call_settings(s, args) {
    if (args.action === "prepare_for_slow_input") s.flags.slow_input_active = true;
    if (args.action === "finalize_slow_input") s.flags.slow_input_active = false;
    return { status: "OK", action: args.action };
  },
  fetch_customer_details_by_phone_number(s, args) {
    const phone = String(args.phone || "").replace(/\D/g, "");
    if (!validMobile(phone)) return { status: "INVALID_PHONE" };
    const r = lookupCustomer(phone);
    return r.status === "CUSTOMER_FOUND" ? { status: r.status, customer: r.customer, resume: r.resume } : { status: r.status, resume: r.resume };
  },
  fetch_nearest_areas: (s, args) => mapArea(args),
  initiate_warm_transfer() {
    const forced = config.transfer.force;
    const mode = forced || (withinHours(config.transfer.hours) ? "success" : "outside_business_hours");
    return { status: mode === "failed" ? "Transfer to Senior Executive failed. Continue helping the customer yourself."
      : mode === "outside_business_hours" ? "Transfers are currently disabled outside of configured business hours." : "success" };
  },
  create_ticket: () => ({ status: "CREATED", ticket_id: nextTicketId() }),
};

export function callTool(s, name, args = {}) {
  const t0 = performance.now();
  let result;
  try { result = TOOLS[name] ? TOOLS[name](s, args) : { status: "UNKNOWN_TOOL" }; }
  catch (err) { result = { status: "TOOL_ERROR", error: err.message }; }
  const ms = performance.now() - t0;
  s.metrics.tool_ms = round(s.metrics.tool_ms + ms);
  const logged = name === "fetch_customer_details_by_phone_number" && result.customer ? { ...result, customer: { ...result.customer, addresses: `[${result.customer.addresses?.length || 0}]`, tickets: `[${result.customer.tickets?.length || 0}]` } } : result;
  s.tool_calls.push({ name, args, result: logged, latency_ms: round(ms, 1), at: new Date().toISOString(), turn: s.metrics.turns + 1 });
  s.events.push({ type: "tool", name, status: result.status ?? null });
  return result;
}
