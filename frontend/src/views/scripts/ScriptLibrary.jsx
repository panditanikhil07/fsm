import { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from '../../components/TopBar';
import { api } from '../../api/client';
import { navigate } from '../../hooks/useRoute';
import { normalizeScript } from '../../lib/script';

const safeName = (s) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');

export default function ScriptLibrary({ path, script, reloadActive }) {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null); // {tone, text}
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);

  const say = (text, tone = 'ok') => setMsg({ text, tone });
  const refresh = useCallback(() => {
    setLoading(true);
    return api.listScripts().then(setScripts).catch((e) => say(e.message, 'bad')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const activate = async (name) => {
    if (!window.confirm(`Activate "${name}"? New calls will run this script.`)) return;
    setBusy(name);
    try {
      await api.activateScript(name);
      say(`Activated "${name}". Reloading the engine's script…`);
      setTimeout(reloadActive, 1200);
    } catch (e) { say(e.message, 'bad'); } finally { setBusy(''); }
  };

  const duplicate = async (name) => {
    const to = safeName(window.prompt('Name for the copy', `${name}_copy`) || '');
    if (!to) return;
    setBusy(name);
    try { await api.saveScript(to, await api.getScript(name)); say(`Copied to "${to}".`); refresh(); }
    catch (e) { say(e.message, 'bad'); } finally { setBusy(''); }
  };

  const download = (name, data) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(normalizeScript(data), null, 2) + '\n'], { type: 'application/json' }));
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportScript = async (name) => {
    try { const { _layout, ...data } = await api.getScript(name); download(name, normalizeScript(data)); } catch (e) { say(e.message, 'bad'); }
  };

  const importFile = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.states || !data.lanes) throw new Error('Not a script: missing "states" or "lanes".');
      const name = safeName(window.prompt('Save imported script as', file.name.replace(/\.json$/i, '')) || '');
      if (!name) return;
      await api.saveScript(name, normalizeScript(data));
      say(`Imported as "${name}".`);
      refresh();
    } catch (e) { say(`Import failed: ${e.message}`, 'bad'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const stateCount = Object.keys(script.states || {}).length;

  return (
    <div className="app">
      <TopBar path={path} eyebrow={`${(script.meta?.bot_name || 'ROSHNI').toUpperCase()} · SCRIPTS`} title="Script library">
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => importFile(e.target.files[0])} />
        <button className="secondary" onClick={() => fileRef.current?.click()}>Import JSON</button>
        <button className="primary" onClick={() => navigate('/builder?tpl=blank')}>+ New script</button>
      </TopBar>

      {msg && <div className={'notice ' + (msg.tone === 'bad' ? 'bad' : 'ok')} role="status">{msg.text}</div>}

      <div className="libraryGrid">
        <section className="panel libraryCard activeCard">
          <div className="cardHead"><span className="badge ok">ACTIVE ON ENGINE</span></div>
          <h3>{script.meta?.bot_name || 'Active script'} · {script.meta?.company || ''}</h3>
          <p className="muted">{stateCount} states · {(script.lanes || []).length} lanes · {Object.keys(script.slot_descriptions || {}).length} slots</p>
          <div className="cardActions">
            <button className="primary" onClick={() => navigate('/builder')}>Edit in builder</button>
            <button className="secondary" onClick={() => navigate('/builder?tpl=copy')}>Make a copy</button>
          </div>
        </section>

        {loading && <div className="empty">Loading scripts…</div>}
        {!loading && scripts.length === 0 && <div className="empty">No saved scripts yet. Create one with “+ New script”.</div>}

        {scripts.map((name) => (
          <section className="panel libraryCard" key={name}>
            <h3>{name}</h3>
            <p className="muted">Saved script</p>
            <div className="cardActions">
              <button className="primary" onClick={() => navigate(`/builder/${encodeURIComponent(name)}`)}>Open in builder</button>
              <button className="secondary" disabled={busy === name} onClick={() => activate(name)}>Activate</button>
              <button className="ghost" disabled={busy === name} onClick={() => duplicate(name)}>Duplicate</button>
              <button className="ghost" onClick={() => exportScript(name)}>Export</button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
