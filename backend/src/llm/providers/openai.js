// OpenAI (and any OpenAI-compatible endpoint: Azure, Groq, Together, vLLM, Ollama ...).
import { asText, postJson } from "./base.js";

export function createOpenAI(cfg, { timeoutMs }) {
  const baseUrl = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  return {
    name: "openai",
    enabled: () => !!cfg.apiKey,
    model: (tier) => (tier === "classifier" ? cfg.classifierModel || cfg.model : cfg.model),

    async chat({ model, system, user, json = true, temperature = 0, maxTokens = 400 }) {
      const data = await postJson(`${baseUrl}/chat/completions`, {
        label: "OpenAI", timeoutMs,
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: {
          model, temperature, max_tokens: maxTokens,
          ...(json ? { response_format: { type: "json_object" } } : {}),
          messages: [{ role: "system", content: system }, { role: "user", content: asText(user) }],
        },
      });
      return String(data?.choices?.[0]?.message?.content ?? "");
    },
  };
}
