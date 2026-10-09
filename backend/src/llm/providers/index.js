// Provider registry. Select with config.llm.provider ("openai" | "gemini"); defaults to "openai".
//
// Expected config shape (see README below). Flat legacy keys (config.llm.apiKey / baseUrl / model /
// classifierModel) are still honoured for OpenAI so existing deployments keep working.
//
//   config.llm = {
//     provider: "gemini",
//     timeoutMs: 4000,
//     openai: { apiKey, baseUrl?, model, classifierModel },
//     gemini: { apiKey, baseUrl?, model, classifierModel, thinkingBudget? },
//   }
import { config } from "../../config.js";
import { createOpenAI } from "./openai.js";
import { createGemini } from "./gemini.js";

const FACTORIES = { openai: createOpenAI, gemini: createGemini };
let cached = null, cachedKey = null;

export function getProvider() {
  const llm = config.llm || {};
  const name = String(llm.provider || "gemini").toLowerCase();
  if (!FACTORIES[name]) throw new Error(`Unknown LLM provider "${name}". Available: ${Object.keys(FACTORIES).join(", ")}`);
  const cfg = name === "openai"
    ? { apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model, classifierModel: llm.classifierModel, ...(llm.openai || {}) }
    : { ...(llm[name] || {}) };
  const key = JSON.stringify([name, cfg, llm.timeoutMs]);
  if (!cached || key !== cachedKey) { cached = FACTORIES[name](cfg, { timeoutMs: llm.timeoutMs ?? 4000 }); cachedKey = key; }
  return cached;
}

export const registerProvider = (name, factory) => { FACTORIES[name.toLowerCase()] = factory; cached = null; };
