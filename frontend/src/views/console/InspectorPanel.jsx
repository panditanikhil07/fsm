import { isSet, show } from '../../lib/format';

const card = 'rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';

function Stat({ label, value, sub, accent }) {
  return (
    <div className={`${card} min-w-0 px-4 py-3 ${accent ? 'border-teal-600/40 bg-teal-50 dark:border-teal-400/30 dark:bg-teal-950/40' : ''}`}>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="truncate text-base font-semibold" title={String(value)}>{value}</div>
      <div className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{sub}</div>
    </div>
  );
}

function JsonCard({ title, value }) {
  return (
    <article className={`${card} overflow-hidden`}>
      <header className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold dark:border-slate-800">{title}</header>
      <pre className="max-h-64 overflow-auto bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700 dark:bg-slate-950/50 dark:text-slate-300">
        {JSON.stringify(value, null, 2)}
      </pre>
    </article>
  );
}

export default function InspectorPanel({ data, activeLane, activeState, slots, slotKeys, slotDescriptions, filled }) {
  const llm = data?.llm || {};
  const classifier = llm.classifier || {};
  const capture = llm.capture || {};
  const pct = slotKeys.length ? Math.round((filled / slotKeys.length) * 100) : 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat accent label="Current" value={activeLane || '—'} sub={activeState || '—'} />
        <Stat label="Classifier" value={classifier.source || 'not run'} sub={`${Number(classifier.ms || 0).toFixed(1)} ms`} />
        <Stat label="LLM" value={capture.source || 'not run'} sub={`${Number(capture.ms || 0).toFixed(1)} ms`} />
        <Stat label="Slots" value={`${filled}/${slotKeys.length || 0}`} sub="filled" />
      </div>

      <JsonCard
        title="Classifier output"
        value={
          classifier && Object.keys(classifier).length
            ? {
                source: classifier.source,
                intents: classifier.intents,
                update_targets: classifier.update_targets,
                recall_targets: classifier.recall_targets,
                yes_no: classifier.yes_no,
                language: classifier.language,
                reason: classifier.reason,
                error: classifier.error,
              }
            : { status: 'no classifier output yet' }
        }
      />

      <JsonCard
        title="LLM output"
        value={
          capture && Object.keys(capture).length
            ? {
                source: capture.source,
                lead: capture.lead,
                slots: capture.slots,
                rejected: capture.rejected,
                error: capture.error,
              }
            : { status: 'no llm output yet' }
        }
      />

      <article className={`${card} overflow-hidden`}>
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <span className="text-sm font-semibold">Slots filled</span>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-teal-600 transition-all dark:bg-teal-400" style={{ width: `${pct}%` }} />
            </div>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{pct}%</span>
          </div>
        </header>

        <div className="grid max-h-[26rem] gap-2.5 overflow-y-auto overscroll-contain p-3 sm:grid-cols-2">
          {slotKeys.length === 0 ? (
            <p className="col-span-full rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              No slots configured.
            </p>
          ) : (
            slotKeys.map((key) => {
              const set = isSet(slots[key]);
              return (
                <div
                  key={key}
                  className={
                    'flex min-h-20 min-w-0 flex-col gap-0.5 rounded-lg border border-l-4 px-3 py-2 ' +
                    (set
                      ? 'border-emerald-200 border-l-emerald-500 bg-emerald-50 dark:border-emerald-900 dark:border-l-emerald-500 dark:bg-emerald-950/40'
                      : 'border-slate-200 border-l-slate-300 bg-white dark:border-slate-800 dark:border-l-slate-700 dark:bg-slate-900')
                  }
                >
                  <code className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{key}</code>
                  <strong className={'break-words text-sm ' + (set ? '' : 'font-normal text-slate-400 dark:text-slate-600')}>{show(slots[key])}</strong>
                  <small className="mt-auto text-xs leading-snug text-slate-500 dark:text-slate-400">{slotDescriptions[key] || '—'}</small>
                </div>
              );
            })
          )}
        </div>
      </article>
    </section>
  );
}