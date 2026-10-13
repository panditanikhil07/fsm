import { useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { useSession } from '../../hooks/useSession';
import { eventChip } from '../../lib/events';
import { isSet } from '../../lib/format';
import ConversationPanel from './ConversationPanel';
import InspectorPanel from './InspectorPanel';
import SidePanel from './SidePanel';

export default function TestConsole({ path, script }) {
  const { sid, data, busy, error, caller, setCaller, known, start, send, endCall } = useSession();

  const botName = (script.meta?.bot_name || 'ROSHNI').toUpperCase();
  const slots = data?.slots || {};
  const flags = data?.flags || {};
  const hist = data?.history || [];
  const stateMap = script.states || {};
  const slotDescriptions = script.slot_descriptions || {};
  const activeState = data?.state || 'OPENING';
  const activeLane = data?.lane || 'STARTUP';
  const terminal = !!flags.terminal;
  const retry = data?.retry || { used: 0, max: 0, streak: 0, max_streak: script.meta?.max_total_invalid || 0 };
  const lastItem = hist[hist.length - 1];
  const greeting = data?.assistant || '';

  const lanes = useMemo(() => (script.lanes || []).map((l) => l.id), [script.lanes]);
  const laneIdx = lanes.indexOf(activeLane);
  const currentSide = laneIdx < 0 ? 'center' : laneIdx < lanes.length / 3 ? 'left' : laneIdx < (2 * lanes.length) / 3 ? 'center' : 'right';

  const slotKeys = useMemo(() => [...new Set([...Object.keys(slotDescriptions), ...Object.keys(slots)])], [slotDescriptions, slots]);
  const filled = Object.keys(slots).filter((k) => isSet(slots[k])).length;
  const slotProgress = `${Math.min(100, Math.round((filled / Math.max(1, Object.keys(slotDescriptions).length)) * 100))}%`;

  const visitedStates = useMemo(() => new Set(data?.path || []), [data?.path]);
  const visitedLanes = useMemo(() => new Set((data?.path || []).map((st) => stateMap[st]?.lane).filter(Boolean)), [data?.path, stateMap]);

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

  const turnEvents = (data?.events || []).map(eventChip).filter(Boolean);
  const extraction = lastItem
    ? { extracted: lastItem.extracted, intents: lastItem.intents, path: lastItem.path, lane: `${lastItem.lane_from} → ${lastItem.lane}` }
    : {};

  const summary = [
    ['Caller', data?.caller_number || '—'],
    ['State', activeState],
    ['Language', data?.language || script.meta?.default_language || 'english'],
    ['Slots', `${filled} · ${slotProgress}`],
    ['Retries', `${retry.used}/${retry.max}${retry.streak ? ` · streak ${retry.streak}/${retry.max_streak}` : ''}`],
  ];

  return (
    <div className="app">
      <TopBar path={path} eyebrow={`${botName} · FSM TEST CONSOLE`} title="Live voice-flow debugger">
        <label className="callerBox">
          <span>Calling from</span>
          <input list="known-callers" value={caller} onChange={(e) => setCaller(e.target.value.replace(/\D/g, '').slice(0, 10))} />
          <datalist id="known-callers">
            {known.map((c) => <option key={c.phone_number} value={c.phone_number}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || 'incomplete call on file'}</option>)}
          </datalist>
        </label>
        <span className={'live ' + (terminal ? 'dead' : '')}>● {terminal ? 'TERMINAL' : 'LIVE'}</span>
        <button className="secondary" onClick={() => start(true)}>New call</button>
        <button className="secondary" disabled={terminal || !sid} onClick={endCall}>Hang up</button>
      </TopBar>

      {error && <div className="empty" role="alert">⚠ {error}</div>}
      {data?.persisted && (
        <div className="notice ok">
          ✔ Call saved · outcome <b>{data.persisted.outcome}</b> · {(data.persisted.saved || []).join(', ')}. Call again from <b>{data.caller_number}</b> to see the stored record retrieved.
        </div>
      )}
      {data?.jump && (
        <div className="notice jump">
          ↪ Updating <b>{data.jump.group}</b> — will return to <b>{data.jump.resume}</b> after the update{data.jump.queued?.length ? ` (then: ${data.jump.queued.join(', ')})` : ''}.
        </div>
      )}

      <div className="laneStrip" aria-label="Lanes">
        {(script.lanes || []).map((l) => (
          <div key={l.id} className={'laneChip' + (l.id === activeLane ? ' active' : visitedLanes.has(l.id) ? ' visited' : '') + (l.on_demand ? ' demand' : '')}>{l.label}</div>
        ))}
      </div>

      <div className="dashboard">
        <ConversationPanel
          botName={botName} hist={hist} terminal={terminal} busy={busy} error={error} send={send}
          prompt={terminal ? lastItem?.assistant || greeting : greeting}
          activeLane={activeLane} activeState={activeState} summary={summary}
        />
        <InspectorPanel
          data={data} slots={slots} slotKeys={slotKeys} slotDescriptions={slotDescriptions} filled={filled}
          turnEvents={turnEvents} hist={hist} flags={flags} extraction={extraction}
        />
        <SidePanel
          ms={data?.metrics || {}} activeLane={activeLane} activeState={activeState} currentSide={currentSide}
          retry={retry} terminal={terminal} flowPath={flowPath} laneGroups={laneGroups} visitedStates={visitedStates}
        />
      </div>
    </div>
  );
}
