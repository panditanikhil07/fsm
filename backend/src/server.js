import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { publicScript } from "./script/index.js";
import { createSession, snapshot } from "./engine/session.js";
import { handleTurn } from "./engine/turn.js";
import { initStore, finalizeCall, listCustomers, getCustomer, listCalls, patchTicket, deleteCustomer } from "./store/customerStore.js";
import { llmEnabled } from "./llm/client.js";
import { validMobile } from "./utils/digits.js";

await initStore();
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
const sessions = new Map();
const DEFAULT_CALLER = "9000000000";

const callerOf = (body) => String(body?.caller_number ?? DEFAULT_CALLER).replace(/\D/g, "");
const bad = (res, status, error) => res.status(status).json({ error });

async function startSession(callerNumber, previous) {
  if (previous && !previous.flags.terminal) await finalizeCall(previous, "reset");    // abandoned call is still saved
  const s = createSession(randomUUID(), callerNumber);
  sessions.set(s.id, s);
  return s;
}

app.get("/api/health", (req, res) => res.json({ ok: true, llm: llmEnabled(), sessions: sessions.size, time: new Date().toISOString() }));
app.get("/api/states", (req, res) => res.json(publicScript()));

app.post("/api/session", async (req, res) => {
  const caller = callerOf(req.body);
  if (!validMobile(caller)) return bad(res, 400, "caller_number must be a valid 10-digit mobile number");
  res.json(snapshot(await startSession(caller)));
});
app.post("/api/session/reset", async (req, res) => {
  const prev = sessions.get(req.body?.session_id);
  const caller = req.body?.caller_number ? callerOf(req.body) : prev?.caller_number || DEFAULT_CALLER;
  if (!validMobile(caller)) return bad(res, 400, "caller_number must be a valid 10-digit mobile number");
  res.json(snapshot(await startSession(caller, prev)));
});
app.post("/api/session/end", async (req, res) => {       // caller hung up
  const s = sessions.get(req.body?.session_id);
  if (!s) return bad(res, 404, "Session not found");
  const result = s.flags.terminal ? s.persisted : await finalizeCall(s, "hangup");
  s.flags.terminal = true;
  res.json({ ...snapshot(s), persisted: result });
});
app.get("/api/session/:id", (req, res) => {
  const s = sessions.get(req.params.id);
  return s ? res.json(snapshot(s)) : bad(res, 404, "Session not found");
});

app.post("/api/turn", async (req, res) => {
  const s = sessions.get(req.body?.session_id);
  if (!s) return bad(res, 404, "Session not found");
  const text = String(req.body?.text ?? "");
  if (!text.trim() && !req.body?.silence) return bad(res, 400, "text is required (or send silence: true)");
  try {
    const item = await handleTurn(s, req.body?.silence ? "" : text);
    res.json({ ...snapshot(s), history_item: item });
  } catch (err) {
    console.error("turn failed", err);
    res.status(500).json({ error: "turn failed", detail: err.message });
  }
});

// ---- stored data (debug / admin) ----
app.get("/api/customers", (req, res) => res.json(listCustomers()));
app.get("/api/customers/:phone", (req, res) => { const c = getCustomer(req.params.phone); return c ? res.json(c) : bad(res, 404, "Customer not found"); });
app.delete("/api/customers/:phone", async (req, res) => res.json({ deleted: await deleteCustomer(req.params.phone) }));
app.patch("/api/customers/:phone/tickets/:ticket", async (req, res) => {
  const t = await patchTicket(req.params.phone, req.params.ticket, { status: req.body?.status });
  return t ? res.json(t) : bad(res, 404, "Ticket not found");
});
app.get("/api/calls", (req, res) => res.json(listCalls(Number(req.query.limit) || 50)));

// idle sessions: persist whatever was captured, then drop them
setInterval(async () => {
  for (const [id, s] of sessions) {
    if (Date.now() - s.last_active < config.sessionIdleMs) continue;
    if (!s.flags.terminal) await finalizeCall(s, "idle_timeout").catch((e) => console.error("finalize failed", e));
    sessions.delete(id);
  }
}, 60_000).unref();

app.listen(config.port, () => console.log(`Roshni FSM backend on http://localhost:${config.port}  (LLM: ${llmEnabled() ? config.llm.provider : "off → rule fallback"})`));
