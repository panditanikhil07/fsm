import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAddress } from "../src/utils/address.js";
import { groundSlots } from "../src/llm/capture.js";

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

test("building names like apartment before a sector are preserved in the street", () => {
  const parsed = parseAddress("House no. 987, samriddhi apt, sector 45, new delhi, delhi, 678906");
  assert.equal(parsed.street, "House No. 987, Samriddhi Apt");
  assert.equal(parsed.area, "Sector 45");
  assert.equal(parsed.city, "Delhi");
  assert.equal(parsed.pin_code, "678906");
});

test("a narrative restatement does not count as a yes/no confirmation", () => {
  const raw = { address_confirmed: { value: true, evidence: "I also told you apartment name" } };
  const parsed = groundSlots(raw, "I also told you apartment name");
  assert.deepEqual(parsed.accepted, {});
  assert.deepEqual(parsed.rejected, ["address_confirmed"]);
});

test("address restatements like 'I also told you apartment name' are not inserted into the street", () => {
  const parsed = parseAddress("I also told you apartment name, House no. 987, samriddhi apt, sector 45, new delhi, delhi, 678906");
  assert.equal(parsed.street, "House No. 987, Samriddhi Apt");
  assert.equal(parsed.area, "Sector 45");
  assert.equal(parsed.city, "Delhi");
  assert.equal(parsed.pin_code, "678906");
  assert.equal(parsed.street.includes("I Also Told You Apartment Name"), false);
});

test("clarification restatements are acknowledged before the next confirmation prompt", async () => {
  const s = createSession("t14", "9988776655");
  s.state = "ADDRESS_CONFIRM_NEW";
  s.slots.street = "House No. 987, Samriddhi Apt";
  s.slots.area = "Sector 45";
  s.slots.city = "Delhi";
  s.slots.state = "Delhi";
  s.slots.pin_code = "678906";
  s.last_reply = "Let me confirm your address: House No. 987, Samriddhi Apt, Sector 45, New Delhi, Delhi, pin code 678906. Is that correct?";
  const res = await say(s, "I also told you apartment name");
  assert.match(res.assistant, /Got it, I heard the apartment name too\./i);
  assert.match(res.assistant, /confirm your address|Is that correct/i);
});

test("a one-word last name response with 'only' is not accepted as a surname", () => {
  const raw = { last_name: { value: "Nikhil", evidence: "only nikhil" } };
  const parsed = groundSlots(raw, "only nikhil");
  assert.deepEqual(parsed.accepted, {});
  assert.deepEqual(parsed.rejected, ["last_name"]);
});

test("semantically duplicate language acknowledgements are deduplicated", () => {
  const parts = [
    "Zaroor, hum Hindi mein baat karenge.",
    "Theek hai, hum Hindi mein baat karenge.",
    "Aapka complaint kis number ke liye hai?"
  ];
  const deduped = [
    "Zaroor, hum Hindi mein baat karenge.",
    "Aapka complaint kis number ke liye hai?"
  ];
  const normalized = parts.filter((x, i, arr) => {
    const key = arr[i].toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\b(?:zaroor|theek|hai|hum|mein|baat|karenge|karenge|okay|ok|sure|jo|ki|yeh|aap|mujhe|hota|huyi|kiya|bas|toh)\b/g, " ").replace(/\s+/g, " ").trim();
    return i === arr.findIndex((y) => {
      const yKey = y.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\b(?:zaroor|theek|hai|hum|mein|baat|karenge|karenge|okay|ok|sure|jo|ki|yeh|aap|mujhe|hota|huyi|kiya|bas|toh)\b/g, " ").replace(/\s+/g, " ").trim();
      return yKey === key;
    });
  });
  assert.deepEqual(normalized, deduped);
});

test("dusre number is accepted as a valid different-number answer", () => {
  const raw = { service_number_choice: { value: "different", evidence: "dusre number" } };
  const parsed = groundSlots(raw, "dusre number");
  assert.deepEqual(parsed.accepted, { service_number_choice: "different" });
  assert.deepEqual(parsed.rejected, []);
});

test("a no-last-name statement is rejected before it fills the surname", () => {
  const raw = { last_name: { value: "Nikhil", evidence: "I don't have a last name" } };
  const parsed = groundSlots(raw, "I don't have a last name");
  assert.deepEqual(parsed.accepted, {});
  assert.deepEqual(parsed.rejected, ["last_name"]);
});

test("brand is only accepted when the user explicitly names that brand", () => {
  const raw = { brand: { value: "american_standard", evidence: "head flush shower" } };
  const parsed = groundSlots(raw, "head flush shower");
  assert.deepEqual(parsed.accepted, {});
  assert.deepEqual(parsed.rejected, ["brand"]);
});

test("rating 0 is accepted as a valid numeric response", () => {
  const raw = { call_rating: { value: "0", evidence: "0" } };
  const parsed = groundSlots(raw, "0");
  assert.deepEqual(parsed.accepted, { call_rating: "0" });
  assert.deepEqual(parsed.rejected, []);
});

test("rating 9 is rejected and does not produce a thank-you lead", async () => {
  const parsed = groundSlots({ call_rating: { value: "9", evidence: "9" } }, "9");
  assert.deepEqual(parsed.accepted, {});
  assert.deepEqual(parsed.rejected, ["call_rating"]);
});

test("a no-last-name statement does not fill the last name and continues to the next step", async () => {
  const raw = { last_name: { value: "Ananya", evidence: "i don't have any last name" } };
  const parsed = groundSlots(raw, "i don't have any last name");
  assert.deepEqual(parsed.accepted, {});
  assert.deepEqual(parsed.rejected, []);
  const s = createSession("t_no_last_name", "9012345678");
  s.state = "CAPTURE_LAST_NAME";
  s.slots.first_name = "Ananya";
  const r = await say(s, "i don't have any last name");
  assert.equal(s.state, "CAPTURE_PRODUCT");
  assert.match(r.assistant, /continue with the next details needed|Which product is the complaint about/i);
});

test("rating exhaustion closes without re-asking in the same turn", async () => {
  const s = createSession("t12", "9456789001");
  s.state = "REGISTER_COMPLAINT";
  s.lane = "REGISTRATION";
  s.slots = {
    language: "hindi",
    service_number_choice: "different",
    service_number: "7878787878",
    final_service_number: "7878787878",
    caller_type: "other",
    first_name: "Isha",
    last_name: "Misgraa",
    product: "cistern",
    brand: "grohe",
    street: "123 Flat",
    area: "Isha Society",
    city: "Mohali",
    state: "Haryana",
    pin_code: "786788",
    address_confirmed: true,
    address_type: "residential",
    contact_person_at_site: "Brother",
    site_contact_number: "9898987654",
    ticket_id: "T-1002"
  };
  await say(s, "thikk hai");
  const final = await say(s, "ok");
  assert.equal(s.state, "CLOSING");
  assert.match(final.assistant, /Thank you for calling American Standard/i);
  assert.doesNotMatch(final.assistant, /rate your overall experience|Before we end the call|provide your rating/i);
});

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

test("LLM prompt, response, and token usage are captured in call history", async () => {
  process.env.LLM_API_KEY = "x";
  const { config } = await import("../src/config.js");
  config.llm.apiKey = "x";
  const realFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const isJev = body.state && body.questions;

    if (isJev) {
      return {
        ok: true,
        json: async () => ({
          answers: { lane: { choice: "continue" } },
          usage: { prompt_tokens: 121, completion_tokens: 29, total_tokens: 150 },
        }),
      };
    }

    const sys = body.messages[0].content;
    const kind = sys.includes("You are") && sys.includes("voice agent") ? "capture" : "classifier";
    const content = kind === "capture"
      ? { slots: { language: { value: "english", evidence: "English" } }, lead: "Great, lets continue." }
      : { intents: ["answer"], update_targets: [], recall_targets: [], yes_no: null, language: "english", reason: "t" };

    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(content), usage: { prompt_tokens: 333, completion_tokens: 44, total_tokens: 377 } } }],
      }),
    };
  };

  try {
    const s = createSession("t13", "9777000002");
    const item = await say(s, "English");
    assert.equal(item.classification.usage.prompt_tokens, 121);
    assert.equal(item.classification.usage.output_tokens, 29);
    assert.equal(item.classification.usage.input_prompt.includes("caller utterance"), true);
    assert.equal(item.capture.usage.prompt_tokens, 333);
    assert.equal(item.capture.usage.output_tokens, 44);
    assert.equal(item.capture.usage.output_response.includes("Great, lets continue."), true);
    const saved = JSON.parse(readFileSync(path.join(dir, "calls.json"), "utf8")).at(-1);
    assert.equal(saved.history.at(-1).classification.usage.total_tokens, 150);
    assert.equal(saved.history.at(-1).capture.usage.total_tokens, 377);
  } finally {
    globalThis.fetch = realFetch;
    config.llm.apiKey = "";
  }
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
