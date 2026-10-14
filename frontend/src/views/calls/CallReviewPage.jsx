import { useEffect, useMemo, useState } from 'react';

import { navigate } from '../../hooks/useRoute';

import { api } from '../../api/client';

import TopBar from '../../components/TopBar';



const DONE_OUTCOMES = new Set(['completed', 'transferred', 'callback_requested', 'dropped']);

const OUTCOME_FILTERS = ['all', ...DONE_OUTCOMES];

const PAGE_SIZES = [10, 25, 50];

const REVIEW_OPTIONS = [

  { value: 'right', label: 'Pass' },

  { value: 'wrong', label: 'Needs work' },

];



const OUTCOME_STYLES = {

  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',

  transferred: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',

  callback_requested: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',

};

const OUTCOME_FALLBACK = 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';



const card = 'rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';

const btn =

  'inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-800 transition ' +

  'hover:border-teal-600 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ' +

  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-teal-400 dark:hover:bg-teal-950';



const outcomeLabel = (o) => (o || 'incomplete').replace(/_/g, ' ');



const getTranscript = (call) => {
  const transcript = Array.isArray(call?.transcript) ? call.transcript : [];
  const history = Array.isArray(call?.history) ? call.history : [];
  // Some stored calls have an empty transcript but a populated legacy history.
  return transcript.length ? transcript : history;
};

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const formatMetaValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return value === undefined || value === null || value === '' ? '' : String(value);
};

function DebugStat({ label, value, detail }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{value || '—'}</p>
      {detail ? <p className="mt-1 truncate font-mono text-xs text-slate-500 dark:text-slate-400">{detail}</p> : null}
    </div>
  );
}

function DebugJsonPanel({ title, value, emptyText }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
      <h3 className="border-b border-slate-200 px-3 py-2.5 text-sm font-semibold dark:border-slate-800">{title}</h3>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        {value == null ? JSON.stringify({ status: emptyText }, null, 2) : JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}



function ReviewBadge({ value }) {

  if (value === 'right') return <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Pass</span>;

  if (value === 'wrong') return <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-300">Needs work</span>;

  return <span className="text-xs text-slate-400">Unrated</span>;

}



export default function CallReviewPage({ path, script }) {

  const [calls, setCalls] = useState([]);

  const [selectedId, setSelectedId] = useState('');
  const [selectedTurnIndex, setSelectedTurnIndex] = useState(null);
  const [selectedCallDetails, setSelectedCallDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState(null); // { type: 'ok' | 'error', text }

  const [rating, setRating] = useState('');

  const [note, setNote] = useState('');
  const [showPromptTemplates, setShowPromptTemplates] = useState(false);
  const [promptScript, setPromptScript] = useState(script || null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptLoadError, setPromptLoadError] = useState('');



  // list filter + pagination

  const [outcomeFilter, setOutcomeFilter] = useState('all');

  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const [page, setPage] = useState(1);



  const loadCalls = async () => {

    try {

      setLoading(true);

      const items = await api.listCalls(200);

      const done = (items || []).filter(

        (call) => DONE_OUTCOMES.has(call.outcome) && getTranscript(call).length >= 1

      );

      setCalls(done);

    } catch {

      setCalls([]);

    } finally {

      setLoading(false);

    }

  };



  useEffect(() => { loadCalls(); }, []);



  const selectedCall = useMemo(() => {
    if (!selectedId) return null;

    // While a call is being fetched, do not render diagnostics from the previous
    // list-summary object. That prevents the right panel briefly retaining the
    // previous conversation's state, slots, classifier and LLM output.
    if (detailLoading) {
      return selectedCallDetails?.call_id === selectedId ? selectedCallDetails : null;
    }

    if (selectedCallDetails?.call_id === selectedId) return selectedCallDetails;
    return calls.find((call) => call.call_id === selectedId) || null;
  }, [calls, selectedId, selectedCallDetails, detailLoading]);

  // The list endpoint can contain summary/stale data. Fetch the full saved call
  // whenever the user opens a conversation so diagnostics are for that call.
  useEffect(() => {
    setSelectedTurnIndex(null);
    if (!selectedId) {
      setSelectedCallDetails(null);
      setDetailLoading(false);
      return undefined;
    }

    let cancelled = false;
    setSelectedCallDetails(null);
    setDetailLoading(true);
    api.getCall(selectedId)
      .then((result) => {
        if (cancelled) return;
        const detail = result?.call || result?.data || result;
        if (detail && typeof detail === 'object') {
          setSelectedCallDetails({ ...detail, call_id: detail.call_id || selectedId });
          setCalls((current) => current.map((item) =>
            item.call_id === selectedId ? { ...item, ...detail, call_id: detail.call_id || selectedId } : item
          ));
        }
      })
      .catch((error) => {
        if (!cancelled) setMessage({ type: 'error', text: `Could not load full call details: ${error?.message || 'request failed'}` });
      })
      .finally(() => { if (!cancelled) setDetailLoading(false); });

    return () => { cancelled = true; };
  }, [selectedId]);



  const filteredCalls = useMemo(

    () => (outcomeFilter === 'all' ? calls : calls.filter((c) => c.outcome === outcomeFilter)),

    [calls, outcomeFilter]

  );



  const totalPages = Math.max(1, Math.ceil(filteredCalls.length / pageSize));

  const currentPage = Math.min(page, totalPages); // clamps if the list shrinks



  const pageCalls = useMemo(

    () => filteredCalls.slice((currentPage - 1) * pageSize, currentPage * pageSize),

    [filteredCalls, currentPage, pageSize]

  );



  const rangeStart = filteredCalls.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;

  const rangeEnd = Math.min(currentPage * pageSize, filteredCalls.length);



  useEffect(() => {

    if (!selectedCall) {

      setRating('');

      setNote('');

      return;

    }

    setRating(selectedCall.review?.result || selectedCall.rating || '');

    setNote(selectedCall.review?.note || '');

  }, [selectedCall]);



  const transcript = getTranscript(selectedCall);
  const latestTurn = transcript.length ? transcript[transcript.length - 1] : {};
  // Diagnostics are intentionally scoped to the exact conversation turn the user clicks.
  const activeTurn = selectedTurnIndex !== null && selectedTurnIndex >= 0 && selectedTurnIndex < transcript.length
    ? transcript[selectedTurnIndex]
    : latestTurn;
  const currentState = firstValue(
    activeTurn?.to_state, activeTurn?.toState, activeTurn?.state,
    activeTurn?.lane, activeTurn?.from_state, activeTurn?.fromState
  );
  const classifierOutput = firstValue(
    activeTurn?.classifier_output, activeTurn?.classifierOutput,
    activeTurn?.classification, activeTurn?.classifier
  );
  const llmOutput = firstValue(
    activeTurn?.llm_output, activeTurn?.llmOutput,
    activeTurn?.capture, activeTurn?.llm, activeTurn?.response_builder,
    activeTurn?.responseBuilder
  );
  const classifierLatency = firstValue(
    activeTurn?.classifier_latency_ms, activeTurn?.classifierLatencyMs,
    activeTurn?.classification?.latency_ms, activeTurn?.classification?.latencyMs,
    activeTurn?.classification?.ms,
    activeTurn?.classifier?.latency_ms, activeTurn?.classifier?.latencyMs,
    activeTurn?.classifier?.ms,
    activeTurn?.timings?.classifier_ms, activeTurn?.timings?.classifierMs,
    activeTurn?.latencies?.classifier_ms, activeTurn?.latencies?.classifier
  );
  const llmLatency = firstValue(
    activeTurn?.response_builder_latency_ms, activeTurn?.responseBuilderLatencyMs,
    activeTurn?.capture_latency_ms, activeTurn?.captureLatencyMs,
    activeTurn?.capture?.latency_ms, activeTurn?.capture?.latencyMs, activeTurn?.capture?.ms,
    activeTurn?.response_builder?.latency_ms, activeTurn?.response_builder?.ms,
    activeTurn?.responseBuilder?.latency_ms, activeTurn?.responseBuilder?.ms,
    activeTurn?.timings?.response_builder_ms, activeTurn?.timings?.responseBuilderMs,
    activeTurn?.timings?.capture_ms, activeTurn?.timings?.captureMs,
    activeTurn?.latencies?.response_builder_ms, activeTurn?.latencies?.responseBuilder,
    activeTurn?.latencies?.capture_ms, activeTurn?.latencies?.capture
  );
  const latency = firstValue(
    activeTurn?.latency_ms, activeTurn?.latencyMs,
    activeTurn?.total_latency_ms, activeTurn?.totalLatencyMs,
    activeTurn?.duration_ms, activeTurn?.durationMs
  );
  const slots = firstValue(
    activeTurn?.slots, activeTurn?.slot_values, activeTurn?.slotValues,
    activeTurn?.capture?.slots, activeTurn?.capture?.slot_values,
    activeTurn?.extracted?.slots, activeTurn?.extracted,
    activeTurn?.capture?.extracted
  ) || {};
  const slotEntries = slots && typeof slots === 'object' ? Object.entries(slots) : [];
  const filledSlotCount = slotEntries.filter(([, value]) => value !== undefined && value !== null && value !== '').length;
  const turnIntent = firstValue(
    activeTurn?.intents, activeTurn?.intent,
    activeTurn?.classification?.intents, activeTurn?.classifier?.intents,
    activeTurn?.classifier_output?.intents, activeTurn?.classifierOutput?.intents
  );


  const handleSaveReview = async () => {

    if (!selectedCall) return;

    setSaving(true);

    try {

      const updated = await api.reviewCall(selectedCall.call_id, {

        result: rating || undefined,

        note: note.trim(),

      });

      setCalls((current) => current.map((call) => (call.call_id === updated.call_id ? updated : call)));

      setMessage({ type: 'ok', text: `Review saved for ${updated.caller_number || 'this call'}.` });

      setTimeout(() => {

        setMessage(null);

        setSelectedId('');

      }, 1200);

    } catch (err) {

      setMessage({ type: 'error', text: err.message || 'Failed to save review.' });

    } finally {

      setSaving(false);

    }

  };



  const openCall = (id) => { setMessage(null); setSelectedTurnIndex(null); setSelectedCallDetails(null); setSelectedId(id); };



  return (

    <div className="flex min-h-screen flex-col gap-4 bg-slate-100 px-3 pb-6 pt-4 font-sans text-slate-900 sm:px-7 dark:bg-slate-950 dark:text-slate-100 [&>:first-child]:!mb-0 [&>:first-child]:!mt-0">

      <TopBar path={path} eyebrow={`${(script?.meta?.bot_name || 'ROSHNI').toUpperCase()} · CALL REVIEW`} title="Done calls">

        <button type="button" onClick={() => navigate('/test')} className={btn}>Back to test console</button>

      </TopBar>



        {!selectedCall ? (

          <main className={`${card} overflow-hidden`}>

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">

              <div className="flex items-baseline gap-3">

                <h2 className="text-sm font-semibold">Completed calls</h2>

                <span className="text-xs text-slate-500 dark:text-slate-400">

                  {filteredCalls.length}{outcomeFilter !== 'all' ? ` of ${calls.length}` : ''} saved

                </span>

              </div>



              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">

                Outcome

                <select

                  value={outcomeFilter}

                  onChange={(e) => { setOutcomeFilter(e.target.value); setPage(1); }}

                  className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm capitalize text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"

                >

                  {OUTCOME_FILTERS.map((o) => (

                    <option key={o} value={o}>{o === 'all' ? 'All outcomes' : outcomeLabel(o)}</option>

                  ))}

                </select>

              </label>

            </div>



            <div className="max-h-[75vh] overflow-auto">

              {loading ? (

                <p className="px-5 py-12 text-center text-sm text-slate-500">Loading done calls…</p>

              ) : filteredCalls.length === 0 ? (

                <p className="px-5 py-12 text-center text-sm text-slate-500">

                  {calls.length === 0

                    ? 'No completed calls yet. Finish a call in the test console and it will show up here.'

                    : 'No calls match this outcome.'}

                </p>

              ) : (

                <table className="min-w-full border-collapse text-left text-sm">

                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">

                    <tr className="border-b border-slate-200 dark:border-slate-800">

                      <th scope="col" className="px-5 py-2.5">Caller</th>

                      <th scope="col" className="px-5 py-2.5">Outcome</th>

                      <th scope="col" className="px-5 py-2.5">Final state</th>

                      <th scope="col" className="px-5 py-2.5">Review</th>

                    </tr>

                  </thead>

                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">

                    {pageCalls.map((call) => (

                      <tr

                        key={call.call_id}

                        tabIndex={0}

                        onClick={() => openCall(call.call_id)}

                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openCall(call.call_id))}

                        className="cursor-pointer transition hover:bg-teal-50/60 focus-visible:bg-teal-50 focus-visible:outline-none dark:hover:bg-teal-950/40 dark:focus-visible:bg-teal-950/40"

                      >

                        <td className="px-5 py-3.5 font-mono font-medium">{call.caller_number || 'Unknown caller'}</td>

                        <td className="px-5 py-3.5">

                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${OUTCOME_STYLES[call.outcome] || OUTCOME_FALLBACK}`}>

                            {outcomeLabel(call.outcome)}

                          </span>

                        </td>

                        <td className="px-5 py-3.5 font-mono text-xs text-slate-600 dark:text-slate-400">{call.final_state || '—'}</td>

                        <td className="px-5 py-3.5"><ReviewBadge value={call.review?.result || call.rating} /></td>

                      </tr>

                    ))}

                  </tbody>

                </table>

              )}

            </div>



            {!loading && filteredCalls.length > 0 && (

              <nav

                aria-label="Pagination"

                className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400"

              >

                <span>Showing {rangeStart}–{rangeEnd} of {filteredCalls.length}</span>



                <div className="flex flex-wrap items-center gap-3">

                  <label className="flex items-center gap-2">

                    Rows

                    <select

                      value={pageSize}

                      onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}

                      className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"

                    >

                      {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}

                    </select>

                  </label>



                  <button

                    type="button"

                    className={`${btn} !h-8 disabled:cursor-not-allowed disabled:opacity-50`}

                    disabled={currentPage <= 1}

                    onClick={() => setPage(currentPage - 1)}

                  >

                    Previous

                  </button>

                  <span aria-live="polite">Page {currentPage} of {totalPages}</span>

                  <button

                    type="button"

                    className={`${btn} !h-8 disabled:cursor-not-allowed disabled:opacity-50`}

                    disabled={currentPage >= totalPages}

                    onClick={() => setPage(currentPage + 1)}

                  >

                    Next

                  </button>

                </div>

              </nav>

            )}

          </main>

        ) : (

          <section className={`${card} overflow-hidden`}>

            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between dark:border-slate-800">

              <div>

                <p className="text-xs text-slate-500 dark:text-slate-400">Call review</p>

                <h2 className="font-mono text-lg font-semibold">{selectedCall.caller_number || 'Unknown caller'}</h2>

              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={async () => {
                  setShowPromptTemplates(true);
                  setPromptLoading(true);
                  setPromptLoadError('');
                  try {
                    const result = await api.getActiveScript();
                    let resolved = result?.script || result?.active_script || result?.activeScript || result?.data || result;
                    if (typeof resolved === 'string') { try { resolved = JSON.parse(resolved); } catch {} }
                    setPromptScript(resolved || script || null);
                  } catch (error) {
                    setPromptLoadError(error?.message || 'Could not load the active script from the backend.');
                    setPromptScript(script || null);
                  } finally {
                    setPromptLoading(false);
                  }
                }} className={btn}>Prompt templates</button>
                <button type="button" onClick={() => setSelectedId('')} className={btn}>Back to list</button>
              </div>

            </div>



            <div className="grid gap-5 p-4 xl:grid-cols-[260px_minmax(300px,1fr)_320px]">

              {/* review form */}

              <aside className="flex h-fit flex-col gap-5 rounded-xl border border-slate-200 bg-slate-50 p-4 xl:sticky xl:top-4 dark:border-slate-800 dark:bg-slate-950/40">

                {message && (

                  <div

                    role={message.type === 'error' ? 'alert' : 'status'}

                    className={

                      'rounded-lg border border-l-4 px-3 py-2 text-sm ' +

                      (message.type === 'error'

                        ? 'border-red-200 border-l-red-600 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200'

                        : 'border-emerald-200 border-l-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200')

                    }

                  >

                    {message.text}

                  </div>

                )}



                <div>

                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">Summary</h3>

                  <div className="mt-2 flex flex-wrap gap-2">

                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${OUTCOME_STYLES[selectedCall.outcome] || OUTCOME_FALLBACK}`}>

                      {outcomeLabel(selectedCall.outcome)}

                    </span>

                    {selectedCall.final_state && (

                      <span className="inline-flex rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">

                        {selectedCall.final_state}

                      </span>

                    )}

                  </div>

                </div>



                <div>

                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400" id="rate-label">Rate this call</h3>

                  <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-labelledby="rate-label">

                    {REVIEW_OPTIONS.map((option) => {

                      const on = rating === option.value;

                      const good = option.value === 'right';

                      return (

                        <button

                          key={option.value}

                          type="button"

                          aria-pressed={on}

                          onClick={() => setRating(option.value)}

                          className={

                            'h-10 rounded-lg border text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ' +

                            (on

                              ? good

                                ? 'border-emerald-500 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'

                                : 'border-rose-500 bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'

                              : 'border-slate-300 bg-white text-slate-700 hover:border-teal-600 hover:bg-teal-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-teal-950')

                          }

                        >

                          {option.label}

                        </button>

                      );

                    })}

                  </div>

                </div>



                <div>

                  <label htmlFor="review-note" className="text-xs font-semibold text-slate-500 dark:text-slate-400">Review notes</label>

                  <textarea

                    id="review-note"

                    value={note}

                    onChange={(e) => setNote(e.target.value)}

                    rows={5}

                    placeholder="What worked, what didn't, and what to change in the flow"

                    className="mt-2 w-full resize-y rounded-lg !border !border-slate-300 !bg-white px-3 py-2 text-sm !text-slate-900 !outline-none placeholder:!text-slate-400 focus:!border-teal-600 focus:ring-4 focus:ring-teal-600/15 dark:!border-slate-700 dark:!bg-slate-950 dark:!text-slate-100"

                  />

                </div>



                <button

                  type="button"

                  onClick={handleSaveReview}

                  disabled={saving}

                  className="h-10 rounded-lg bg-teal-700 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500"

                >

                  {saving ? 'Saving…' : 'Save review'}

                </button>

              </aside>



              {/* transcript */}

              <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">

                <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">

                  <div>
                    <h3 className="text-sm font-semibold">Full conversation</h3>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Click any turn to inspect its diagnostics</p>
                  </div>

                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">

                    {transcript.length} {transcript.length === 1 ? 'turn' : 'turns'}

                  </span>

                </header>



                <div className="max-h-[72vh] overflow-y-auto px-4 py-4">

                  {transcript.length === 0 ? (

                    <p className="py-10 text-center text-sm text-slate-500">No transcript saved for this call.</p>

                  ) : (

                    <ol className="flex flex-col gap-6">

                      {transcript.map((item, index) => (

                        <li
                          key={`${item.turn || index}-${index}`}
                          onClick={() => setSelectedTurnIndex(index)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedTurnIndex(index); } }}
                          aria-pressed={selectedTurnIndex === index}
                          className={`flex cursor-pointer flex-col gap-2.5 rounded-xl p-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 ${selectedTurnIndex === index ? 'bg-teal-950/30 ring-1 ring-teal-500/70' : 'hover:bg-slate-900/50'}`}
                        >

                          <div className="flex items-center gap-3 text-xs text-slate-400">

                            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />

                            <span>Turn {item.turn || index + 1} · <span className="font-mono">{item.lane || item.from_state || '—'}</span></span>

                            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />

                          </div>



                          <div className="max-w-[85%] self-end">

                            <div className="mb-1 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Customer</div>

                            <p className="whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-teal-700 px-4 py-2.5 text-sm leading-relaxed text-white dark:bg-teal-600">

                              {item.user || <em className="opacity-70">No customer input recorded</em>}

                            </p>

                          </div>



                          <div className="max-w-[85%] self-start">

                            <div className="mb-1 text-xs font-semibold text-teal-700 dark:text-teal-300">Assistant</div>

                            <p className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2.5 text-sm leading-relaxed dark:bg-slate-800">
                              {item.assistant || <em className="text-slate-500">No assistant reply recorded</em>}
                            </p>
                            {(() => {
                              const fromState = firstValue(item.from_state, item.fromState, item.previous_state, item.previousState);
                              const toState = firstValue(item.to_state, item.toState, item.next_state, item.nextState, item.state, item.lane);
                              // Keep total latency separate from the classifier and response-builder timings.
                              // The API has used several field names across runtime/debug payloads, so read
                              // known aliases without inventing values when a timing was not saved.
                              const latency = firstValue(
                                item.latency_ms, item.latencyMs,
                                item.total_latency_ms, item.totalLatencyMs,
                                item.duration_ms, item.durationMs
                              );
                              const classifierLatency = firstValue(
                                item.classifier_latency_ms, item.classifierLatencyMs,
                                item.classifier?.latency_ms, item.classifier?.latencyMs, item.classifier?.ms,
                                item.classification?.latency_ms, item.classification?.latencyMs, item.classification?.ms,
                                item.classifier_output?.latency_ms, item.classifierOutput?.latency_ms,
                                item.timings?.classifier_ms, item.timings?.classifierMs,
                                item.latencies?.classifier_ms, item.latencies?.classifier
                              );
                              const responseBuilderLatency = firstValue(
                                item.response_builder_latency_ms, item.responseBuilderLatencyMs,
                                item.response_builder?.latency_ms, item.response_builder?.latencyMs, item.response_builder?.ms,
                                item.responseBuilder?.latency_ms, item.responseBuilder?.latencyMs, item.responseBuilder?.ms,
                                item.capture_latency_ms, item.captureLatencyMs,
                                item.capture?.latency_ms, item.capture?.latencyMs, item.capture?.ms,
                                item.timings?.response_builder_ms, item.timings?.responseBuilderMs,
                                item.timings?.capture_ms, item.timings?.captureMs,
                                item.latencies?.response_builder_ms, item.latencies?.responseBuilder,
                                item.latencies?.capture_ms, item.latencies?.capture
                              );
                              const intent = firstValue(
                                item.intents, item.intent,
                                item.classifier_output?.intents, item.classifierOutput?.intents,
                                item.classifier?.intents, item.classification?.intents
                              );
                              const hasMeta = fromState || toState ||
                                latency !== undefined || classifierLatency !== undefined ||
                                responseBuilderLatency !== undefined || intent !== undefined;
                              return hasMeta ? (
                                <p className="mt-1.5 break-words px-1 font-mono text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
                                  {fromState || toState ? <span>{fromState || '—'}{fromState && toState ? ' → ' : ''}{toState || ''}</span> : null}
                                  {latency !== undefined ? <span>{fromState || toState ? ' · ' : ''}total: {latency} ms</span> : null}
                                  {classifierLatency !== undefined ? <span>{fromState || toState || latency !== undefined ? ' · ' : ''}classifier: {classifierLatency} ms</span> : null}
                                  {responseBuilderLatency !== undefined ? <span>{fromState || toState || latency !== undefined || classifierLatency !== undefined ? ' · ' : ''}response builder: {responseBuilderLatency} ms</span> : null}
                                  {intent !== undefined ? <span>{fromState || toState || latency !== undefined || classifierLatency !== undefined || responseBuilderLatency !== undefined ? ' · ' : ''}intents: {formatMetaValue(intent)}</span> : null}
                                </p>
                              ) : null;
                            })()}
                          </div>

                        </li>

                      ))}

                    </ol>

                  )}

                </div>

              </section>

              {/* Runtime diagnostics update to the selected transcript turn */}
              <aside className="flex min-w-0 flex-col gap-4 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-2rem)] 2xl:overflow-y-auto">
                {detailLoading ? <p className="rounded-lg border border-teal-800/50 bg-teal-950/30 px-3 py-2 text-xs text-teal-200">Refreshing diagnostics for this call…</p> : null}
                <p className="text-xs text-slate-500 dark:text-slate-400">Showing diagnostics for Turn {activeTurn?.turn || (transcript.indexOf(activeTurn) + 1) || '—'}</p>
                <div className="grid grid-cols-2 gap-2">
                  <DebugStat label="Current" value={currentState || 'Not recorded'} detail={latency !== undefined ? `total ${latency} ms` : 'selected turn'} />
                  <DebugStat label="Classifier" value={classifierLatency !== undefined ? 'Completed' : (classifierOutput ? 'Output saved' : 'Not recorded for this turn')} detail={classifierLatency !== undefined ? `${classifierLatency} ms` : '—'} />
                  <DebugStat label="LLM" value={llmLatency !== undefined ? 'Completed' : (llmOutput ? 'Output saved' : 'Not recorded for this turn')} detail={llmLatency !== undefined ? `${llmLatency} ms` : '—'} />
                  <DebugStat label="Slots" value={`${filledSlotCount} filled`} detail={`${slotEntries.length} recorded in this turn`} />
                </div>

                <DebugJsonPanel title="Classifier output" value={classifierOutput} emptyText="no classifier output saved for this turn" />
                <DebugJsonPanel title="LLM output" value={llmOutput} emptyText="no LLM output saved for this turn" />

                <section className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
                    <h3 className="text-sm font-semibold">Slots filled</h3>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {slotEntries.length ? `${Math.round((filledSlotCount / slotEntries.length) * 100)}%` : '—'}
                    </span>
                  </div>
                  {slotEntries.length ? (
                    <div className="grid gap-2 p-3">
                      {slotEntries.map(([key, value]) => (
                        <div key={key} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                          <p className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300">{key}</p>
                          <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{formatMetaValue(value) || '—'}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-3 py-4 text-xs text-slate-500 dark:text-slate-400">No slot data was saved for this call.</p>
                  )}
                </section>
              </aside>
            </div>

          </section>

        )}

      {showPromptTemplates && (() => {
        // Calls API includes prompt_templates on each call record; prefer that data
        // before falling back to the active-script endpoint or page prop.
        const source = selectedCall?.prompt_templates
          ? selectedCall
          : (promptScript || script || {});
        const templates = source?.prompt_templates || source?.promptTemplates || source?.config?.prompt_templates || source?.config?.promptTemplates || source?.script?.prompt_templates || source?.script?.promptTemplates || {}; 
        const entries = templates && typeof templates === 'object' && !Array.isArray(templates) ? Object.entries(templates) : [];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="prompt-templates-title" onClick={(event) => { if (event.target === event.currentTarget) setShowPromptTemplates(false); }}>
            <section className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
              <header className="flex items-center justify-between gap-3 border-b border-slate-700 px-5 py-4">
                <div>
                  <h2 id="prompt-templates-title" className="text-base font-semibold">Prompt templates</h2>
                  <p className="mt-1 text-xs text-slate-400">Active script · {promptLoading ? 'loading…' : `${entries.length} template${entries.length === 1 ? '' : 's'}`}</p>
                </div>
                <button type="button" onClick={() => setShowPromptTemplates(false)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-400">Close ✕</button>
              </header>
              <div className="min-h-0 space-y-4 overflow-y-auto p-4 sm:p-5">
                {promptLoading ? (
                  <div className="rounded-xl border border-slate-700 p-5 text-sm text-slate-300">Loading prompt templates from the active script…</div>
                ) : entries.length ? entries.map(([name, template]) => (
                  <article key={name} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950/70">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 px-4 py-3">
                      <h3 className="text-sm font-semibold capitalize">{name.replace(/[_-]/g, ' ')}</h3>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                        {template?.type && <span className="rounded-md bg-slate-800 px-2 py-1">Type: {String(template.type)}</span>}
                        {template?.model && <span className="rounded-md bg-slate-800 px-2 py-1">Model: {String(template.model)}</span>}
                        {template?.language && <span className="rounded-md bg-slate-800 px-2 py-1">Language: {String(template.language)}</span>}
                      </div>
                    </div>
                    <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-slate-200">{JSON.stringify(template, null, 2)}</pre>
                    <div className="flex justify-end border-t border-slate-800 px-4 py-2">
                      <button type="button" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(template, null, 2)); }} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs hover:border-teal-400 hover:text-teal-300">Copy template</button>
                    </div>
                  </article>
                )) : (
                  <div className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-200">
                    {promptLoadError ? `${promptLoadError} ` : ''}No prompt templates were found in the loaded script. The backend response may wrap the script differently, or prompt_templates may not be included in the active-script API response.
                  </div>
                )}
              </div>
            </section>
          </div>
        );
      })()}

    </div>

  );

}