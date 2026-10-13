import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

const EMPTY = { states: {}, lanes: [], slot_descriptions: {}, meta: {} };

// The script the engine is currently running (GET /states).
export function useActiveScript() {
  const [script, setScript] = useState(EMPTY);
  const reload = useCallback(() => api.states().then(setScript).catch(() => {}), []);
  useEffect(() => { reload(); }, [reload]);
  return { script, reload };
}
