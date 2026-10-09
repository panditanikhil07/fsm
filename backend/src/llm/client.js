// Provider-agnostic facade. classifier.js / capture.js only talk to this file; the actual vendor
// (OpenAI, Gemini, ...) lives in ./providers and is chosen by config.llm.provider.
import { getProvider } from "./providers/index.js";

export const llmEnabled = () => getProvider().enabled();
export const llmProvider = () => getProvider().name;

// One chat call with a hard timeout. Throws on any failure so callers can fall back.
//   tier: "main" | "classifier"  -> resolves the model name from the active provider's config
//   model: optional explicit override of the tier-resolved model
export async function chat({ tier = "main", model, system, user, json = true, temperature = 0, maxTokens = 400 }) {
  const provider = getProvider();
  let result = await provider.chat({ model: model || provider.model(tier), system, user, json, temperature, maxTokens });
  return result;
}

export function parseJson(text) {
  const t = String(text || "").trim();
  for (const candidate of [t, t.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1], t.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!candidate) continue;
    try { const v = JSON.parse(candidate); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* next */ }
  }
  return null;
}
