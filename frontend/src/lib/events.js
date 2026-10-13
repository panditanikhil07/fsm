import { show } from './format';

// backend event -> chip label + tone, so every event type is visible without hard-coding states or lanes
const EVENT_VIEW = {
  lane_switch: (e) => ({ tone: 'lane', text: `lane ${e.from} → ${e.to}` }),
  jump_start: (e) => ({ tone: 'jump', text: `jump ${e.group}: ${e.from} → ${e.to}` }),
  jump_return: (e) => ({ tone: 'jump', text: `return → ${e.to}` }),
  retry: (e) => ({ tone: 'warn', text: `retry ${e.used}/${e.max} @ ${e.state}` }),
  exhausted: (e) => ({ tone: 'bad', text: `retries exhausted @ ${e.state} (${e.action})` }),
  give_up: (e) => ({ tone: 'bad', text: `too many invalid turns (${e.streak})` }),
  transfer: (e) => ({ tone: 'bad', text: `transfer ${e.reason} → ${e.result}` }),
  tool: (e) => ({ tone: 'tool', text: `tool ${e.name}${e.status ? ` · ${e.status}` : ''}` }),
  intent: (e) => ({ tone: 'intent', text: `intent ${e.id}` }),
  info_answer: (e) => ({ tone: 'lane', text: `info lane · ${e.state}` }),
  slot_set: (e) => ({ tone: 'slot', text: `${e.slot} = ${show(e.value)} (${e.via})` }),
  slots_discarded: (e) => ({ tone: 'warn', text: `discarded ${e.slots.join(', ')} (${e.why})` }),
  language_claim_ignored: (e) => ({ tone: 'muted', text: `ignored language claim "${e.claimed}" (not named by caller)` }),
  slots_rejected: (e) => ({ tone: 'warn', text: `dropped (not grounded in speech): ${e.slots.join(', ')}` }),
  implicit_update: (e) => ({ tone: 'jump', text: `restated ${e.slots.join(', ')} → treated as update` }),
  slot_ignored: (e) => ({ tone: 'muted', text: `ignored ${e.slot} (${e.why})` }),
  state_skipped: (e) => ({ tone: 'muted', text: `skipped ${e.state}` }),
  gate_missing: (e) => ({ tone: 'warn', text: `gate missing ${e.slots.join(', ')} → ${e.goto}` }),
  resume_loaded: (e) => ({ tone: 'jump', text: `resumed earlier call: ${e.slots.join(', ')}` }),
  llm_fallback: (e) => ({ tone: 'warn', text: `${e.call} LLM unavailable → rules` }),
  persisted: (e) => ({ tone: 'ok', text: `saved (${e.outcome}) → ${(e.files || []).join(', ')}` }),
};

export const eventChip = (e) => (EVENT_VIEW[e.type] ? EVENT_VIEW[e.type](e) : null);
