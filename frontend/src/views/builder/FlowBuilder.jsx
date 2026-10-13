import { useCallback, useEffect, useMemo, useState } from 'react';
import TopBar from '../../components/TopBar';
import { JsonField } from '../../components/fields';
import { api } from '../../api/client';
import { useDraft } from '../../hooks/useDraft';
import { navigate, setNavGuard } from '../../hooks/useRoute';
import { autoLayout } from '../../lib/graph';
import { blankScript, normalizeScript, renameState } from '../../lib/script';
import { countIssues, validateScript } from '../../lib/validate';
import Canvas from './Canvas';
import Issues from './Issues';
import Preview from './Preview';
import SlotsEditor from './SlotsEditor';
import StateInspector from './StateInspector';
import { IntentsEditor, LanesEditor, SettingsEditor } from './StructureEditor';

const VIEWS = [['flow', 'Flow'], ['slots', 'Slots'], ['lanes', 'Lanes & groups'], ['intents', 'Intents'], ['settings', 'Settings'], ['preview', 'Preview'], ['json', 'JSON']];
const safeName = (s) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
const layoutKey = (name) => `fsm-layout:${name}`;
const readLayout = (name) => { try { return JSON.parse(localStorage.getItem(layoutKey(name)) || '{}'); } catch { return {}; } };

export default function FlowBuilder({ path, name: routeName, query, reloadActive }) {
  const draft = useDraft(null);
  const { script, update, undo, redo, canUndo, canRedo, dirty } = draft;
  const [name, setName] = useState(routeName || '');
  const [layout, setLayout] = useState({});
  const [view, setView] = useState('flow');
  const [selected, setSelected] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [inspectorTab, setInspectorTab] = useState('basics');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [loadError, setLoadError] = useState('');

  const say = (text, tone = 'ok') => setMsg({ text, tone });

  // ---- load: saved script, copy of the active one, or a blank starter ----
  useEffect(() => {
    let live = true;
    const init = (s, nm) => {
      if (!live) return;
      const { _layout, ...rest } = s;
      draft.load(rest);
      setLayout({ ...readLayout(nm), ...(_layout || {}) });
      setSelected(null);
    };
    (async () => {
      try {
        if (routeName) {
          init(await api.getScript(routeName), routeName);
          setName(routeName);
        } else if (query.tpl === 'blank') {
          const base = await api.getActiveScript().catch(() => null);
          init(blankScript(base), 'new_script');
          setName('new_script');
        } else if (query.tpl === 'copy') {
          init(await api.getActiveScript(), '');
          setName('active_copy');
        } else {
          // Default: Always load the full active script directly so the engine flow is never wiped or reduced
          init(await api.getActiveScript(), 'active');
          setName('active');
        }
      } catch (e) { if (live) setLoadError(e.message); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeName, query.tpl]);

  // ---- leaving with unsaved work ----
  useEffect(() => {
    setNavGuard(dirty ? () => window.confirm('You have unsaved changes in the builder. Leave anyway?') : null);
    const bu = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', bu);
    return () => { setNavGuard(null); window.removeEventListener('beforeunload', bu); };
  }, [dirty]);

  const issues = useMemo(() => (script ? validateScript(script) : []), [script]);
  const { errors, warns } = countIssues(issues);

  const locate = useCallback((state) => { setView('flow'); setSelected(state); setSelectedEdge(null); }, []);

  const doSave = useCallback(async () => {
    const nm = safeName(name) || 'active';
    setBusy(true);
    try {
      const full = layoutPositions(script, layout);
      await api.saveScript(nm, { ...normalizeScript(script), _layout: full });
      try { localStorage.setItem(layoutKey(nm), JSON.stringify(full)); } catch { /* storage unavailable */ }
      draft.markSaved(); setName(nm);
      say(`Saved "${nm}".`);
      if (routeName !== nm) window.history.replaceState(null, '', `#/builder/${encodeURIComponent(nm)}`);
      return nm;
    } catch (e) { say(e.message, 'bad'); return null; } finally { setBusy(false); }
  }, [name, script, layout, draft, routeName]);

  const saveAndTest = async () => {
    if (errors && !window.confirm(`${errors} error(s) found — the engine may misbehave. Activate anyway?`)) return;
    const nm = await doSave();
    if (!nm) return;
    try {
      if (nm !== 'active') {
        await api.activateScript(nm);
      }
      await new Promise((r) => setTimeout(r, 1200));
      await reloadActive();
      setNavGuard(null);
      navigate('/test');
    } catch (e) { say(e.message, 'bad'); }
  };

  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(normalizeScript(script), null, 2) + '\n'], { type: 'application/json' }));
    a.download = `${safeName(name) || 'script'}.json`; a.click(); URL.revokeObjectURL(a.href);
  };

  // ---- shortcuts ----
  useEffect(() => {
    const on = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
      else if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [doSave, undo, redo]);

  const rename = useCallback((from, to) => {
    update((d) => { renameState(d, from, to); });
    setLayout((l) => { const { [from]: p, ...rest } = l; return p ? { ...rest, [to]: p } : l; });
    setSelected(to);
  }, [update]);

  const relayout = () => { setLayout({}); setTimeout(() => window.dispatchEvent(new Event('builder:fit')), 50); };

  if (loadError) return <div className="app"><TopBar path={path} eyebrow="FLOW BUILDER" title="Flow builder" /><div className="notice bad">Could not load the script: {loadError}</div></div>;
  if (!script) return <div className="app"><TopBar path={path} eyebrow="FLOW BUILDER" title="Flow builder" /><div className="empty">Loading…</div></div>;

  return (
    <div className="app">
      <TopBar path={path} eyebrow={`${(script.meta?.bot_name || 'BOT').toUpperCase()} · FLOW BUILDER`} title={name ? `${name}${dirty ? ' •' : ''}` : `New script${dirty ? ' •' : ''}`}>
        <button className="ghost" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶</button>
        <button className="ghost" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">↷</button>
        <input className="nameInput" value={name} placeholder="script_name" onChange={(e) => setName(e.target.value)} />
        <button className="chipBtn" onClick={() => setShowIssues((v) => !v)} title="Validation">
          <span className={errors ? 'bad' : 'ok'}>{errors} ✕</span> <span className={warns ? 'warn' : 'ok'}>{warns} !</span>
        </button>
        <button className="ghost" onClick={exportJson}>Export</button>
        <button className="secondary" disabled={busy || !dirty} onClick={doSave}>Save</button>
        <button className="primary" disabled={busy} onClick={saveAndTest}>Save & test live</button>
      </TopBar>

      {msg && <div className={'notice ' + (msg.tone === 'bad' ? 'bad' : 'ok')} role="status" onClick={() => setMsg(null)}>{msg.text}</div>}
      {showIssues && <div className="panel issuePanel"><Issues issues={issues} onJump={(s) => { setShowIssues(false); locate(s); }} /></div>}

      <div className="viewTabs">
        {VIEWS.map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}
      </div>

      <div className="builderBody">
        {view === 'flow' && (
          <div className="flowLayout">
            <section className="panel canvasPanel">
              <div className="canvasToolbar">
                <select id="new-lane" defaultValue="" aria-label="Lane for new state">
                  <option value="">new state in…</option>
                  {script.lanes.map((l) => <option key={l.id} value={l.id}>{l.label || l.id}</option>)}
                </select>
                <button className="primary" onClick={() => window.dispatchEvent(new CustomEvent('builder:add-state', { detail: { lane: document.getElementById('new-lane').value || undefined } }))}>+ Add state</button>
                <button className="ghost" onClick={() => window.dispatchEvent(new Event('builder:fit'))}>Fit view</button>
                <button className="ghost" onClick={relayout} title="Reset positions to lane columns">Auto-layout</button>
                <span className="muted small">Drag from a node’s right dot to another node to link · drop on empty space to create a linked state · Backspace deletes</span>
              </div>
              <Canvas
                script={script} layout={layout} setLayout={setLayout} issues={issues} update={update}
                selected={selected} selectedEdge={selectedEdge}
                onSelect={(n) => { setSelected(n); setSelectedEdge(null); }}
                onSelectEdge={(e) => { setSelected(e.source); setSelectedEdge(e.id); setInspectorTab('routing'); }}
              />
            </section>
            <aside className="panel inspectorPanel">
              <StateInspector
                script={script} name={selected} update={update} issues={issues} tab={inspectorTab} setTab={setInspectorTab}
                onRename={rename} onDeleted={() => setSelected(null)}
              />
            </aside>
          </div>
        )}
        {view === 'slots' && <div className="panel scrollPanel"><SlotsEditor script={script} update={update} /></div>}
        {view === 'lanes' && <div className="panel scrollPanel"><LanesEditor script={script} update={update} /></div>}
        {view === 'intents' && <div className="panel scrollPanel"><IntentsEditor script={script} update={update} /></div>}
        {view === 'settings' && <div className="panel scrollPanel"><SettingsEditor script={script} update={update} /></div>}
        {view === 'preview' && <div className="panel scrollPanel"><Preview script={script} onLocate={locate} /></div>}
        {view === 'json' && (
          <div className="panel scrollPanel">
            <p className="muted small">The complete script as it will be saved (canvas positions are stored separately). Edit and click outside the box to apply.</p>
            <JsonField rows={34} value={script} onChange={(v) => update((d) => { Object.keys(d).forEach((k) => delete d[k]); Object.assign(d, v); })} />
          </div>
        )}
      </div>
    </div>
  );
}

// positions for every state: whatever the user placed, falling back to the lane-column layout
function layoutPositions(script, layout) {
  const auto = autoLayout(script);
  return Object.fromEntries(Object.keys(script.states).map((n) => [n, layout[n] || auto[n]]));
}
