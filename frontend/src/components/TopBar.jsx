import { navigate } from '../hooks/useRoute';

const TABS = [
  ['/test', 'Test console'],
  ['/calls', 'Done calls'],
  ['/builder', 'Flow builder'],

];

/**
 * Shared page header.
 * Three fixed zones so the tab switcher never moves between screens:
 *   [ title ]  [ tabs (always centred) ]  [ actions (children) ]
 */
export default function TopBar({ path = '', eyebrow, title, children }) {
  return (
    <header className="grid items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0">
        {eyebrow && <p className="truncate text-xs font-medium tracking-wide text-teal-700 dark:text-teal-300">{eyebrow}</p>}
        <h1 className="truncate text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
      </div>

      <nav aria-label="Sections" className="flex justify-self-start rounded-lg bg-slate-100 p-1 lg:justify-self-center dark:bg-slate-800">
        {TABS.map(([to, label]) => {
          const active = path.startsWith(to);
          return (
            <button
              key={to}
              type="button"
              onClick={() => navigate(to)}
              aria-current={active ? 'page' : undefined}
              className={
                'h-8 whitespace-nowrap rounded-md !border-0 px-3.5 text-sm font-medium !shadow-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ' +
                (active
                  ? '!bg-teal-700 !text-white hover:!bg-teal-700 dark:!bg-teal-600 dark:hover:!bg-teal-600'
                  : '!bg-transparent !text-slate-600 hover:!bg-white hover:!text-slate-900 dark:!text-slate-400 dark:hover:!bg-slate-700 dark:hover:!text-slate-100')
              }
            >
              {label}
            </button>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2 lg:justify-self-end lg:justify-end">{children}</div>
    </header>
  );
}