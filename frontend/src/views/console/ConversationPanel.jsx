import { useEffect, useRef, useState } from 'react';
import { eventChip } from '../../lib/events';

const HIDDEN_TONES = new Set(['tool', 'muted', 'slot', 'intent']);

export default function ConversationPanel({ botName, hist, prompt, terminal, busy, error, send, activeLane, activeState, summary }) {
  const [text, setText] = useState('');
  const messagesRef = useRef(null);
  const inputRef = useRef(null);

  // keep the newest turn in view
  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [hist.length, busy, error]);

  // put the cursor back in the input after each reply
  useEffect(() => { if (!busy && !terminal) inputRef.current?.focus(); }, [busy, terminal]);

  const submit = async (silence = false) => {
    if (busy || (!silence && !text.trim())) return;
    const t = text;
    setText('');
    if (!(await send(t, silence))) setText(t);
  };

  return (
    <section className="panel conversation">
      <div className="panelTitle">
        <div><b>Conversation</b><small>one simulated customer turn at a time</small></div>
        <span className="statePill">{activeLane} <i>/</i> {activeState}</span>
      </div>

      {hist.length === 0 && (
        <div className="assistantPrompt">
          <span>{botName}</span>
          <p>{prompt || (terminal ? 'Call ended.' : 'No active assistant response yet.')}</p>
        </div>
      )}

      <div className="summaryBar">
        {summary.map(([label, value]) => (
          <div className="summaryItem" key={label}><label>{label}</label><strong>{value}</strong></div>
        ))}
      </div>

      <div className="messages" ref={messagesRef}>
        {hist.length === 0 ? (
          <div className="empty">No turns yet. Reply to the greeting above.</div>
        ) : hist.map((h, i) => (
          <div className="turn" key={`${h.turn}-${i}`}>
            <div className="bubble user"><label>YOU</label><p>{h.user}</p></div>
            <div className="bubble bot">
              <label>{botName} · {h.lane}</label>
              <p>{h.assistant || <em>(call ended — no speech)</em>}</p>
              <small>
                {h.path?.length ? h.path.join(' → ') : `${h.from_state} → ${h.to_state}`} · {h.latency_ms} ms
                {h.intents?.length ? ` · intents: ${h.intents.join(', ')}` : ''}
              </small>
              <div className="chips">
                {(h.events || []).map(eventChip).map((c, j) => c && !HIDDEN_TONES.has(c.tone) && (
                  <span key={j} className={'chip ' + c.tone}>{c.text}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="composer">
        <input
          ref={inputRef} autoFocus value={text} disabled={terminal}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={terminal ? 'Call ended — start a new call' : 'Type simulated customer speech…'}
        />
        <button disabled={busy || terminal || !text.trim()} onClick={() => submit()}>{busy ? 'Running…' : 'Send'}</button>
        <button className="secondary" disabled={busy || terminal} onClick={() => submit(true)} title="Caller says nothing">Silence</button>
      </div>
    </section>
  );
}
