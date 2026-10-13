import { useActiveScript } from './hooks/useActiveScript';
import { useRoute } from './hooks/useRoute';
import FlowBuilder from './views/builder/FlowBuilder';
import CallReviewPage from './views/calls/CallReviewPage';
import TestConsole from './views/console/TestConsole';
import ScriptLibrary from './views/scripts/ScriptLibrary';

const isRoute = (path, base) => path === base || path.startsWith(`${base}/`);

export default function App() {
  const { path, query } = useRoute();
  const { script, reload } = useActiveScript();

  let view;
  if (isRoute(path, '/calls')) {
    view = <CallReviewPage path={path} />;
  } else if (isRoute(path, '/scripts')) {
    view = <ScriptLibrary path={path} script={script} reloadActive={reload} />;
  } else if (isRoute(path, '/builder')) {
    const raw = path.split('/')[2];
    const name = raw ? decodeURIComponent(raw) : '';
    view = (
      <FlowBuilder
        key={`${name}|${query.tpl || ''}`}
        path={path}
        name={name}
        query={query}
        reloadActive={reload}
      />
    );
  } else {
    view = <TestConsole path={path} script={script} />;
  }

  return (
    <div className="flex h-screen h-dvh w-full flex-col overflow-hidden bg-white text-slate-900">
      <main className="min-h-0 min-w-0 flex-1 overflow-auto">{view}</main>
    </div>
  );
}