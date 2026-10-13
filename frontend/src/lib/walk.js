// Client-side dry run: walks a script without the engine so a flow can be read like a conversation.
import { truncate } from './format';

export function sayOf(st, lang) {
  if (!st) return '';
  return st.reply_template?.[lang]
    || st.announce_template?.[lang]
    || (st.reply_template_by_reason && Object.values(st.reply_template_by_reason)[0]?.[lang])
    || '';
}

export function optionsOf(script, name) {
  const st = script.states[name];
  if (!st) return [];
  const out = (st.transitions || []).map((t, i) => ({ id: `t${i}`, goto: t.goto, label: t.condition || '(no condition)', kind: 'transition' }));
  if (st.next) out.push({ id: 'next', goto: st.next, label: out.length ? 'otherwise (next)' : 'next', kind: 'next' });
  if (st.on_exhausted && script.states[st.on_exhausted]) {
    out.push({ id: 'exh', goto: st.on_exhausted, label: `after ${st.max_retries ?? script.meta?.default_max_retries ?? 3} failed attempts`, kind: 'exhausted' });
  }
  return out.filter((o) => script.states[o.goto]);
}

export const describe = (st) => truncate(st?.prompt || '', 140);
