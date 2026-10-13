import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

const ERROR_SESSION = { session_id: '', assistant: '', state: 'ERROR', lane: 'SYSTEM', slots: {}, flags: {}, metrics: {}, tool_calls: [], history: [] };

// Everything about one simulated call: start/reset, turns, hang-up, caller list.
export function useSession() {
  const [sid, setSid] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [caller, setCaller] = useState('9540923207');
  const [known, setKnown] = useState([]);

  const refreshKnown = useCallback(() => api.customers().then(setKnown).catch(() => setKnown([])), []);

  const start = useCallback(async (reset = false) => {
    try {
      const body = { caller_number: caller, session_id: sid || undefined };
      const d = await (reset ? api.resetSession(body) : api.startSession(body));
      setSid(d.session_id); setData(d); setError('');
      refreshKnown();
    } catch (err) {
      setError(err.message);
      setData((cur) => cur || ERROR_SESSION);
    }
  }, [caller, sid, refreshKnown]);

  useEffect(() => { start(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const send = useCallback(async (text, silence = false) => {
    if (busy || !sid) return false;
    setBusy(true);
    try {
      setData(await api.turn({ session_id: sid, text, silence }));
      setError('');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, sid]);

  const endCall = useCallback(async () => {
    try { setData(await api.endSession(sid)); refreshKnown(); } catch (err) { setError(err.message); }
  }, [sid, refreshKnown]);

  return { sid, data, busy, error, caller, setCaller, known, start, send, endCall };
}
