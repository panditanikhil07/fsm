// Google Gemini via the Generative Language REST API (generateContent).
import { asText, postJson } from "./base.js";

export function createGemini(cfg, { timeoutMs }) {
  const baseUrl = (
    cfg.baseUrl || "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/+$/, "");

  // Gemini 2.5 "thinking" tokens count against maxOutputTokens, so with our small budgets the
  // visible JSON can get cut off. Disable thinking on flash models unless explicitly configured.
  const thinkingBudget = (model) => {
    if (cfg.thinkingBudget !== undefined && cfg.thinkingBudget !== null)
      return Number(cfg.thinkingBudget);
    return /flash/i.test(model) ? 0 : undefined; // pro models cannot disable thinking
  };

  return {
    name: "gemini",
    enabled: () => !!cfg.apiKey,
    model: (tier) =>
      tier === "classifier" ? cfg.classifierModel || cfg.model : cfg.model,

    async chat({
      model,
      system,
      user,
      json = true,
      temperature = 0,
      maxTokens = 400,
    }) {
      const budget = thinkingBudget(model);
      try {
        const data = await postJson(
          `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
          {
            label: "Gemini",
            timeoutMs,
            headers: { "x-goog-api-key": cfg.apiKey },
            body: {
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: asText(user) }] }],
              generationConfig: {
                temperature,
                maxOutputTokens: maxTokens,
                ...(json ? { responseMimeType: "application/json" } : {}),
                ...(budget !== undefined
                  ? { thinkingConfig: { thinkingBudget: budget } }
                  : {}),
              },
            },
          },
        );
        if (data?.promptFeedback?.blockReason)
          throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
        const parts = data?.candidates?.[0]?.content?.parts || [];
        return parts
          .filter((p) => typeof p.text === "string" && !p.thought)
          .map((p) => p.text)
          .join("");
      } catch (err) {
        throw new Error(`Gemini error: ${err.message}`);
      }
    },
  };
}
