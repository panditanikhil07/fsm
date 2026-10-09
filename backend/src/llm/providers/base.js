// Provider contract. Every provider is a plain object:
//
//   {
//     name:    "openai" | "gemini" | ...,
//     enabled: () => boolean,                          // true when credentials are configured
//     model:   (tier) => string,                       // tier: "main" | "classifier"
//     chat:    async ({ model, system, user, json, temperature, maxTokens }) => string
//   }
//
// chat() must return the model's raw text and THROW on any failure (HTTP error, timeout, empty
// transport problem) so callers can fall back to the rule-based path.

export const asText = (user) => (typeof user === "string" ? user : JSON.stringify(user));

// fetch + hard timeout + uniform error shape ("<LABEL> <status>: <first 200 chars of body>")
export async function postJson(url, { headers = {}, body, timeoutMs, label = "LLM" }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${label} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}
