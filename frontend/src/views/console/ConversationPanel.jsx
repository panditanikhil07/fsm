import { useEffect, useRef, useState } from 'react';

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
    <section className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-semibold">Conversation</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">One simulated customer turn at a time</p>
        </div>
        <span className="rounded-md bg-teal-50 px-2.5 py-1 font-mono text-xs text-teal-800 dark:bg-teal-950 dark:text-teal-200">
          {activeLane} <span className="opacity-50">/</span> {activeState}
        </span>
      </header>

      {/* summary */}
      {summary.length > 0 && (
        <dl className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950/40">
          {summary.slice(0, 3).map(([label, value]) => (
            <div key={label} className="min-w-0 px-4 py-2.5">
              <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="truncate font-mono text-sm font-medium" title={String(value)}>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* messages */}
      <div ref={messagesRef} className="flex h-[26rem] flex-col gap-4 overflow-y-auto px-4 py-4 lg:h-[32rem]">
        {hist.length === 0 && (
          <div className="max-w-[85%] self-start">
            <div className="mb-1 text-xs font-semibold text-teal-700 dark:text-teal-300">{botName}</div>
            <p className="rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2.5 text-sm leading-relaxed dark:bg-slate-800">
              {prompt || (terminal ? 'Call ended.' : 'No active assistant response yet.')}
            </p>
          </div>
        )}

        {hist.length === 0 ? (
          <p className="m-auto rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No turns yet. Reply to the greeting above.
          </p>
        ) : (
          hist.map((h, i) => (
            <div key={`${h.turn}-${i}`} className="flex flex-col gap-3">
              <div className="max-w-[85%] self-end">
                <div className="mb-1 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">You</div>
                <p className="rounded-2xl rounded-tr-sm bg-teal-700 px-4 py-2.5 text-sm leading-relaxed text-white dark:bg-teal-600">{h.user}</p>
              </div>

              <div className="max-w-[85%] self-start">
                <div className="mb-1 text-xs font-semibold text-teal-700 dark:text-teal-300">
                  {botName} <span className="font-normal text-slate-400">· {h.lane}</span>
                </div>
                <p className="rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2.5 text-sm leading-relaxed dark:bg-slate-800">
                  {h.assistant || <em className="text-slate-500">Call ended, no speech</em>}
                </p>
                <p className="mt-1.5 font-mono text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {h.path?.length ? h.path.join(' → ') : `${h.from_state} → ${h.to_state}`} · {h.latency_ms} ms
                  {h.intents?.length ? ` · intents: ${h.intents.join(', ')}` : ''}
                </p>
              </div>
            </div>
          ))
        )}

        {busy && (
          <div className="self-start rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3 dark:bg-slate-800" aria-label={`${botName} is replying`}>
            <span className="flex gap-1">
              {[0, 150, 300].map((d) => (
                <span key={d} style={{ animationDelay: `${d}ms` }} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 motion-reduce:animate-none" />
              ))}
            </span>
          </div>
        )}
      </div>

      {/* composer */}
      <div className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
        <input
          ref={inputRef}
          autoFocus
          value={text}
          disabled={terminal}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={terminal ? 'Call ended. Start a new call' : 'Type simulated customer speech…'}
          className="h-10 min-w-0 flex-1 rounded-lg !border !border-slate-300 !bg-white px-3 text-sm !text-slate-900 !outline-none placeholder:!text-slate-400 focus:!border-teal-600 focus:ring-4 focus:ring-teal-600/15 disabled:!bg-slate-100 disabled:!text-slate-400 dark:!border-slate-700 dark:!bg-slate-950 dark:!text-slate-100 dark:disabled:!bg-slate-900"
        />
        <button
          disabled={busy || terminal || !text.trim()}
          onClick={() => submit()}
          className="h-10 rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-600 dark:hover:bg-teal-500"
        >
          {busy ? 'Running…' : 'Send'}
        </button>
        <button
          disabled={busy || terminal}
          onClick={() => submit(true)}
          title="Caller says nothing"
          className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium transition hover:border-teal-600 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-teal-950"
        >
          Silence
        </button>
      </div>
    </section>
  );
}