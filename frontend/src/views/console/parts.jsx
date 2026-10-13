export function Metric({ label, value, unit = ' ms', digits = 2 }) {
  return (
    <div className="metric">
      <strong>{Number(value || 0).toFixed(digits)}<small>{unit}</small></strong>
      <span>{label}</span>
    </div>
  );
}

export function LlmCard({ title, tone, ms, body }) {
  return (
    <div className="llmCard">
      <div className="llmHead">
        <b>{title}</b>
        <span className={'chip ' + (tone === 'llm' ? 'ok' : tone === 'fallback' ? 'warn' : 'muted')}>{tone || 'not run'}</span>
        <em>{Number(ms || 0).toFixed(1)} ms</em>
      </div>
      <pre>{body ? JSON.stringify(body, null, 2) : '—'}</pre>
    </div>
  );
}

export function ToolList({ calls }) {
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

export function Trace({ hist }) {
  if (!hist.length) return <div className="empty">No trace events yet.</div>;
  return (
    <div className="trace">
      {hist.slice().reverse().map((h, i) => (
        <div className="traceRow" key={`${h.turn}-${i}`}>
          <b>#{h.turn}</b><span>{h.from_state}</span><i>→</i><strong>{h.to_state}</strong><em>{h.latency_ms} ms</em>
          {h.lane_changed && <span className="chip lane">lane {h.lane_from} → {h.lane}</span>}
          <pre>{JSON.stringify({
            lane: h.lane, path: h.path, intents: h.intents, extracted: h.extracted, retry: h.retry, jump: h.jump,
            classifier: h.classification && { source: h.classification.source, ms: h.classification.ms },
            capture: h.capture && { source: h.capture.source, ms: h.capture.ms, lead: h.capture.lead },
          }, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}
