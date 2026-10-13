import { useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { useSession } from '../../hooks/useSession';
import { navigate } from '../../hooks/useRoute';
import { eventChip } from '../../lib/events';
import { isSet } from '../../lib/format';
import ConversationPanel from './ConversationPanel';
import InspectorPanel from './InspectorPanel';

const btn =
  'h-9 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-800 transition ' +
  'hover:border-teal-600 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-white ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-teal-400 dark:hover:bg-teal-950 dark:disabled:hover:border-slate-700 dark:disabled:hover:bg-slate-900';

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

  const lanesList = script.lanes || [];

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-slate-100 px-3 pb-6 pt-4 font-sans [&>:first-child]:!mb-0 [&>:first-child]:!mt-0 text-slate-900 sm:px-7 dark:bg-slate-950 dark:text-slate-100">
      <TopBar path={path} eyebrow={`${botName} · FSM TEST CONSOLE`} title="Live voice-flow debugger">
        <div className="flex h-9 items-center rounded-lg border border-slate-300 bg-white text-slate-900 focus-within:border-teal-600 focus-within:ring-4 focus-within:ring-teal-600/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <label htmlFor="caller" className="whitespace-nowrap pl-3 pr-2 text-xs text-slate-500 dark:text-slate-400">Calling from</label>
          <input
            id="caller"
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            list="known-callers"
            placeholder="10-digit number"
            value={caller}
            onChange={(e) => setCaller(e.target.value.replace(/\D/g, '').slice(0, 10))}
            onKeyDown={(e) => e.key === 'Enter' && (caller.length === 0 || caller.length === 10) && start(true)}
            className="h-full w-36 !rounded-none !border-0 !bg-transparent !p-0 font-mono text-sm font-medium tracking-wide !text-inherit !shadow-none !outline-none !ring-0 placeholder:font-sans placeholder:text-xs placeholder:font-normal placeholder:text-slate-400"
          />
          <datalist id="known-callers">
            {known.map((c) => (
              <option key={c.phone_number} value={c.phone_number}>
                {[c.first_name, c.last_name].filter(Boolean).join(' ') || 'incomplete call on file'}
              </option>
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => start(true)}
            disabled={caller.length > 0 && caller.length < 10}
            title={caller.length > 0 && caller.length < 10 ? 'Enter all 10 digits' : 'Start a new call from this number'}
            className="mx-1 h-7 rounded-md bg-teal-700 px-3 text-xs font-semibold text-white transition hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            Call
          </button>
        </div>

        <span
          className={
            'inline-flex h-7 items-center gap-2 rounded-full px-3 text-xs font-semibold ' +
            (terminal
              ? 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400')
          }
        >
          <span className="relative flex h-2 w-2">
            {!terminal && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60 motion-reduce:hidden" />}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
          </span>
          {terminal ? 'Call ended' : 'Live'}
        </span>

        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => navigate('/calls')}>View done calls</button>
          <button
            className={btn + ' enabled:hover:border-red-500 enabled:hover:bg-red-50 enabled:hover:text-red-700 dark:enabled:hover:bg-red-950 dark:enabled:hover:text-red-300'}
            disabled={terminal || !sid}
            onClick={endCall}
          >
            Hang up
          </button>
        </div>
      </TopBar>

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 border-l-4 border-l-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {data?.persisted && (
        <div role="status" className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-lg border border-slate-200 border-l-4 border-l-emerald-500 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:border-l-emerald-500 dark:bg-slate-900">
          <b>Call saved</b>
          <span className="text-slate-600 dark:text-slate-400">
            Outcome <b className="text-slate-900 dark:text-slate-100">{data.persisted.outcome}</b>
            {(data.persisted.saved || []).length ? ` · ${data.persisted.saved.join(', ')}` : ''}. Call again from{' '}
            <b className="text-slate-900 dark:text-slate-100">{data.caller_number}</b> to see the stored record retrieved.
          </span>
        </div>
      )}

      {data?.jump && (
        <div role="status" className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-lg border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:border-l-amber-500 dark:bg-amber-950">
          <b>Updating {data.jump.group}</b>
          <span className="text-slate-600 dark:text-slate-300">
            Will return to <b className="text-slate-900 dark:text-slate-100">{data.jump.resume}</b> after the update
            {data.jump.queued?.length ? `, then ${data.jump.queued.join(', ')}` : ''}.
          </span>
        </div>
      )}

      {/* Lane rail */}
      <nav aria-label="Call lanes" className="flex overflow-x-auto rounded-xl border border-slate-200 bg-white px-2 pb-3 pt-4 dark:border-slate-800 dark:bg-slate-900">
        {lanesList.map((l, i) => {
          const active = l.id === activeLane;
          const visited = !active && visitedLanes.has(l.id);
          return (
            <div
              key={l.id}
              aria-current={active ? 'step' : undefined}
              title={l.on_demand ? 'Only entered on demand' : undefined}
              className={
                'relative flex min-w-24 flex-1 flex-col items-center gap-2 px-1.5 text-center text-xs ' +
                (active ? 'font-bold text-slate-900 dark:text-white' : visited ? 'text-slate-800 dark:text-slate-200' : 'text-slate-500 dark:text-slate-500')
              }
            >
              <span
                className={
                  'relative z-10 h-3.5 w-3.5 rounded-full border-2 transition-all ' +
                  (l.on_demand ? 'border-dashed ' : '') +
                  (active
                    ? 'border-4 border-teal-600 bg-white ring-4 ring-teal-600/20 dark:bg-slate-900 dark:border-teal-400 dark:ring-teal-400/20'
                    : visited
                      ? 'border-teal-600 bg-teal-600 dark:border-teal-400 dark:bg-teal-400'
                      : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900')
                }
              />
              {i < lanesList.length - 1 && (
                <span
                  aria-hidden="true"
                  className={'absolute left-[calc(50%+10px)] top-[6px] h-0.5 w-[calc(100%-20px)] ' + (visited ? 'bg-teal-600 dark:bg-teal-400' : 'bg-slate-200 dark:bg-slate-700')}
                />
              )}
              <span className={l.on_demand && !active && !visited ? 'italic' : ''}>{l.label}</span>
            </div>
          );
        })}
      </nav>

      {/* Recent path */}
      {flowPath.length > 0 && (
        <div aria-label="Recent states" className="flex min-w-0 items-center gap-3">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Path</span>
          <ol className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {flowPath.map((p, i) => (
              <li
                key={p.state + i}
                className={
                  'flex-none rounded-md border px-2.5 py-1 font-mono text-xs ' +
                  (p.side === 'current'
                    ? 'border-teal-600 bg-teal-600 font-medium text-white dark:border-teal-400 dark:bg-teal-400 dark:text-slate-950'
                    : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400') +
                  (p.silent && p.side !== 'current' ? ' border-dashed opacity-70' : '')
                }
              >
                {p.state}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid flex-1 items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <ConversationPanel
          botName={botName}
          hist={hist}
          terminal={terminal}
          busy={busy}
          error={error}
          send={send}
          prompt={terminal ? lastItem?.assistant || greeting : greeting}
          activeLane={activeLane}
          activeState={activeState}
          summary={summary}
        />
        <InspectorPanel
          data={data}
          activeLane={activeLane}
          activeState={activeState}
          slots={slots}
          slotKeys={slotKeys}
          slotDescriptions={slotDescriptions}
          filled={filled}
        />
      </div>
    </div>
  );
}