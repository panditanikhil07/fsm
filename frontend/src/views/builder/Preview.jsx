import { useMemo, useState } from 'react';
import { langKeys, entryState } from '../../lib/script';
import { optionsOf, sayOf } from '../../lib/walk';

// Click through the script as a conversation, without the engine: shows what the bot says at each
// state and lets you pick which transition the caller "triggers". Good for checking flow shape and copy.
export default function Preview({ script, onLocate }) {
  const langs = langKeys(script);
  const [lang, setLang] = useState(langs[0]);
  const [trail, setTrail] = useState(() => [{ state: entryState(script), via: null }]);

  const current = trail[trail.length - 1].state;
  const opts = useMemo(() => optionsOf(script, current), [script, current]);
  const st = script.states[current];
  const bot = (script.meta?.bot_name || 'Bot').toUpperCase();

  const go = (o) => { if (trail.length > 60) return; setTrail((t) => [...t, { state: o.goto, via: o.label }]); };
  const restart = () => setTrail([{ state: entryState(script), via: null }]);

  if (!st) return <div className="empty">The entry state no longer exists. Add a state first.</div>;

  return (
    <div className="previewWrap">
      <div className="previewBar">
        <label>Language <select value={lang} onChange={(e) => setLang(e.target.value)}>{langs.map((l) => <option key={l}>{l}</option>)}</select></label>
        <button className="secondary" onClick={restart}>Restart</button>
        <button className="ghost" disabled={trail.length < 2} onClick={() => setTrail((t) => t.slice(0, -1))}>← Back</button>
        <span className="muted small">Dry run only — conditions are not evaluated. Use “Save & test live” to run it on the engine.</span>
      </div>

      <div className="previewChat">
        {trail.map((step, i) => {
          const s = script.states[step.state];
          const text = sayOf(s, lang);
          return (
            <div key={i} className="turn">
              {step.via && <div className="bubble user"><label>CALLER · path taken</label><p>{step.via}</p></div>}
              <div className={'bubble bot' + (text ? '' : ' silentBubble')}>
                <label>{bot} · {s?.lane} · <button className="linkBtn" onClick={() => onLocate(step.state)}>{step.state}</button></label>
                <p>{text || <em>{s?.type !== 'customer_facing' ? `(silent ${s?.type} step)` : s?.prompt ? `(no reply text — LLM follows prompt) ${s.prompt}` : '(no reply text)'}</em>}</p>
                {s?.required_slots?.length > 0 && <div className="chips">{s.required_slots.map((r) => <span key={r} className="chip muted">collects {r}</span>)}</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="previewChoices">
        {st.terminal ? <div className="notice ok">Call ends here.</div>
          : opts.length === 0 ? <div className="notice">No outgoing path — the call ends or waits here.</div>
          : opts.map((o) => (
            <button key={o.id} className={'choice ' + o.kind} onClick={() => go(o)}>
              <small>{o.kind === 'next' ? 'DEFAULT' : o.kind === 'exhausted' ? 'FAILURE' : 'IF'}</small>
              <span>{o.label}</span><i>→ {o.goto}</i>
            </button>
          ))}
      </div>
    </div>
  );
}
