import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// isolated data dir + no LLM key => deterministic rule fallback
const dir = mkdtempSync(path.join(tmpdir(), "roshni-"));
cpSync(new URL("../data", import.meta.url).pathname, dir, { recursive: true });
process.env.DATA_DIR = dir;
process.env.LLM_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { initStore, finalizeCall, getCustomer } = await import("../src/store/customerStore.js");
const { createSession } = await import("../src/engine/session.js");
const { handleTurn } = await import("../src/engine/turn.js");
await initStore();

const say = async (s, text) => (await handleTurn(s, text));
const run = async (s, lines) => { let last; for (const l of lines) last = await say(s, l); return last; };
const NEW_CALL = ["English", "same number", "homeowner", "Rohit Sen", "tap", "Grohe",
  "12 MG Road, Sector 15, Noida, Uttar Pradesh 201301", "yes"];

test("new caller: full call registers a ticket, persists customer + call log, reuses it next time", async () => {
  const s = createSession("t1", "9123456780");
  assert.match(s.last_reply, /Welcome to American Standard/);
  const last = await run(s, [...NEW_CALL, "residential", "Rohit Sen", "yes"]);
  assert.match(last.assistant, /registered/);
  assert.equal(s.state, "REGISTER_COMPLAINT");
  const end = await say(s, "5");
  assert.ok(s.flags.terminal, "call should end after rating");
  assert.equal(s.persisted.outcome, "completed");
  const rec = getCustomer("9123456780");
  assert.equal(rec.first_name, "Rohit");
  assert.equal(rec.addresses[0].pin_code, "201301");
  assert.equal(rec.tickets[0].status, "open");
  assert.equal(JSON.parse(readFileSync(path.join(dir, "calls.json"), "utf8")).at(-1).call_id, "t1");

  // same number calls again -> record retrieved by tool, open ticket => transfer
  const s2 = createSession("t2", "9123456780");
  assert.match(s2.last_reply, /Welcome back.*Rohit Sen/);
  const r = await run(s2, ["English yes", "same number"]);
  assert.match(r.assistant, /open service request/);
  assert.equal(s2.lane, "TRANSFER");
  assert.ok(s2.tool_calls.some((t) => t.name === "fetch_customer_details_by_phone_number"));
});

test("returning customer with closed ticket skips identity/new-customer lanes and confirms the saved address", async () => {
  const s = createSession("t3", "9999999999");
  await run(s, ["English yes", "same"]);
  assert.equal(s.state, "CAPTURE_PRODUCT");
  await say(s, "shower");
  await say(s, "american standard");
  assert.equal(s.state, "ADDRESS_CONFIRM_EXISTING");
  assert.match(s.last_reply, /12 MG Road/);
});

test("volunteering later answers fills them and skips those steps", async () => {
  const s = createSession("t4", "9111111111");
  await run(s, ["English", "same number"]);
  const r = await say(s, "homeowner, my grohe shower is leaking");
  assert.equal(s.slots.product, "shower");
  assert.equal(s.slots.brand, "grohe");
  assert.equal(s.state, "CAPTURE_FIRST_NAME");
  await say(s, "Rohit Sen");
  assert.equal(s.state, "ADDRESS_COLLECT", "product and brand steps are skipped");
  assert.ok(s.history.some((h) => h.events.some((e) => e.type === "state_skipped")));
});

test("nonsense: valid reply first, re-ask, then on_exhausted after max retries", async () => {
  const s = createSession("t5", "9222222222");
  await run(s, ["English", "same number"]);
  assert.equal(s.state, "CAPTURE_CALLER_TYPE");           // max_retries = 1
  const r1 = await say(s, "banana purple window");
  assert.match(r1.assistant, /didn't quite catch|catch that/i);
  assert.match(r1.assistant, /\?/, "question is asked again");
  assert.deepEqual(r1.events.find((e) => e.type === "retry").used, 1);
  assert.equal(s.state, "CAPTURE_CALLER_TYPE");
  await say(s, "asdf qwer");
  assert.equal(s.slots.caller_type, "other", "stored as Other after retries are used up");
  assert.equal(s.state, "CAPTURE_FIRST_NAME");
});

test("lane jump: update the pin code from the contact step, then resume where the call was", async () => {
  const s = createSession("t6", "9333333333");
  await run(s, [...NEW_CALL, "residential"]);
  assert.equal(s.state, "CONTACT_PERSON");
  const j = await say(s, "actually my pin code is 110001");
  assert.ok(j.events.some((e) => e.type === "jump_start" && e.group === "address"));
  assert.ok(j.events.some((e) => e.type === "lane_switch" && e.to === "ADDRESS"));
  assert.equal(s.slots.pin_code, "110001");
  assert.equal(s.state, "ADDRESS_CONFIRM_NEW");
  assert.ok(s.jump && s.jump.resume === "CONTACT_PERSON");
  const back = await say(s, "yes");
  assert.ok(back.events.some((e) => e.type === "jump_return"));
  assert.equal(s.state, "CONTACT_PERSON");
  assert.equal(s.jump, null);
  assert.equal(s.slots.pin_code, "110001");
});

test("recall reads details back without moving the flow", async () => {
  const s = createSession("t7", "9444444444");
  await run(s, [...NEW_CALL, "residential"]);
  const r = await say(s, "what is my address");
  assert.match(r.assistant, /Noida/);
  assert.equal(s.state, "CONTACT_PERSON");
  assert.match(r.assistant, /contact|person|name/i, "pending question is asked again");
});

test("dropped call is saved and resumed on the next call from that number", async () => {
  const s = createSession("t8", "9555555555");
  await run(s, ["English", "same number", "plumber", "Asha Rao", "faucet"]);
  await finalizeCall(s, "hangup");
  const s2 = createSession("t9", "9555555555");
  assert.equal(s2.flags.resumed_previous, true);
  assert.equal(s2.slots.first_name, "Asha");
  const r = await say(s2, "English");
  assert.match(r.assistant, /disconnected/i);
  await say(s2, "same number");
  assert.equal(s2.state, "CAPTURE_BRAND", "caller type, name and product are already known");
});

test("post-registration change requests are transferred, human request transfers", async () => {
  const s = createSession("t10", "9666000001");
  await run(s, ["English", "same number", "homeowner", "Rohit Sen", "tap", "Grohe", "12 MG Road, Sector 15, Noida, Uttar Pradesh 201301", "yes", "residential", "Rohit Sen", "yes"]);
  const r = await say(s, "I want to talk to a human agent");
  assert.match(r.assistant, /Senior Executive/);
  assert.equal(s.persisted.outcome, "transferred");
});

test("two LLM calls per turn (classifier + capture/response) when a key is configured", async () => {
  process.env.LLM_API_KEY = "x";
  const { config } = await import("../src/config.js");
  config.llm.apiKey = "x";
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const sys = body.messages[0].content;
    const kind = sys.includes("intent classifier") ? "classifier" : "capture";
    seen.push(kind);
    const content = kind === "classifier"
      ? { intents: ["answer", "warranty"], update_targets: [], recall_targets: [], yes_no: null, language: "english", reason: "t" }
      : { slots: { language: { value: "english", evidence: "English" } }, lead: "Warranty is confirmed after inspection." };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
  };
  try {
    const s = createSession("t11", "9777000001");
    const item = await say(s, "English, and is there warranty?");
    assert.deepEqual(seen, ["classifier", "capture"]);
    assert.match(item.assistant, /^Warranty is confirmed after inspection\./);
    assert.equal(s.slots.language, "english");
    assert.ok(item.classification.source === "llm" && item.capture.source === "llm");
  } finally { globalThis.fetch = realFetch; config.llm.apiKey = ""; }
});

test("regression: a question is not treated as an answer; language request switches language without advancing", async () => {
  const { config } = await import("../src/config.js");
  config.llm.apiKey = "x";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const sys = JSON.parse(init.body).messages[0].content;
    const utterance = JSON.parse(JSON.parse(init.body).messages[1].content).utterance;
    const content = sys.includes("intent classifier")
      ? { intents: ["answer"], update_targets: [], recall_targets: [], yes_no: "yes", language: /hindi/i.test(utterance) ? "hindi" : "english", reason: "t" }
      // hallucinated slots: evidence is not in the utterance
      : { slots: { service_number_choice: { value: "same", evidence: "this number" }, caller_type: { value: "homeowner", evidence: "owner" } }, lead: "" };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
  };
  try {
    const s = createSession("t12", "9888000001");
    await say(s, "English");
    assert.equal(s.state, "SERVICE_NUMBER_CHOICE");
    const r = await say(s, "kya aap hindi mai baat kar sakte hai");
    assert.equal(s.state, "SERVICE_NUMBER_CHOICE", "must not advance on an unrelated utterance");
    assert.equal(s.slots.service_number_choice, undefined);
    assert.equal(s.slots.caller_type, undefined);
    assert.equal(s.language, "hindi");
    assert.match(r.assistant, /Hindi mein/);
    assert.equal(r.events.some((e) => e.type === "retry"), false, "language switch is not a failed attempt");
  } finally { globalThis.fetch = realFetch; config.llm.apiKey = ""; }
});
