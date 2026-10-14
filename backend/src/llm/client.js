// Provider-agnostic facade. classifier.js / capture.js only talk to this file; the actual vendor
// (OpenAI, Gemini, ...) lives in ./providers and is chosen by config.llm.provider.
import { getProvider } from "./providers/index.js";

export const llmEnabled = () => getProvider().enabled();
export const llmProvider = () => getProvider().name;

function normalizeMetadata(result, fallbackText, provider, model) {
  const text = typeof result === "string" ? result : (result?.text ?? result?.output_response ?? fallbackText ?? "");
  const outputResponse = typeof result === "string" ? result : (result?.output_response ?? text ?? "");
  const usage = result?.usage || null;
  return {
    text: String(text || ""),
    output_response: String(outputResponse || ""),
    usage: usage && typeof usage === "object" ? usage : null,
    input_prompt: result?.input_prompt ?? null,
    provider: result?.provider ?? provider,
    model: result?.model ?? model,
    raw: result?.raw ?? null,
  };
}

// One chat call with a hard timeout. Throws on any failure so callers can fall back.
//   tier: "main" | "classifier"  -> resolves the model name from the active provider's config
//   model: optional explicit override of the tier-resolved model
export async function chatWithMeta({ tier = "main", model, system, user, json = true, temperature = 0, maxTokens = 400 }) {
  const provider = getProvider();
  const resolvedModel = model || provider.model(tier);
  const result = await provider.chat({ model: resolvedModel, system, user, json, temperature, maxTokens });
  return normalizeMetadata(result, typeof result === "string" ? result : "", provider.name, resolvedModel);
}

export async function chat({ tier = "main", model, system, user, json = true, temperature = 0, maxTokens = 400 }) {
  const result = await chatWithMeta({ tier, model, system, user, json, temperature, maxTokens });
  return result.text || result.output_response || "";
}

export function parseJson(text) {
  const t = String(text || "").trim();
  for (const candidate of [t, t.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1], t.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!candidate) continue;
    try { const v = JSON.parse(candidate); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* next */ }
  }
  return null;
}
