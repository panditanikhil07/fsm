# config.js — `llm` section

```js
llm: {
  provider: process.env.LLM_PROVIDER || "openai",      // "openai" | "gemini"
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 4000),

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,               // optional (Azure / Groq / vLLM ...)
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    classifierModel: process.env.OPENAI_CLASSIFIER_MODEL || "gpt-4o-mini",
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    classifierModel: process.env.GEMINI_CLASSIFIER_MODEL || "gemini-2.5-flash-lite",
    // thinkingBudget: 0,                               // optional; defaults to 0 on *flash* models
  },
},
```

Legacy flat keys (`llm.apiKey`, `llm.baseUrl`, `llm.model`, `llm.classifierModel`) still work for OpenAI.

## Adding another provider
Create `providers/<name>.js` exporting a factory `(cfg, { timeoutMs }) => ({ name, enabled, model, chat })`
(see `providers/base.js`), then add it to `FACTORIES` in `providers/index.js` (or call `registerProvider`).
