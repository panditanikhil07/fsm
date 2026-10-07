export const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
export const isFilled = (v) => v !== undefined && v !== null && v !== "";
export const titleCase = (s) =>
  String(s).toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
export const spaced = (d) => String(d ?? "").split("").join(" ");
export const round = (n, d = 2) => Number(Number(n).toFixed(d));
export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const hasWord = (text, word) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
