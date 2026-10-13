import { useState } from 'react';
import { Field, JsonField, TagPicker, Toggle } from '../../components/fields';
import { csv } from '../../lib/format';
import { SLOT_TYPES, deleteSlot, renameSlot, slotUsage } from '../../lib/script';

export default function SlotsEditor({ script, update }) {
  const names = Object.keys(script.slots || {});
  const [sel, setSel] = useState(names[0]);
  const slot = script.slots[sel];
  const used = sel ? slotUsage(script, sel) : [];
  const groups = Object.keys(script.groups || {});

  const set = (patch, key) => update((d) => { Object.assign(d.slots[sel], patch); }, key && `slot:${sel}:${key}`);
  const unset = (k) => update((d) => { delete d.slots[sel][k]; });

  const add = () => {
    let n = 'new_slot'; let i = 2;
    while (script.slots[n]) n = `new_slot_${i++}`;
    update((d) => { d.slots[n] = { type: 'text', description: '', label: n.replace(/_/g, ' ') }; });
    setSel(n);
  };

  return (
    <div className="split">
      <aside className="listPane">
        <button className="primary" onClick={add}>+ New slot</button>
        {names.map((n) => (
          <button key={n} className={'listItem' + (n === sel ? ' active' : '')} onClick={() => setSel(n)}>
            <code>{n}</code><span className="miniTag">{script.slots[n].type}</span>
          </button>
        ))}
      </aside>

      <div className="detailPane">
        {!slot ? <div className="empty">Create a slot to start. Slots are the facts the bot collects (name, number, product…).</div> : (
          <>
            <div className="inspectorHead">
              <div><small>SLOT</small><h3>{sel}</h3></div>
              <button className="danger ghost" onClick={() => {
                if (used.length && !window.confirm(`"${sel}" is used by ${used.length} state(s). Delete and remove it from them?`)) return;
                update((d) => deleteSlot(d, sel)); setSel(names.find((n) => n !== sel));
              }}>Delete</button>
            </div>
            <div className="row2">
              <Field label="Id"><SlotRename key={sel} value={sel} existing={script.slots} onCommit={(to) => { update((d) => renameSlot(d, sel, to)); setSel(to); }} /></Field>
              <Field label="Type">
                <select value={slot.type} onChange={(e) => set({ type: e.target.value })}>{SLOT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              </Field>
            </div>
            <Field label="Description" hint="shown to the LLM — say exactly what counts as a valid value">
              <textarea rows={2} value={slot.description || ''} onChange={(e) => set({ description: e.target.value }, 'desc')} />
            </Field>
            <div className="row2">
              <Field label="Spoken label"><input value={slot.label || ''} onChange={(e) => set({ label: e.target.value }, 'label')} /></Field>
              <Field label="Group" hint="jump-group for “change my …”">
                <select value={slot.group || ''} onChange={(e) => (e.target.value ? set({ group: e.target.value }) : unset('group'))}>
                  <option value="">— none —</option>{groups.map((g) => <option key={g}>{g}</option>)}
                </select>
              </Field>
            </div>

            {slot.type === 'enum' && (
              <Field label="Allowed values" hint="comma separated">
                <input value={(slot.values || []).join(', ')} onChange={(e) => set({ values: csv(e.target.value) }, 'values')} />
              </Field>
            )}
            {(slot.type === 'digits' || slot.type === 'pin') && (
              <Field label="Length"><input type="number" min="1" value={slot.length ?? ''} onChange={(e) => (e.target.value ? set({ length: Number(e.target.value) }) : unset('length'))} /></Field>
            )}

            <div className="toggles">
              {['resume', 'volunteer', 'persist', 'prefill', 'strict'].map((f) => (
                <Toggle key={f} label={f} checked={slot[f]} onChange={(v) => set({ [f]: v })}
                  hint={{ resume: 'restore from an earlier dropped call', volunteer: 'accept when the caller offers it early', persist: 'save to the customer record', prefill: 'fill from the customer record', strict: 'only accept listed enum values' }[f]} />
              ))}
            </div>

            <Field label="Used in states">
              <div className="tags">{used.length ? used.map((u) => <span className="tag" key={u}>{u}</span>) : <span className="muted small">not used by any state yet</span>}</div>
            </Field>

            <details className="advanced">
              <summary>All properties (JSON)</summary>
              <JsonField key={sel} rows={12} value={slot} onChange={(v) => update((d) => { d.slots[sel] = v; })} />
            </details>
          </>
        )}
      </div>
    </div>
  );
}

function SlotRename({ value, existing, onCommit }) {
  const [text, setText] = useState(value);
  const next = text.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  const clash = next !== value && existing[next];
  const commit = () => { if (next && !clash && next !== value) onCommit(next); else setText(value); };
  return (
    <>
      <input className={clash ? 'invalid' : ''} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      {clash && <div className="fieldError">Already exists.</div>}
    </>
  );
}
