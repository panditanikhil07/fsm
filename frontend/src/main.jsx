import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './flow.css';
import './dynamic.css';
import './layout.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const call = async (path, body) => {
  const res = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${path} failed (${res.status})`);
  return json;
};

const show = (v) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const isSet = (v) => v !== undefined && v !== null && v !== '';

// event -> short chip label + tone, so every backend event type is visible without hard-coding states or lanes
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
const eventChip = (e) => (EVENT_VIEW[e.type] ? EVENT_VIEW[e.type](e) : null);

function App() {
  const [sid, setSid] = useState('');
  const [data, setData] = useState(null);
  const [greeting, setGreeting] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [script, setScript] = useState({ states: {}, lanes: [], slot_descriptions: {}, meta: {} });
  const [tab, setTab] = useState('slots');
  const [error, setError] = useState('');
  const [caller, setCaller] = useState('9540923207');
  const [known, setKnown] = useState([]);

  const messagesRef = useRef(null);
  const inputRef = useRef(null);

  const refreshKnown = () => call('/customers').then(setKnown).catch(() => setKnown([]));

  const applySession = (d) => {
    setSid(d.session_id); setData(d); setGreeting(d.assistant || ''); setText(''); setError('');
  };

  const start = async (path = '/session', extra = {}) => {
    try {
      applySession(await call(path, { caller_number: caller, session_id: sid || undefined, ...extra }));
      refreshKnown();
    } catch (err) {
      setError(err.message.startsWith('Failed') ? 'Unable to connect to the FSM backend.' : err.message);
      if (!data) setData({ session_id: '', assistant: '', state: 'ERROR', lane: 'SYSTEM', slots: {}, flags: {}, metrics: {}, tool_calls: [], history: [] });
    }
  };

  useEffect(() => {
    call('/states').then(setScript).catch(() => {});
    start('/session');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async (silence = false) => {
    if ((!silence && !text.trim()) || busy || !sid) return;
    setBusy(true);
    const t = text;
    setText('');
    try {
      setData(await call('/turn', { session_id: sid, text: t, silence }));
      setError('');
    } catch (err) { setError(err.message); setText(t); }
    finally { setBusy(false); }
  };

  const endCall = async () => {
    try { setData(await call('/session/end', { session_id: sid })); refreshKnown(); } catch (err) { setError(err.message); }
  };

  const slots = data?.slots || {};
  const flags = data?.flags || {};
  const ms = data?.metrics || {};
  const hist = data?.history || [];
  const stateMap = script.states || {};
  const slotDescriptions = script.slot_descriptions || {};
  const activeState = data?.state || 'OPENING';
  const activeLane = data?.lane || 'STARTUP';
  const terminal = !!flags.terminal;
  const retry = data?.retry || { used: 0, max: 0, streak: 0, max_streak: script.meta?.max_total_invalid || 0 };
  const jump = data?.jump;
  const lastItem = hist[hist.length - 1];

  // keep the newest turn in view: scroll the message list to the bottom whenever a turn is added or a request starts/finishes
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [hist.length, busy, error]);

  // put the cursor back in the input after each reply so you can keep typing
  useEffect(() => {
    if (!busy && !terminal) inputRef.current?.focus();
  }, [busy, terminal]);

  const lanes = useMemo(() => (script.lanes || []).map((l) => l.id), [script.lanes]);
  const laneIdx = lanes.indexOf(activeLane);
  const currentSide = laneIdx < 0 ? 'center' : laneIdx < lanes.length / 3 ? 'left' : laneIdx < (2 * lanes.length) / 3 ? 'center' : 'right';

  const slotKeys = useMemo(() => [...new Set([...Object.keys(slotDescriptions), ...Object.keys(slots)])], [slotDescriptions, slots]);
  const filled = Object.keys(slots).filter((k) => isSet(slots[k])).length;
  const slotProgress = `${Math.min(100, Math.round((filled / Math.max(1, Object.keys(slotDescriptions).length)) * 100))}%`;

  const visitedStates = useMemo(() => new Set(data?.path || []), [data?.path]);
  const visitedLanes = useMemo(() => new Set([...(data?.path || [])].map((st) => stateMap[st]?.lane).filter(Boolean)), [data?.path, stateMap]);

  const flowPath = useMemo(() => {
    const visited = [];
    for (const st of data?.path || []) if (st && visited[visited.length - 1] !== st) visited.push(st);
    return visited.slice(-10).map((st, i, arr) => ({ state: st, side: i === arr.length - 1 ? 'current' : 'past', silent: ['router', 'gate'].includes(stateMap[st]?.type) }));
  }, [data?.path, stateMap]);

  const laneGroups = useMemo(() => {
    const map = {};
    for (const [key, value] of Object.entries(stateMap)) (map[value.lane] ||= []).push(key);
    return (script.lanes || []).filter((l) => map[l.id]).map((l) => ({ ...l, states: map[l.id] }));
  }, [stateMap, script.lanes]);

  const prompt = terminal ? lastItem?.assistant || greeting : data?.assistant || greeting;
  const turnEvents = (data?.events || []).map(eventChip).filter(Boolean);
  const llm = data?.llm || {};

  const extraction = lastItem
    ? { extracted: lastItem.extracted, intents: lastItem.intents, path: lastItem.path, lane: `${lastItem.lane_from} → ${lastItem.lane}` }
    : {};

  const tabs = [
    ['slots', 'Slots', filled],
    ['events', 'Events', turnEvents.length],
    ['llm', 'LLM calls'],
    ['flags', 'Flags'],
    ['tools', 'Tools', data?.tool_calls?.length || 0],
    ['history', 'Trace', hist.length],
    ['extract', 'Extraction'],
  ];

  return (
    <div className="app">
      <header className="top">
        <div>
          <div className="eyebrow">{(script.meta?.bot_name || 'ROSHNI').toUpperCase()} · FSM TEST CONSOLE</div>
          <h1>Live voice-flow debugger</h1>
          <p>Classifier LLM → slot-capture/response LLM → FSM (states.json) · JSON customer store · lane jumps</p>
        </div>
        <div className="topActions">
          <label className="callerBox">
            <span>Calling from</span>
            <input list="known-callers" value={caller} onChange={(e) => setCaller(e.target.value.replace(/\D/g, '').slice(0, 10))} />
            <datalist id="known-callers">
              {known.map((c) => <option key={c.phone_number} value={c.phone_number}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || 'incomplete call on file'}</option>)}
            </datalist>
          </label>
          <span className={'live ' + (terminal ? 'dead' : '')}>● {terminal ? 'TERMINAL' : 'LIVE'}</span>
          <button className="secondary" onClick={() => start('/session/reset')}>New call</button>
          <button className="secondary" disabled={terminal} onClick={endCall}>Hang up</button>
        </div>
      </header>

      {error && <div className="empty" role="alert">⚠ {error}</div>}
      {data?.persisted && (
        <div className="notice ok">
          ✔ Call saved · outcome <b>{data.persisted.outcome}</b> · {(data.persisted.saved || []).join(', ')}. Call again from <b>{data.caller_number}</b> to see the stored record retrieved.
        </div>
      )}
      {jump && (
        <div className="notice jump">
          ↪ Updating <b>{jump.group}</b> — will return to <b>{jump.resume}</b> after the update{jump.queued?.length ? ` (then: ${jump.queued.join(', ')})` : ''}.
        </div>
      )}

      <div className="laneStrip" aria-label="Lanes">
        {(script.lanes || []).map((l) => (
          <div key={l.id} className={'laneChip' + (l.id === activeLane ? ' active' : visitedLanes.has(l.id) ? ' visited' : '') + (l.on_demand ? ' demand' : '')}>
            {l.label}
          </div>
        ))}
      </div>

      <div className="dashboard">
        <section className="panel conversation">
          <div className="panelTitle">
            <div><b>Conversation</b><small>one simulated customer turn at a time</small></div>
            <span className="statePill">{activeLane} <i>/</i> {activeState}</span>
          </div>

          {hist.length === 0 && (
            <div className="assistantPrompt">
              <span>{script.meta?.bot_name?.toUpperCase() || 'ROSHNI'}</span>
              <p>{prompt || (terminal ? 'Call ended.' : 'No active assistant response yet.')}</p>
            </div>
          )}

          <div className="summaryBar">
            <div className="summaryItem"><label>Caller</label><strong>{data?.caller_number || '—'}</strong></div>
            <div className="summaryItem"><label>State</label><strong>{activeState}</strong></div>
            <div className="summaryItem"><label>Language</label><strong>{data?.language || 'english'}</strong></div>
            <div className="summaryItem"><label>Slots</label><strong>{filled} · {slotProgress}</strong></div>
            <div className="summaryItem">
              <label>Retries</label>
              <strong>{retry.used}/{retry.max}{retry.streak ? ` · streak ${retry.streak}/${retry.max_streak}` : ''}</strong>
            </div>
          </div>

          <div className="messages" ref={messagesRef}>
            {hist.length === 0 ? (
              <div className="empty">No turns yet. Reply to the greeting above.</div>
            ) : hist.map((h, i) => (
              <div className="turn" key={`${h.turn}-${i}`}>
                <div className="bubble user"><label>YOU</label><p>{h.user}</p></div>
                <div className="bubble bot">
                  <label>{(script.meta?.bot_name || 'ROSHNI').toUpperCase()} · {h.lane}</label>
                  <p>{h.assistant || <em>(call ended — no speech)</em>}</p>
                  <small>
                    {h.path?.length ? h.path.join(' → ') : `${h.from_state} → ${h.to_state}`} · {h.latency_ms} ms
                    {h.intents?.length ? ` · intents: ${h.intents.join(', ')}` : ''}
                  </small>
                  <div className="chips">
                    {(h.events || []).map(eventChip).map((c, j) => c && c.tone !== 'tool' && c.tone !== 'muted' && c.tone !== 'slot' && c.tone !== 'intent' && (
                      <span key={j} className={'chip ' + c.tone}>{c.text}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="composer">
            <input
              ref={inputRef}
              autoFocus value={text} disabled={terminal}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder={terminal ? 'Call ended — start a new call' : 'Type simulated customer speech… (nonsense, "change my pin code", "what is my address", "warranty?")'}
            />
            <button disabled={busy || terminal || !text.trim()} onClick={() => send()}>{busy ? 'Running…' : 'Send'}</button>
            <button className="secondary" disabled={busy || terminal} onClick={() => send(true)} title="Caller says nothing">Silence</button>
          </div>
        </section>

        <section className="panel inspector">
          <div className="tabs">
            {tabs.map(([id, label, n]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}{n !== undefined && <em>{n}</em>}</button>
            ))}
          </div>

          {tab === 'slots' && (
            <div className="slotGrid">
              {slotKeys.map((key) => (
                <div className={'slot ' + (isSet(slots[key]) ? 'filled' : '')} key={key}>
                  <code>{key}</code><strong>{show(slots[key])}</strong><small>{slotDescriptions[key] || ''}</small>
                </div>
              ))}
            </div>
          )}

          {tab === 'events' && (
            <div className="eventList">
              {turnEvents.length === 0 ? <div className="empty">No events for the last turn.</div> : turnEvents.map((c, i) => <span key={i} className={'chip ' + c.tone}>{c.text}</span>)}
            </div>
          )}

          {tab === 'llm' && (
            <div className="llmGrid">
              <LlmCard title="1 · Classifier" tone={llm.classifier?.source} ms={llm.classifier?.ms} body={llm.classifier && { intents: llm.classifier.intents, update_targets: llm.classifier.update_targets, recall_targets: llm.classifier.recall_targets, yes_no: llm.classifier.yes_no, language: llm.classifier.language, reason: llm.classifier.reason, error: llm.classifier.error }} />
              <LlmCard title="2 · Slot capture + response" tone={llm.capture?.source} ms={llm.capture?.ms} body={llm.capture && { slots: llm.capture.slots, rejected_no_evidence: llm.capture.rejected, lead: llm.capture.lead, error: llm.capture.error }} />
            </div>
          )}

          {tab === 'flags' && (
            <div className="slotGrid">
              {Object.entries(flags).map(([key, value]) => (
                <div className={'slot ' + (value ? 'filled' : '')} key={key}><code>{key}</code><strong>{show(value)}</strong></div>
              ))}
              {data?.customer_data && Object.keys(data.customer_data).length > 0 && (
                <div className="slot filled" style={{ gridColumn: '1 / -1' }}>
                  <code>customer_data (retrieved from the JSON store by phone number)</code>
                  <pre>{JSON.stringify(data.customer_data, null, 2)}</pre>
                </div>
              )}
            </div>
          )}

          {tab === 'tools' && <ToolList calls={data?.tool_calls || []} />}
          {tab === 'history' && <Trace hist={hist} />}
          {tab === 'extract' && <pre>{JSON.stringify(extraction, null, 2)}</pre>}
        </section>

        <aside className="side">
          <section className="panel metrics">
            <div className="panelTitle"><div><b>Latency</b><small>instrumented per turn</small></div></div>
            <div className="metricGrid">
              <Metric label="Last turn" value={ms.last_turn_ms} />
              <Metric label="Total" value={ms.total_ms} />
              <Metric label="LLM 1 · classify" value={ms.classify_ms} />
              <Metric label="LLM 2 · capture" value={ms.capture_ms} />
              <Metric label="FSM" value={ms.fsm_ms} />
              <Metric label="Tools" value={ms.tool_ms} />
              <Metric label="Turns" value={ms.turns} unit="" digits={0} />
            </div>
          </section>

          <section className="panel lane">
            <div className="panelTitle"><div><b>Lane / state</b><small>current execution position</small></div></div>
            <div className="heroState">
              <span>{activeLane || '—'}</span>
              <strong>{activeState || '—'}</strong>
              <small className={'graphBadge ' + currentSide}>graph side: {currentSide}</small>
            </div>
            {retry.max >= 0 && !terminal && (
              <div className="retryMeter" title="Retries used in this state">
                {Array.from({ length: Math.max(retry.max, 1) }, (_, i) => <i key={i} className={i < retry.used ? 'used' : ''} />)}
                <span>{retry.used}/{retry.max} retries</span>
              </div>
            )}
            <div className="flowRail" aria-label="Conversation flow path">
              {flowPath.map((item, index) => (
                <React.Fragment key={`${item.state}-${index}`}>
                  {index > 0 && <span className="flowArrow">›</span>}
                  <div className={'flowNode ' + item.side + (item.silent ? ' silent' : '')} title={item.silent ? 'silent state' : ''}><small>{item.state}</small></div>
                </React.Fragment>
              ))}
            </div>
            <div className="laneList">
              {laneGroups.map(({ id, label, states }) => (
                <div key={id} className={'laneGroup' + (id === activeLane ? ' current' : '')}>
                  <div className="laneName">{label}</div>
                  {states.map((key) => (
                    <div key={key} className={'stateRow ' + (key === activeState ? 'current' : '')}>
                      <span>{key === activeState ? '●' : visitedStates.has(key) ? '○' : ''}</span>{key}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, unit = ' ms', digits = 2 }) {
  return (
    <div className="metric">
      <strong>{Number(value || 0).toFixed(digits)}<small>{unit}</small></strong>
      <span>{label}</span>
    </div>
  );
}

function LlmCard({ title, tone, ms, body }) {
  return (
    <div className="llmCard">
      <div className="llmHead"><b>{title}</b><span className={'chip ' + (tone === 'llm' ? 'ok' : tone === 'fallback' ? 'warn' : 'muted')}>{tone || 'not run'}</span><em>{Number(ms || 0).toFixed(1)} ms</em></div>
      <pre>{body ? JSON.stringify(body, null, 2) : '—'}</pre>
    </div>
  );
}

function ToolList({ calls }) {
  if (!calls.length) return <div className="empty">No tools executed yet.</div>;
  return (
    <div className="toolList">
      {calls.map((item, i) => ({ item, i })).reverse().map(({ item, i }) => (
        <div className="tool" key={`${item.name}-${item.at || ''}-${i}`}>
          <div><b>{item.name}</b><span>{item.latency_ms} ms</span></div>
          <small>args</small><pre>{JSON.stringify(item.args, null, 2)}</pre>
          <small>result</small><pre>{JSON.stringify(item.result, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}

function Trace({ hist }) {
  if (!hist.length) return <div className="empty">No trace events yet.</div>;
  return (
    <div className="trace">
      {hist.slice().reverse().map((h, i) => (
        <div className="traceRow" key={`${h.turn}-${i}`}>
          <b>#{h.turn}</b><span>{h.from_state}</span><i>→</i><strong>{h.to_state}</strong><em>{h.latency_ms} ms</em>
          {h.lane_changed && <span className="chip lane">lane {h.lane_from} → {h.lane}</span>}
          <pre>{JSON.stringify({ lane: h.lane, path: h.path, intents: h.intents, extracted: h.extracted, retry: h.retry, jump: h.jump, classifier: h.classification && { source: h.classification.source, ms: h.classification.ms }, capture: h.capture && { source: h.capture.source, ms: h.capture.ms, lead: h.capture.lead } }, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);