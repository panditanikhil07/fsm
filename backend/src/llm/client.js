import { config } from "../config.js";

export const llmEnabled = () => !!config.llm.apiKey;

// One OpenAI-compatible chat call with a hard timeout. Throws on any failure so callers can fall back.
export async function chat({ model, system, user, json = true, temperature = 0, maxTokens = 400 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.llm.timeoutMs);
  try {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.llm.apiKey}` },
      body: JSON.stringify({
        model, temperature, max_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: system }, { role: "user", content: typeof user === "string" ? user : JSON.stringify(user) }],
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return String(data?.choices?.[0]?.message?.content ?? "");
  } finally { clearTimeout(timer); }
}

export function parseJson(text) {
  const t = String(text || "").trim();
  for (const candidate of [t, t.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1], t.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!candidate) continue;
    try { const v = JSON.parse(candidate); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* next */ }
  }
  return null;
}
