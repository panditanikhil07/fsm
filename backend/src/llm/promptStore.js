import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

const PROMPT_FILE = config.promptPath;

export function readPromptConfig() {
  try {
    if (fs.existsSync(PROMPT_FILE)) {
      const raw = fs.readFileSync(PROMPT_FILE, "utf8").trim();
      if (raw) return JSON.parse(raw);
    }
  } catch (err) {
    console.warn("Failed to parse prompt.json, using fallback defaults:", err.message);
  }
  return null;
}

export function writePromptConfig(data) {
  fs.mkdirSync(path.dirname(PROMPT_FILE), { recursive: true });
  fs.writeFileSync(PROMPT_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

