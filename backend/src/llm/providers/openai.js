// OpenAI (and any OpenAI-compatible endpoint: Azure, Groq, Together, vLLM, Ollama ...).
import { asText, postJson } from "./base.js";

export function createOpenAI(cfg, { timeoutMs }) {
  const baseUrl = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  return {
    name: "openai",
    enabled: () => !!cfg.apiKey,
    model: (tier) => (tier === "classifier" ? cfg.classifierModel || cfg.model : cfg.model),

    async chat({ model, system, user, json = true, temperature = 0, maxTokens = 400 }) {
      const request = {
        model, temperature, max_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: system }, { role: "user", content: asText(user) }],
      };
      const data = await postJson(`${baseUrl}/chat/completions`, {
        label: "OpenAI", timeoutMs,
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: request,
      });
      const text = String(data?.choices?.[0]?.message?.content ?? "");
      const usage = data?.usage || {};
      return {
        text,
        output_response: text,
        input_prompt: JSON.stringify({ model, system, user, request }, null, 2),
        usage: {
          provider: "openai",
          model,
          input_tokens: usage.prompt_tokens ?? null,
          output_tokens: usage.completion_tokens ?? null,
          total_tokens: usage.total_tokens ?? null,
          input_prompt: JSON.stringify({ model, system, user, request }, null, 2),
          output_response: text,
        },
      };
    },
  };
}
