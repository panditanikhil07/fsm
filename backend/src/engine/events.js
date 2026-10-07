// Per-turn event log. The UI renders these (lane switches, jumps, retries, tools, intents ...).
export const ev = (s, type, data = {}) => s.events.push({ type, ...data });
