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
  const t = call?.transcript || call?.history;
  return Array.isArray(t) ? t : [];
};

function ReviewBadge({ value }) {
  if (value === 'right') return <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Pass</span>;
  if (value === 'wrong') return <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-300">Needs work</span>;
  return <span className="text-xs text-slate-400">Unrated</span>;
}

export default function CallReviewPage({ path, script }) {
  const [calls, setCalls] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'ok' | 'error', text }
  const [rating, setRating] = useState('');
  const [note, setNote] = useState('');

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

  const selectedCall = useMemo(
    () => (selectedId ? calls.find((call) => call.call_id === selectedId) || null : null),
    [calls, selectedId]
  );

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

  const openCall = (id) => { setMessage(null); setSelectedId(id); };

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
              <button type="button" onClick={() => setSelectedId('')} className={btn}>Back to list</button>
            </div>

            <div className="grid gap-5 p-5 xl:grid-cols-[360px_minmax(0,1fr)]">
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
                  <h3 className="text-sm font-semibold">Full conversation</h3>
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
                        <li key={`${item.turn || index}-${index}`} className="flex flex-col gap-2.5">
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
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </section>
            </div>
          </section>
        )}
    </div>
  );
}