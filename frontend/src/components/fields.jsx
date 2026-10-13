import { useEffect, useRef, useState } from 'react';

export function Field({ label, hint, children, wide }) {
  return (
    <label className={'field' + (wide ? ' wide' : '')}>
      <span className="fieldLabel">{label}{hint && <em>{hint}</em>}</span>
      {children}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// pick several items from a known list; shows unknown (dangling) values in red so they can be removed
export function TagPicker({ value = [], options, onChange, placeholder = 'add…' }) {
  const unknown = value.filter((v) => !options.includes(v));
  const available = options.filter((o) => !value.includes(o));
  return (
    <div className="tags">
      {value.map((v) => (
        <span key={v} className={'tag' + (unknown.includes(v) ? ' bad' : '')}>
          {v}<button type="button" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`remove ${v}`}>×</button>
        </span>
      ))}
      <select value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
        <option value="">{placeholder}</option>
        {available.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// JSON textarea that keeps what you type and only applies it once it parses (on blur)
export function JsonField({ value, onChange, rows = 8 }) {
  const serialized = JSON.stringify(value ?? null, null, 2);
  const [text, setText] = useState(serialized);
  const [err, setErr] = useState('');
  const focused = useRef(false);

  useEffect(() => { if (!focused.current) { setText(serialized); setErr(''); } }, [serialized]);

  const apply = () => {
    focused.current = false;
    try { const parsed = JSON.parse(text); setErr(''); if (JSON.stringify(parsed) !== JSON.stringify(value)) onChange(parsed); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="jsonField">
      <textarea
        className={'mono' + (err ? ' invalid' : '')} rows={rows} spellCheck={false} value={text}
        onFocus={() => { focused.current = true; }} onBlur={apply} onChange={(e) => setText(e.target.value)}
      />
      {err && <div className="fieldError">Invalid JSON — not applied: {err}</div>}
    </div>
  );
}

export function Section({ title, action, children }) {
  return (
    <section className="formSection">
      <div className="formSectionHead"><b>{title}</b>{action}</div>
      {children}
    </section>
  );
}
