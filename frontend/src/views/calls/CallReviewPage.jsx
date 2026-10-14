import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../../hooks/useRoute';
import { api } from '../../api/client';
import TopBar from '../../components/TopBar';

/* ───────────────────────── constants ───────────────────────── */

const DONE_OUTCOMES = ['completed', 'transferred', 'callback_requested', 'dropped'];
const DONE_SET = new Set(DONE_OUTCOMES);
const OUTCOME_FILTERS = ['all', ...DONE_OUTCOMES];
const PAGE_SIZES = [10, 25, 50];
const REVIEW_OPTIONS = [
  { value: 'right', label: 'Pass', hint: 'Handled correctly' },
  { value: 'wrong', label: 'Needs work', hint: 'Flow or reply was off' },
];

const OUTCOME_STYLES = {
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  transferred: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  callback_requested: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
};
const OUTCOME_FALLBACK = 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';

const OUTCOME_DOT = {
  completed: 'bg-emerald-500',
  transferred: 'bg-sky-500',
  callback_requested: 'bg-amber-500',
  dropped: 'bg-rose-500',
};

const card = 'rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600';
const btn =
  'inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-800 transition ' +
  'hover:border-teal-600 hover:bg-teal-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-teal-400 dark:hover:bg-teal-950 ' +
  focusRing;

/* ───────────────────────── helpers ───────────────────────── */

const outcomeLabel = (o) => (o || 'incomplete').replace(/_/g, ' ');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmtMs = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const reviewOf = (call) => call?.review?.result || call?.rating || '';

const getTranscript = (call) => {
  const t = call?.transcript || call?.history;
  return Array.isArray(t) ? t : [];
};

const formatUsage = (usage, key) => {
  const value = usage?.[key];
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'number' ? value.toLocaleString() : String(value);
};

const usageTotal = (u) => {
  if (!u) return 0;
  const t = num(u.total_tokens);
  if (t != null) return t;
  return (num(u.input_tokens) || 0) + (num(u.output_tokens) || 0);
};

/** Splits one turn's latency into classifier / capture / everything else. */
const turnTiming = (item) => {
  const classifier = num(item?.classification?.ms) || 0;
  const capture = num(item?.capture?.ms) || 0;
  const reported = num(item?.latency_ms);
  const total = reported ?? classifier + capture;
  const other = Math.max(0, total - classifier - capture);
  return { classifier, capture, other, total };
};

const scrollToTurn = (index) => {
  const el = document.getElementById(`turn-${index}`);
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
};

/* ───────────────────────── small pieces ───────────────────────── */

function OutcomePill({ outcome }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
        OUTCOME_STYLES[outcome] || OUTCOME_FALLBACK
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${OUTCOME_DOT[outcome] || 'bg-rose-500'}`} />
      {outcomeLabel(outcome)}
    </span>
  );
}

function ReviewBadge({ value }) {
  if (value === 'right')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Pass
      </span>
    );
  if (value === 'wrong')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M8 3v6M8 12.5v.5" strokeLinecap="round" />
        </svg>
        Needs work
      </span>
    );
  return <span className="text-xs text-slate-400 dark:text-slate-500">Not reviewed</span>;
}

function StatCard({ label, value, sub }) {
  return (
    <div className={`${card} px-4 py-3.5`}>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

function OutcomeMix({ calls }) {
  const total = calls.length;
  const counts = DONE_OUTCOMES.map((o) => ({ o, n: calls.filter((c) => c.outcome === o).length }));
  return (
    <div className={`${card} px-4 py-3.5 sm:col-span-2`}>
      <div className="text-xs text-slate-500 dark:text-slate-400">Outcome mix</div>
      <div
        className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="img"
        aria-label={counts.map(({ o, n }) => `${outcomeLabel(o)} ${n}`).join(', ')}
      >
        {counts.map(({ o, n }) =>
          n ? <div key={o} className={OUTCOME_DOT[o]} style={{ width: `${(n / total) * 100}%` }} /> : null
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        {counts.map(({ o, n }) => (
          <li key={o} className="flex items-center gap-1.5 capitalize">
            <span className={`h-2 w-2 rounded-full ${OUTCOME_DOT[o]}`} />
            {outcomeLabel(o)}
            <span className="tabular-nums text-slate-400 dark:text-slate-500">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal stacked bar: classifier / capture / other. Width is relative to the slowest turn. */
function LatencyBar({ timing, max }) {
  const { classifier, capture, other, total } = timing;
  if (!total) return <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800" />;
  const fill = max ? (total / max) * 100 : 100;
  const seg = (v) => ({ width: `${(v / total) * 100}%` });
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className="flex h-full" style={{ width: `${Math.max(fill, 4)}%` }}>
        <div className="bg-teal-600 dark:bg-teal-500" style={seg(classifier)} />
        <div className="bg-violet-500 dark:bg-violet-400" style={seg(capture)} />
        <div className="bg-slate-300 dark:bg-slate-600" style={seg(other)} />
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    ['bg-teal-600 dark:bg-teal-500', 'Classifier'],
    ['bg-violet-500 dark:bg-violet-400', 'Capture'],
    ['bg-slate-300 dark:bg-slate-600', 'Other'],
  ];
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
      {items.map(([cls, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-sm ${cls}`} />
          {label}
        </li>
      ))}
    </ul>
  );
}

function UsageBlock({ title, usage }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{title}</div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        {[
          ['Input', 'input_tokens'],
          ['Output', 'output_tokens'],
          ['Total', 'total_tokens'],
        ].map(([label, key]) => (
          <div key={key}>
            <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="font-mono tabular-nums text-slate-800 dark:text-slate-100">{formatUsage(usage, key)}</dd>
          </div>
        ))}
      </dl>
      {[
        ['Prompt', usage.input_prompt],
        ['Response', usage.output_response],
      ].map(([label, text]) => (
        <details key={label} className="group mt-2">
          <summary className={`cursor-pointer select-none rounded text-xs text-teal-700 hover:underline dark:text-teal-300 ${focusRing}`}>
            {label}
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-2.5 text-[11px] leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {text || '—'}
          </pre>
        </details>
      ))}
    </div>
  );
}

/* ───────────────────────── one conversation turn ───────────────────────── */

function TurnCard({ item, index, maxLatency, showDiagnostics }) {
  const classifier = item.classification || null;
  const capture = item.capture || null;
  const classifierUsage = classifier?.usage || null;
  const captureUsage = capture?.usage || null;
  const captureStatus = capture?.source ?? 'skipped';
  const captureStatusLabel =
    captureStatus === 'skipped' ? 'Skipped (not needed this turn)'
      : captureStatus === 'fallback' ? 'Fallback'
        : captureStatus === 'llm' ? 'LLM call run'
          : String(captureStatus || 'skipped');

  const timing = turnTiming(item);
  const tokens = usageTotal(classifierUsage) + usageTotal(captureUsage);
  const intents = classifier?.intents?.length ? classifier.intents : [];
  const fromState = item.from_state;
  const toState = item.to_state || item.state;
  const lane = item.lane || fromState;

  return (
    <li id={`turn-${index}`} className="flex scroll-mt-2 flex-col gap-3">
      <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-semibold text-slate-700 dark:text-slate-200">Turn {item.turn || index + 1}</span>
        {lane && toState && lane !== toState ? (
          <span className="flex items-center gap-1.5 font-mono">
            <span>{lane}</span>
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M2 8h11M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-teal-700 dark:text-teal-300">{toState}</span>
          </span>
        ) : (
          <span className="font-mono">{toState || lane || '—'}</span>
        )}
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        <span className="tabular-nums">{fmtMs(timing.total || null)}</span>
      </div>

      <div className="max-w-[85%] self-end">
        <div className="mb-1 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Customer</div>
        <p className="whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-teal-700 px-4 py-2.5 text-sm leading-relaxed text-white dark:bg-teal-600">
          {item.user || <em className="opacity-70">No customer input recorded</em>}
        </p>
      </div>

      <div className="max-w-[85%] self-start">
        <div className="mb-1 text-xs font-medium text-teal-700 dark:text-teal-300">Assistant</div>
        <p className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2.5 text-sm leading-relaxed dark:bg-slate-800">
          {item.assistant || <em className="text-slate-500">No assistant reply recorded</em>}
        </p>
      </div>

      {showDiagnostics && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950/40">
          {/* headline row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500 dark:text-slate-400">Intent</span>
              {intents.length ? (
                intents.map((i) => (
                  <span key={i} className="rounded-md bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                    {i}
                  </span>
                ))
              ) : (
                <span className="text-slate-400">none</span>
              )}
            </div>
            <div className="text-slate-500 dark:text-slate-400">
              Capture <span className="font-medium text-slate-700 dark:text-slate-200">{captureStatus === 'skipped' ? 'skipped' : captureStatusLabel}</span>
            </div>
            {tokens > 0 && (
              <div className="text-slate-500 dark:text-slate-400">
                Tokens <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200">{tokens.toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* latency */}
          <div className="mt-3">
            <LatencyBar timing={timing} max={maxLatency} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                <div className="flex gap-1"><dt>Classifier</dt><dd className="font-mono tabular-nums text-slate-700 dark:text-slate-200">{fmtMs(num(classifier?.ms))}</dd></div>
                <div className="flex gap-1"><dt>Capture</dt><dd className="font-mono tabular-nums text-slate-700 dark:text-slate-200">{fmtMs(num(capture?.ms))}</dd></div>
                <div className="flex gap-1"><dt>Turn</dt><dd className="font-mono tabular-nums text-slate-700 dark:text-slate-200">{fmtMs(timing.total || null)}</dd></div>
              </dl>
            </div>
          </div>

          {(classifierUsage || captureUsage) && (
            <details className="group mt-3">
              <summary className={`flex cursor-pointer select-none items-center gap-1.5 rounded text-xs font-medium text-teal-700 dark:text-teal-300 ${focusRing}`}>
                <svg viewBox="0 0 16 16" className="h-3 w-3 transition group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Token usage and prompts
              </summary>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                {classifierUsage && <UsageBlock title="Classifier" usage={classifierUsage} />}
                {captureUsage && <UsageBlock title="Capture" usage={captureUsage} />}
              </div>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

/* ───────────────────────── page ───────────────────────── */

export default function CallReviewPage({ path, script }) {
  const [calls, setCalls] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'ok' | 'error', text }
  const [rating, setRating] = useState('');
  const [note, setNote] = useState('');
  const [showDiagnostics, setShowDiagnostics] = useState(true);

  // list filter + pagination
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  const loadCalls = async () => {
    try {
      setLoading(true);
      const items = await api.listCalls(200);
      const done = (items || []).filter(
        (call) => DONE_SET.has(call.outcome) && getTranscript(call).length >= 1
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
  const currentPage = Math.min(page, totalPages);

  const pageCalls = useMemo(
    () => filteredCalls.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredCalls, currentPage, pageSize]
  );

  const rangeStart = filteredCalls.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, filteredCalls.length);

  // list-level stats
  const stats = useMemo(() => {
    const reviewed = calls.filter((c) => reviewOf(c));
    const passed = reviewed.filter((c) => reviewOf(c) === 'right').length;
    const turns = calls.reduce((s, c) => s + getTranscript(c).length, 0);
    return {
      total: calls.length,
      reviewed: reviewed.length,
      passRate: reviewed.length ? Math.round((passed / reviewed.length) * 100) : null,
      avgTurns: calls.length ? (turns / calls.length).toFixed(1) : '—',
    };
  }, [calls]);

  const countFor = (o) => (o === 'all' ? calls.length : calls.filter((c) => c.outcome === o).length);

  useEffect(() => {
    if (!selectedCall) {
      setRating('');
      setNote('');
      return;
    }
    setRating(reviewOf(selectedCall));
    setNote(selectedCall.review?.note || '');
  }, [selectedCall]);

  const transcript = getTranscript(selectedCall);

  // per-call latency overview
  const timings = useMemo(() => transcript.map(turnTiming), [transcript]);
  const maxLatency = useMemo(() => Math.max(0, ...timings.map((t) => t.total)), [timings]);
  const callTotals = useMemo(() => {
    const total = timings.reduce((s, t) => s + t.total, 0);
    const slowest = timings.reduce((best, t, i) => (t.total > (timings[best]?.total ?? -1) ? i : best), 0);
    const tokens = transcript.reduce(
      (s, t) => s + usageTotal(t.classification?.usage) + usageTotal(t.capture?.usage),
      0
    );
    return { total, avg: timings.length ? total / timings.length : 0, slowest, tokens };
  }, [timings, transcript]);

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
    <div className="flex min-h-screen flex-col gap-4 bg-slate-100 px-3 pb-8 pt-4 font-sans text-slate-900 sm:px-7 dark:bg-slate-950 dark:text-slate-100 [&>:first-child]:!mb-0 [&>:first-child]:!mt-0">
      <TopBar path={path} eyebrow={`${(script?.meta?.bot_name || 'ROSHNI').toUpperCase()} · CALL REVIEW`} title="Done calls">
        <button type="button" onClick={() => navigate('/test')} className={btn}>Back to test console</button>
      </TopBar>

      {!selectedCall ? (
        <>
          {/* ── overview ── */}
          {!loading && calls.length > 0 && (
            <section aria-label="Overview" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard label="Calls" value={stats.total} />
              <StatCard
                label="Reviewed"
                value={`${stats.reviewed}/${stats.total}`}
                sub={stats.total - stats.reviewed > 0 ? `${stats.total - stats.reviewed} waiting` : 'All caught up'}
              />
              <StatCard
                label="Pass rate"
                value={stats.passRate == null ? '—' : `${stats.passRate}%`}
                sub={stats.reviewed ? `of ${stats.reviewed} reviewed` : 'No reviews yet'}
              />
              <OutcomeMix calls={calls} />
            </section>
          )}

          {/* ── list ── */}
          <main className={`${card} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <div className="flex items-baseline gap-3">
                <h2 className="text-sm font-semibold">Completed calls</h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {filteredCalls.length}{outcomeFilter !== 'all' ? ` of ${calls.length}` : ''} saved · avg {stats.avgTurns} turns
                </span>
              </div>

              <div role="group" aria-label="Filter by outcome" className="flex flex-wrap gap-1.5">
                {OUTCOME_FILTERS.map((o) => {
                  const on = outcomeFilter === o;
                  return (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={on}
                      onClick={() => { setOutcomeFilter(o); setPage(1); }}
                      className={
                        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium capitalize transition ' +
                        focusRing + ' ' +
                        (on
                          ? 'border-teal-700 bg-teal-700 text-white dark:border-teal-500 dark:bg-teal-600'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300')
                      }
                    >
                      {o === 'all' ? 'All' : outcomeLabel(o)}
                      <span className={`tabular-nums ${on ? 'text-teal-100' : 'text-slate-400'}`}>{countFor(o)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="max-h-[70vh] overflow-auto">
              {loading ? (
                <p className="px-5 py-12 text-center text-sm text-slate-500">Loading done calls…</p>
              ) : filteredCalls.length === 0 ? (
                <p className="px-5 py-12 text-center text-sm text-slate-500">
                  {calls.length === 0
                    ? 'No completed calls yet. Finish a call in the test console and it will show up here.'
                    : 'No calls match this outcome. Pick another filter above.'}
                </p>
              ) : (
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      <th scope="col" className="px-5 py-2.5">Caller</th>
                      <th scope="col" className="px-5 py-2.5">Outcome</th>
                      <th scope="col" className="px-5 py-2.5">Turns</th>
                      <th scope="col" className="hidden px-5 py-2.5 md:table-cell">Final state</th>
                      <th scope="col" className="px-5 py-2.5">Review</th>
                      <th scope="col" className="w-8 px-3 py-2.5"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {pageCalls.map((call) => (
                      <tr
                        key={call.call_id}
                        tabIndex={0}
                        onClick={() => openCall(call.call_id)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openCall(call.call_id))}
                        className="group cursor-pointer transition hover:bg-teal-50/60 focus-visible:bg-teal-50 focus-visible:outline-none dark:hover:bg-teal-950/40 dark:focus-visible:bg-teal-950/40"
                      >
                        <td className="px-5 py-3.5 font-mono font-medium">{call.caller_number || 'Unknown caller'}</td>
                        <td className="px-5 py-3.5"><OutcomePill outcome={call.outcome} /></td>
                        <td className="px-5 py-3.5 tabular-nums text-slate-600 dark:text-slate-300">{getTranscript(call).length}</td>
                        <td className="hidden px-5 py-3.5 font-mono text-xs text-slate-600 md:table-cell dark:text-slate-400">{call.final_state || '—'}</td>
                        <td className="px-5 py-3.5"><ReviewBadge value={reviewOf(call)} /></td>
                        <td className="px-3 py-3.5 text-slate-300 transition group-hover:text-teal-600 dark:text-slate-600">
                          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </td>
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
                      className={`h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${focusRing}`}
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
        </>
      ) : (
        <section className={`${card} overflow-hidden`}>
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-mono text-lg font-semibold">{selectedCall.caller_number || 'Unknown caller'}</h2>
              <OutcomePill outcome={selectedCall.outcome} />
              {selectedCall.final_state && (
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                  {selectedCall.final_state}
                </span>
              )}
            </div>
            <button type="button" onClick={() => setSelectedId('')} className={btn}>Back to list</button>
          </div>

          <div className="grid gap-5 p-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            {/* ── left rail: latency overview + review form ── */}
            <aside className="flex h-fit flex-col gap-5 xl:sticky xl:top-4">
              {/* latency by turn */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold">Latency by turn</h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Select a bar to jump</span>
                </div>

                <div className="mt-4 flex h-24 items-end gap-1" role="group" aria-label="Latency per turn">
                  {timings.map((t, i) => {
                    const h = maxLatency ? Math.max(6, (t.total / maxLatency) * 100) : 6;
                    const slow = i === callTotals.slowest && maxLatency > 0;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => scrollToTurn(i)}
                        title={`Turn ${transcript[i]?.turn || i + 1}: ${fmtMs(t.total || null)}`}
                        aria-label={`Turn ${transcript[i]?.turn || i + 1}, ${fmtMs(t.total || null)}`}
                        className={`group/bar flex h-full min-w-[6px] flex-1 items-end rounded-sm ${focusRing}`}
                      >
                        <span
                          className={
                            'w-full rounded-sm transition group-hover/bar:opacity-80 ' +
                            (slow ? 'bg-amber-500' : 'bg-teal-600 dark:bg-teal-500')
                          }
                          style={{ height: `${h}%` }}
                        />
                      </button>
                    );
                  })}
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Average</dt>
                    <dd className="font-mono tabular-nums">{fmtMs(callTotals.avg || null)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Slowest</dt>
                    <dd className="font-mono tabular-nums text-amber-700 dark:text-amber-400">{fmtMs(maxLatency || null)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Tokens</dt>
                    <dd className="font-mono tabular-nums">{callTotals.tokens ? callTotals.tokens.toLocaleString() : '—'}</dd>
                  </div>
                </dl>
              </div>

              {/* review form */}
              <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
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
                  <h3 className="text-sm font-semibold" id="rate-label">Rate this call</h3>
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
                            'flex flex-col items-start rounded-xl border px-3 py-2 text-left transition ' + focusRing + ' ' +
                            (on
                              ? good
                                ? 'border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                                : 'border-rose-500 bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200'
                              : 'border-slate-300 bg-white text-slate-700 hover:border-teal-600 hover:bg-teal-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-teal-950')
                          }
                        >
                          <span className="text-sm font-semibold">{option.label}</span>
                          <span className="text-[11px] opacity-75">{option.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="review-note" className="text-sm font-semibold">Review notes</label>
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
                  className={`h-10 rounded-lg bg-teal-700 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500 ${focusRing}`}
                >
                  {saving ? 'Saving…' : 'Save review'}
                </button>
              </div>
            </aside>

            {/* ── transcript ── */}
            <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-sm font-semibold">Full conversation</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    {transcript.length} {transcript.length === 1 ? 'turn' : 'turns'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  {showDiagnostics && <Legend />}
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={showDiagnostics}
                      onChange={(e) => setShowDiagnostics(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    Show pipeline details
                  </label>
                </div>
              </header>

              <div className="max-h-[78vh] overflow-y-auto px-4 py-5">
                {transcript.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-500">No transcript saved for this call.</p>
                ) : (
                  <ol className="flex flex-col gap-8">
                    {transcript.map((item, index) => (
                      <TurnCard
                        key={`${item.turn || index}-${index}`}
                        item={item}
                        index={index}
                        maxLatency={maxLatency}
                        showDiagnostics={showDiagnostics}
                      />
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