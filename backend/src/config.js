import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const trimSlash = (s) => (s ? String(s).replace(/\/+$/, "") : "");

const provider = (env.LLM_PROVIDER || (env.GEMINI_API_KEY && !(env.LLM_API_KEY || env.OPENAI_API_KEY) ? "gemini" : "openai")).toLowerCase();

export const config = {
  port: Number(env.PORT || 8000),
  dataDir: path.resolve(root, env.DATA_DIR || "data"),
  statesPath: env.STATES_PATH ? path.resolve(root, env.STATES_PATH) : path.join(root, "src/script/states.json"),
  sessionIdleMs: Number(env.SESSION_IDLE_MINUTES || 15) * 60_000,
  maxInputChars: 600,
  maxCallLog: 500,
  llm: {
    provider,
    timeoutMs: Number(env.LLM_TIMEOUT_MS || 6000),

    // OpenAI or any OpenAI-compatible endpoint (legacy LLM_* env names still work)
    openai: {
      apiKey: env.LLM_API_KEY || env.OPENAI_API_KEY || "",
      baseUrl: trimSlash(env.LLM_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
      model: env.LLM_MODEL || env.OPENAI_MODEL || "gpt-4o-mini",
      classifierModel: env.LLM_CLASSIFIER_MODEL || env.LLM_MODEL || env.OPENAI_MODEL || "gpt-4o-mini",
    },

    // Google Gemini
    gemini: {
      apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "",
      baseUrl: trimSlash(env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"),
      model: env.GEMINI_MODEL || "gemini-3.5-flash",
      classifierModel: env.GEMINI_CLASSIFIER_MODEL || env.GEMINI_MODEL || "gemini-3.5-flash-lite",
      // Leave unset to auto-disable thinking on *flash* models (prevents truncated JSON).
      ...(env.GEMINI_THINKING_BUDGET !== undefined && env.GEMINI_THINKING_BUDGET !== "" ? { thinkingBudget: Number(env.GEMINI_THINKING_BUDGET) } : {}),
    },
  },
  transfer: { hours: env.TRANSFER_HOURS || "00:00-23:59", force: env.TRANSFER_FORCE || "" },
};