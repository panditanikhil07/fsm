import { useState } from 'react';
import { Field, JsonField, Section, TagPicker, Toggle } from '../../components/fields';
import { langKeys, STATE_TYPES, TOOL_WHEN, deleteState, entryState, renameState, setEntry, toStateId } from '../../lib/script';

const TABS = [['basics', 'Basics'], ['replies', 'Replies'], ['routing', 'Routing'], ['tools', 'Tools'], ['json', 'JSON']];
const EXTRA_TEMPLATES = ['confirm_template', 'alternate_ask_template', 'followup_template', 'announce_template', 'recovery_template'];

export default function StateInspector({ script, name, update, issues, onRename, onDeleted, tab, setTab }) {
  const st = script.states[name];
  if (!st) return <div className="empty">Select a state on the canvas, or add one.</div>;

  const set = (patch, key) => update((d) => { Object.assign(d.states[name], patch); }, key && `${name}:${key}`);
  const del = (field) => update((d) => { delete d.states[name][field]; });
  const mine = issues.filter((i) => i.state === name);
  const stateNames = Object.keys(script.states).filter((n) => n !== name);
  const slotNames = Object.keys(script.slots || {});

  return (
    <div className="inspectorBody">
      <div className="inspectorHead">
        <div><small>STATE</small><h3>{name}</h3></div>
        <button className="danger ghost" onClick={() => { update((d) => deleteState(d, name)); onDeleted(); }}>Delete</button>
      </div>

      {mine.length > 0 && (
        <ul className="issueList compact">
          {mine.map((i, k) => <li key={k} className={i.level}>{i.msg}</li>)}
        </ul>
      )}

      <div className="subTabs">
        {TABS.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === 'basics' && (
        <>
          <Field label="State id" hint="UPPER_SNAKE_CASE; references are updated everywhere">
            <RenameInput value={name} existing={script.states} onCommit={(to) => onRename(name, to)} />
          </Field>
          <div className="row2">
            <Field label="Type">
              <select value={st.type} onChange={(e) => set({ type: e.target.value })}>{STATE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </Field>
            <Field label="Lane">
              <select value={st.lane} onChange={(e) => set({ lane: e.target.value })}>
                {!script.lanes.some((l) => l.id === st.lane) && <option value={st.lane}>{st.lane} (undefined)</option>}
                {script.lanes.map((l) => <option key={l.id} value={l.id}>{l.label || l.id}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Prompt" hint="instruction for the response LLM — what this turn must achieve">
            <textarea rows={4} value={st.prompt || ''} onChange={(e) => set({ prompt: e.target.value }, 'prompt')} />
          </Field>

          <Section title="Slots collected here">
            <Field label="Required"><TagPicker value={st.required_slots} options={slotNames} onChange={(v) => set({ required_slots: v })} /></Field>
            <Field label="Optional"><TagPicker value={st.optional_slots} options={slotNames} onChange={(v) => set({ optional_slots: v })} /></Field>
          </Section>

          <Section title="Behaviour">
            <div className="toggles">
              <Toggle label="Skippable" checked={st.skippable} onChange={(v) => set({ skippable: v })} hint="skip when its slots are already filled" />
              <Toggle label="Terminal (ends call)" checked={st.terminal} onChange={(v) => (v ? set({ terminal: true }) : del('terminal'))} />
              <Toggle label="On demand (info lane)" checked={st.on_demand} onChange={(v) => (v ? set({ on_demand: true, return_to: st.return_to || 'LAST_PENDING_STATE' }) : update((d) => { delete d.states[name].on_demand; delete d.states[name].return_to; }))} />
              <Toggle label="Confirm by reading back" checked={st.confirm} onChange={(v) => (v ? set({ confirm: true }) : del('confirm'))} />
              <Toggle label="Re-run on correction" checked={st.rerun_on_correction} onChange={(v) => (v ? set({ rerun_on_correction: true }) : del('rerun_on_correction'))} />
              <Toggle label="Spoken once" checked={st.spoken_once} onChange={(v) => (v ? set({ spoken_once: true }) : del('spoken_once'))} />
            </div>
            <div className="row2">
              <Field label="Max retries" hint={`default ${script.meta?.default_max_retries ?? 3}`}>
                <input type="number" min="0" value={st.max_retries ?? ''} placeholder="default" onChange={(e) => (e.target.value === '' ? del('max_retries') : set({ max_retries: Number(e.target.value) }))} />
              </Field>
              <Field label="When retries run out">
                <input list="exhaust-options" value={st.on_exhausted || ''} placeholder="state or action" onChange={(e) => (e.target.value ? set({ on_exhausted: e.target.value }, 'exh') : del('on_exhausted'))} />
                <datalist id="exhaust-options">
                  {stateNames.map((n) => <option key={n} value={n} />)}
                  <option value="skip_and_continue" />
                </datalist>
              </Field>
            </div>
            {st.on_demand && (
              <Field label="Return to after answering" hint="LAST_PENDING_STATE resumes where the caller was">
                <input list="exhaust-options" value={st.return_to || ''} onChange={(e) => set({ return_to: e.target.value }, 'ret')} />
              </Field>
            )}
            <div className="row2">
              <Field label="Skip if" hint="condition"><input value={st.skip_if || ''} onChange={(e) => (e.target.value ? set({ skip_if: e.target.value }, 'skip') : del('skip_if'))} /></Field>
              <Field label="Guard" hint="must hold to enter"><input value={st.guard || ''} onChange={(e) => (e.target.value ? set({ guard: e.target.value }, 'guard') : del('guard'))} /></Field>
            </div>
          </Section>

          {name !== entryState(script) && <button className="secondary" onClick={() => update((d) => setEntry(d, name))}>Make this the entry state</button>}
        </>
      )}

      {tab === 'replies' && <Replies script={script} st={st} set={set} del={del} slotNames={slotNames} />}
      {tab === 'routing' && <Routing script={script} name={name} st={st} update={update} set={set} stateNames={stateNames} />}

      {tab === 'tools' && (
        <>
          {(st.tools || []).map((tool, i) => (
            <div className="card" key={i}>
              <div className="row2">
                <Field label="Tool name"><input value={tool.name} onChange={(e) => update((d) => { d.states[name].tools[i].name = e.target.value; }, `${name}:tool${i}`)} /></Field>
                <Field label="When">
                  <select value={tool.when} onChange={(e) => update((d) => { d.states[name].tools[i].when = e.target.value; })}>
                    {[...new Set([...TOOL_WHEN, tool.when])].map((w) => <option key={w}>{w}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Unless" hint="optional condition"><input value={tool.unless || ''} onChange={(e) => update((d) => { if (e.target.value) d.states[name].tools[i].unless = e.target.value; else delete d.states[name].tools[i].unless; }, `${name}:tu${i}`)} /></Field>
              <Field label="Arguments (JSON)"><JsonField key={`${name}-${i}`} rows={5} value={tool.args || {}} onChange={(v) => update((d) => { d.states[name].tools[i].args = v; })} /></Field>
              {tool.on_result && <Field label="On result (JSON)"><JsonField key={`${name}-r${i}`} rows={5} value={tool.on_result} onChange={(v) => update((d) => { d.states[name].tools[i].on_result = v; })} /></Field>}
              <button className="danger ghost" onClick={() => update((d) => { d.states[name].tools.splice(i, 1); if (!d.states[name].tools.length) delete d.states[name].tools; })}>Remove tool</button>
            </div>
          ))}
          <button className="secondary" onClick={() => update((d) => { (d.states[name].tools ||= []).push({ name: '', when: 'on_enter', args: {} }); })}>+ Add tool call</button>
          <p className="muted small">Tool names must exist in your backend. Results appear in the Tools tab of the test console.</p>
        </>
      )}

      {tab === 'json' && (
        <>
          <p className="muted small">Every field of this state, including ones without a form (variants, sets, hooks, charge tables…). Applied when you click away.</p>
          <JsonField key={name} rows={22} value={st} onChange={(v) => update((d) => { d.states[name] = v; })} />
        </>
      )}
    </div>
  );
}

function RenameInput({ value, existing, onCommit }) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setText(value); }
  const next = toStateId(text);
  const clash = next !== value && existing[next];
  const commit = () => { if (next && !clash && next !== value) onCommit(next); else setText(value); };
  return (
    <>
      <input className={clash ? 'invalid' : ''} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      {clash && <div className="fieldError">A state called {next} already exists.</div>}
    </>
  );
}

function Replies({ script, st, set, del, slotNames }) {
  const langs = langKeys(script);
  const shown = ['reply_template', ...EXTRA_TEMPLATES.filter((k) => st[k])];
  const missing = EXTRA_TEMPLATES.filter((k) => !shown.includes(k));

  const setText = (key, lang, text) => set({ [key]: { ...(st[key] || {}), [lang]: text } }, `${key}.${lang}`);
  const insert = (key, lang, slot) => setText(key, lang, `${st[key]?.[lang] || ''}{${slot}}`);

  return (
    <>
      <p className="muted small">What the bot says. Use <code>{'{slot_name}'}</code> to speak a captured value. Keys follow <code>meta.languages</code>.</p>
      {shown.map((key) => (
        <Section key={key} title={key} action={key !== 'reply_template' && <button className="ghost" onClick={() => del(key)}>remove</button>}>
          {langs.map((lang) => (
            <Field key={lang} label={lang}>
              <textarea rows={3} value={st[key]?.[lang] || ''} onChange={(e) => setText(key, lang, e.target.value)} />
              <div className="slotInsert">
                {slotNames.slice(0, 40).map((s) => <button type="button" key={s} onClick={() => insert(key, lang, s)} title={`insert {${s}}`}>{s}</button>)}
              </div>
            </Field>
          ))}
        </Section>
      ))}
      {missing.length > 0 && (
        <select value="" onChange={(e) => e.target.value && set({ [e.target.value]: Object.fromEntries(langs.map((l) => [l, ''])) })}>
          <option value="">+ add another template…</option>
          {missing.map((k) => <option key={k}>{k}</option>)}
        </select>
      )}
      {(st.reply_template_variants || st.reply_template_by_reason) && <p className="muted small">This state also has conditional variants / per-reason replies — edit them in the JSON tab.</p>}
    </>
  );
}

function Routing({ script, name, st, update, set, stateNames }) {
  const flagNames = [...new Set(JSON.stringify(script.states).match(/flags\.[A-Za-z_]+/g) || [])];
  const mv = (i, dir) => update((d) => { const t = d.states[name].transitions; const j = i + dir; if (j < 0 || j >= t.length) return; [t[i], t[j]] = [t[j], t[i]]; });
  return (
    <>
      <Field label="Default next state" hint="used when no transition below matches">
        <select value={st.next || ''} onChange={(e) => set({ next: e.target.value || null })}>
          <option value="">— none (call ends / waits) —</option>
          {Object.keys(script.states).map((n) => <option key={n}>{n}</option>)}
        </select>
      </Field>

      <Section title="Transitions" action={<button className="secondary small" onClick={() => update((d) => { (d.states[name].transitions ||= []).push({ condition: '', goto: stateNames[0] || name }); })}>+ Add</button>}>
        <p className="muted small">Checked top to bottom; first match wins. Conditions are evaluated by the engine, e.g. <code>slots.service_number_choice == 'same'</code> or <code>flags.customer_record_exists</code>.</p>
        {(st.transitions || []).map((t, i) => (
          <div className="card" key={i}>
            <div className="cardTop">
              <span className="badge info">#{i + 1}</span>
              <div className="spacer" />
              <button className="ghost" disabled={i === 0} onClick={() => mv(i, -1)} title="move up">↑</button>
              <button className="ghost" disabled={i === st.transitions.length - 1} onClick={() => mv(i, 1)} title="move down">↓</button>
              <button className="ghost danger" onClick={() => update((d) => { d.states[name].transitions.splice(i, 1); if (!d.states[name].transitions.length) delete d.states[name].transitions; })}>✕</button>
            </div>
            <Field label="If">
              <ConditionInput script={script} flags={flagNames} value={t.condition || ''} onChange={(v) => update((d) => { d.states[name].transitions[i].condition = v; }, `${name}:c${i}`)} />
            </Field>
            <Field label="Go to">
              <select value={t.goto} onChange={(e) => update((d) => { d.states[name].transitions[i].goto = e.target.value; })}>
                {!script.states[t.goto] && <option value={t.goto}>{t.goto} (missing)</option>}
                {Object.keys(script.states).map((n) => <option key={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Also set (JSON)" hint="flags / values assigned on this path">
              <JsonField key={`${name}-s${i}`} rows={3} value={t.set || {}} onChange={(v) => update((d) => { if (Object.keys(v).length) d.states[name].transitions[i].set = v; else delete d.states[name].transitions[i].set; })} />
            </Field>
            <Field label="Note"><input value={t.note || ''} onChange={(e) => update((d) => { if (e.target.value) d.states[name].transitions[i].note = e.target.value; else delete d.states[name].transitions[i].note; }, `${name}:n${i}`)} /></Field>
          </div>
        ))}
        {!(st.transitions || []).length && <div className="empty small">No conditional transitions — the bot always goes to the default next state.</div>}
      </Section>
    </>
  );
}

// free-text condition with a helper that appends `slots.x == 'value'` snippets
function ConditionInput({ script, flags, value, onChange }) {
  const append = (snippet) => onChange(value.trim() ? `${value.trim()} and ${snippet}` : snippet);
  const options = [];
  for (const [slot, def] of Object.entries(script.slots || {})) {
    if (def.type === 'enum') for (const v of def.values || []) options.push([`slots.${slot} == '${v}'`]);
    else if (def.type === 'boolean') options.push([`slots.${slot} == true`], [`slots.${slot} == false`]);
    else options.push([`slots.${slot} is not None`]);
  }
  for (const f of flags) options.push([f], [`not ${f}`]);
  return (
    <>
      <input className="mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. slots.language == 'hindi'" />
      <select value="" onChange={(e) => e.target.value && append(e.target.value)}>
        <option value="">insert a condition…</option>
        {options.map(([o]) => <option key={o}>{o}</option>)}
      </select>
    </>
  );
}
