import { useState } from 'react';
import { isSet, show } from '../../lib/format';
import { LlmCard, ToolList, Trace } from './parts';

export default function InspectorPanel({ data, slots, slotKeys, slotDescriptions, filled, turnEvents, hist, flags, extraction }) {
  const [tab, setTab] = useState('slots');
  const llm = data?.llm || {};
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
          {turnEvents.length === 0
            ? <div className="empty">No events for the last turn.</div>
            : turnEvents.map((c, i) => <span key={i} className={'chip ' + c.tone}>{c.text}</span>)}
        </div>
      )}

      {tab === 'llm' && (
        <div className="llmGrid">
          <LlmCard title="1 · Classifier" tone={llm.classifier?.source} ms={llm.classifier?.ms}
            body={llm.classifier && { intents: llm.classifier.intents, update_targets: llm.classifier.update_targets, recall_targets: llm.classifier.recall_targets, yes_no: llm.classifier.yes_no, language: llm.classifier.language, reason: llm.classifier.reason, error: llm.classifier.error }} />
          <LlmCard title="2 · Slot capture + response" tone={llm.capture?.source} ms={llm.capture?.ms}
            body={llm.capture && { slots: llm.capture.slots, rejected_no_evidence: llm.capture.rejected, lead: llm.capture.lead, error: llm.capture.error }} />
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
  );
}
