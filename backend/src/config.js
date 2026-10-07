import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;

export const config = {
  port: Number(env.PORT || 8000),
  dataDir: path.resolve(root, env.DATA_DIR || "data"),
  statesPath: env.STATES_PATH ? path.resolve(root, env.STATES_PATH) : path.join(root, "src/script/states.json"),
  sessionIdleMs: Number(env.SESSION_IDLE_MINUTES || 15) * 60_000,
  maxInputChars: 600,
  maxCallLog: 500,
  llm: {
    apiKey: env.LLM_API_KEY || env.OPENAI_API_KEY || "",
    baseUrl: (env.LLM_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: env.LLM_MODEL || env.OPENAI_MODEL || "gpt-4o-mini",
    classifierModel: env.LLM_CLASSIFIER_MODEL || env.LLM_MODEL || env.OPENAI_MODEL || "gpt-4o-mini",
    timeoutMs: Number(env.LLM_TIMEOUT_MS || 6000),
  },
  transfer: { hours: env.TRANSFER_HOURS || "00:00-23:59", force: env.TRANSFER_FORCE || "" },
};
