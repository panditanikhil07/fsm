import { useCallback, useRef, useState } from 'react';
import { clone } from '../lib/format';

// Editable copy of a script with undo/redo. `update(fn, key)` mutates a clone; consecutive edits
// sharing the same `key` within 900 ms collapse into one undo step (so typing isn't 40 steps).
export function useDraft(initial) {
  const ref = useRef({ past: [], present: initial, future: [], saved: initial, key: null, t: 0 });
  const [, tick] = useState(0);
  const commit = (s) => { ref.current = s; tick((n) => n + 1); };

  const update = useCallback((fn, key) => {
    const s = ref.current;
    const next = clone(s.present);
    fn(next);
    const now = Date.now();
    const merge = key && s.key === key && now - s.t < 900;
    commit({ ...s, present: next, past: merge ? s.past : [...s.past.slice(-59), s.present], future: [], key: key || null, t: now });
  }, []);

  const undo = useCallback(() => {
    const s = ref.current;
    if (!s.past.length) return;
    commit({ ...s, past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], key: null });
  }, []);

  const redo = useCallback(() => {
    const s = ref.current;
    if (!s.future.length) return;
    commit({ ...s, past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), key: null });
  }, []);

  const load = useCallback((script) => commit({ past: [], present: script, future: [], saved: script, key: null, t: 0 }), []);
  const markSaved = useCallback(() => commit({ ...ref.current, saved: ref.current.present }), []);

  const s = ref.current;
  return {
    script: s.present, update, undo, redo, load, markSaved,
    canUndo: s.past.length > 0, canRedo: s.future.length > 0, dirty: s.present !== s.saved,
  };
}
