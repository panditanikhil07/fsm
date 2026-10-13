import { useActiveScript } from './hooks/useActiveScript';
import { useRoute } from './hooks/useRoute';
import FlowBuilder from './views/builder/FlowBuilder';
import TestConsole from './views/console/TestConsole';
import ScriptLibrary from './views/scripts/ScriptLibrary';

export default function App() {
  const { path, query } = useRoute();
  const { script, reload } = useActiveScript();

  if (path.startsWith('/scripts')) return <ScriptLibrary path={path} script={script} reloadActive={reload} />;
  if (path.startsWith('/builder')) {
    const raw = path.split('/')[2];
    const name = raw ? decodeURIComponent(raw) : '';
    // key forces a clean builder state when switching between scripts / templates
    return <FlowBuilder key={`${name}|${query.tpl || ''}`} path={path} name={name} query={query} reloadActive={reload} />;
  }
  return <TestConsole path={path} script={script} />;
}
