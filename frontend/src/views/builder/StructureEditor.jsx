import { Field, JsonField, Section, TagPicker, Toggle } from '../../components/fields';
import { csv } from '../../lib/format';
import { INTENT_ACTIONS, deleteLane, toStateId } from '../../lib/script';

// Lanes (the swim-lanes of the conversation) and jump groups ("change my address" re-entry points)
export function LanesEditor({ script, update }) {
  const lanes = script.lanes;
  const stateNames = Object.keys(script.states);
  const slotNames = Object.keys(script.slots);
  const usage = (id) => Object.values(script.states).filter((s) => s.lane === id).length;
  const move = (i, dir) => update((d) => { const j = i + dir; if (j < 0 || j >= d.lanes.length) return; [d.lanes[i], d.lanes[j]] = [d.lanes[j], d.lanes[i]]; });

  return (
    <div className="stack">
      <Section title="Lanes" action={<button className="primary small" onClick={() => update((d) => { let id = 'NEW_LANE'; let i = 2; while (d.lanes.some((l) => l.id === id)) id = `NEW_LANE_${i++}`; d.lanes.push({ id, label: 'New lane' }); })}>+ Add lane</button>}>
        <p className="muted small">Lanes group states into stages of the call (shown as columns on the canvas, and as the strip in the test console). Order = left to right.</p>
        {lanes.map((l, i) => (
          <div className="laneRow" key={i}>
            <input className="mono" value={l.id} onChange={(e) => update((d) => { const old = d.lanes[i].id; const id = toStateId(e.target.value); d.lanes[i].id = id; for (const s of Object.values(d.states)) if (s.lane === old) s.lane = id; }, `lane:${i}`)} />
            <input value={l.label || ''} placeholder="Label" onChange={(e) => update((d) => { d.lanes[i].label = e.target.value; }, `laneLabel:${i}`)} />
            <Toggle label="on demand" checked={l.on_demand} onChange={(v) => update((d) => { if (v) d.lanes[i].on_demand = true; else delete d.lanes[i].on_demand; })} />
            <span className="muted small">{usage(l.id)} states</span>
            <button className="ghost" onClick={() => move(i, -1)} disabled={i === 0}>←</button>
            <button className="ghost" onClick={() => move(i, 1)} disabled={i === lanes.length - 1}>→</button>
            <button className="ghost danger" onClick={() => { if (!usage(l.id) || window.confirm(`${usage(l.id)} state(s) use "${l.id}". They will show an error until reassigned. Delete anyway?`)) update((d) => deleteLane(d, l.id)); }}>✕</button>
          </div>
        ))}
      </Section>

      <Section title="Jump groups" action={<button className="secondary small" onClick={() => update((d) => { d.groups ||= {}; let n = 'new_group'; let i = 2; while (d.groups[n]) n = `new_group_${i++}`; d.groups[n] = { label: n.replace(/_/g, ' '), entry: stateNames[0], return_before: [], keywords: [] }; })}>+ Add group</button>}>
        <p className="muted small">When a caller says “change my address”, the engine jumps to the group’s <b>entry</b> state, then returns before the listed state(s). Slots in <b>clear</b> are wiped when the jump starts.</p>
        {Object.entries(script.groups || {}).map(([g, def]) => (
          <div className="card" key={g}>
            <div className="cardTop"><b>{g}</b><div className="spacer" /><button className="ghost danger" onClick={() => update((d) => { delete d.groups[g]; })}>Delete</button></div>
            <div className="row2">
              <Field label="Label"><input value={def.label || ''} onChange={(e) => update((d) => { d.groups[g].label = e.target.value; }, `g:${g}:l`)} /></Field>
              <Field label="Entry state">
                <select value={def.entry || ''} onChange={(e) => update((d) => { if (e.target.value) d.groups[g].entry = e.target.value; else delete d.groups[g].entry; })}>
                  <option value="">— none (inline) —</option>{stateNames.map((n) => <option key={n}>{n}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Return before"><TagPicker value={def.return_before || []} options={stateNames} onChange={(v) => update((d) => { d.groups[g].return_before = v; })} /></Field>
            <Field label="Clear slots on jump"><TagPicker value={def.clear || []} options={slotNames} onChange={(v) => update((d) => { if (v.length) d.groups[g].clear = v; else delete d.groups[g].clear; })} /></Field>
            <Field label="Trigger keywords" hint="comma separated"><input value={(def.keywords || []).join(', ')} onChange={(e) => update((d) => { d.groups[g].keywords = csv(e.target.value); }, `g:${g}:k`)} /></Field>
          </div>
        ))}
        {!Object.keys(script.groups || {}).length && <div className="empty small">No jump groups.</div>}
      </Section>
    </div>
  );
}

// What the classifier LLM can decide a caller turn "means"
export function IntentsEditor({ script, update }) {
  return (
    <div className="stack">
      <Section title="Intents" action={<button className="primary small" onClick={() => update((d) => { d.intents ||= {}; let n = 'new_intent'; let i = 2; while (d.intents[n]) n = `new_intent_${i++}`; d.intents[n] = { description: '', action: { type: 'answer' }, keywords: [] }; })}>+ Add intent</button>}>
        <p className="muted small">Intents are classified before slot capture. <b>Action</b> tells the engine what to do; keywords are the cheap rule-based fallback when the LLM is unavailable.</p>
        {Object.entries(script.intents || {}).map(([id, def]) => (
          <div className="card" key={id}>
            <div className="cardTop"><b>{id}</b><div className="spacer" /><button className="ghost danger" onClick={() => update((d) => { delete d.intents[id]; })}>Delete</button></div>
            <Field label="Description"><textarea rows={2} value={def.description || ''} onChange={(e) => update((d) => { d.intents[id].description = e.target.value; }, `i:${id}:d`)} /></Field>
            <div className="row2">
              <Field label="Action">
                <select value={def.action?.type || ''} onChange={(e) => update((d) => { d.intents[id].action = { ...(d.intents[id].action || {}), type: e.target.value }; })}>
                  {[...new Set([...INTENT_ACTIONS, def.action?.type].filter(Boolean))].map((a) => <option key={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Keywords" hint="comma separated"><input value={(def.keywords || []).join(', ')} onChange={(e) => update((d) => { d.intents[id].keywords = csv(e.target.value); }, `i:${id}:k`)} /></Field>
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}

export function SettingsEditor({ script, update }) {
  const m = script.meta;
  const set = (k, v, key) => update((d) => { d.meta[k] = v; }, key && `meta:${k}`);
  const num = (k, label, hint) => (
    <Field label={label} hint={hint}><input type="number" min="0" value={m[k] ?? ''} onChange={(e) => set(k, Number(e.target.value), k)} /></Field>
  );
  const langs = Object.entries(m.languages || {});

  return (
    <div className="stack">
      <Section title="Identity">
        <div className="row2">
          <Field label="Bot name"><input value={m.bot_name || ''} onChange={(e) => set('bot_name', e.target.value, 'bot')} /></Field>
          <Field label="Company"><input value={m.company || ''} onChange={(e) => set('company', e.target.value, 'co')} /></Field>
        </div>
        <Field label="Persona" hint="system-level voice and hard rules for every reply"><textarea rows={4} value={m.persona || ''} onChange={(e) => set('persona', e.target.value, 'persona')} /></Field>
      </Section>

      <Section title="Languages" action={<button className="secondary small" onClick={() => update((d) => { d.meta.languages[`lang${langs.length + 1}`] = `LANG${langs.length + 1}`; })}>+ Add</button>}>
        <p className="muted small">Left = slot value the caller can pick, right = key used in reply templates. Add a language, then fill its text in each state’s Replies tab.</p>
        {langs.map(([k, v]) => (
          <div className="laneRow" key={k}>
            <code>{k}</code>
            <input className="mono" value={v} onChange={(e) => update((d) => { d.meta.languages[k] = e.target.value.toUpperCase(); }, `lang:${k}`)} />
            <label className="toggle"><input type="radio" name="deflang" checked={m.default_language === k} onChange={() => set('default_language', k)} /><span>default</span></label>
            <button className="ghost danger" disabled={langs.length < 2} onClick={() => update((d) => { delete d.meta.languages[k]; })}>✕</button>
          </div>
        ))}
      </Section>

      <Section title="Limits">
        <div className="row3">
          {num('default_max_retries', 'Default retries', 'per state')}
          {num('max_total_invalid', 'Max invalid turns', 'in a row, then give up')}
          {num('max_state_visits', 'Max state visits', 'loop guard')}
          {num('max_depth', 'Max depth', 'transitions per turn')}
          {num('resume_window_hours', 'Resume window', 'hours')}
        </div>
      </Section>

      <Section title="Phone numbers">
        <div className="row2">
          <Field label="Phone pattern (regex)"><input className="mono" value={m.phone_pattern || ''} onChange={(e) => set('phone_pattern', e.target.value, 'pp')} /></Field>
          <Field label="Country calling code"><input value={m.country_calling_code || ''} onChange={(e) => set('country_calling_code', e.target.value, 'cc')} /></Field>
        </div>
      </Section>

      <Section title="Yes / no vocabulary">
        <Field label="Counts as yes" hint="comma separated"><input value={(m.lexicon?.yes || []).join(', ')} onChange={(e) => update((d) => { (d.meta.lexicon ||= {}).yes = csv(e.target.value); }, 'lex:yes')} /></Field>
        <Field label="Counts as no" hint="comma separated"><input value={(m.lexicon?.no || []).join(', ')} onChange={(e) => update((d) => { (d.meta.lexicon ||= {}).no = csv(e.target.value); }, 'lex:no')} /></Field>
      </Section>

      <details className="advanced">
        <summary>Everything else in <code>meta</code> (JSON) — messages, digit words, name fillers…</summary>
        <JsonField rows={14} value={m} onChange={(v) => update((d) => { d.meta = v; })} />
      </details>
    </div>
  );
}
