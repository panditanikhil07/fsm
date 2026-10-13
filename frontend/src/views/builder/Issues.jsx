export default function Issues({ issues, onJump }) {
  if (!issues.length) return <div className="notice ok">✔ No problems found.</div>;
  const order = { error: 0, warn: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <ul className="issueList">
      {sorted.map((i, k) => (
        <li key={k} className={i.level}>
          <span className="badge">{i.level}</span>
          {i.state && <button className="linkBtn" onClick={() => onJump(i.state)}>{i.state}</button>}
          {i.slot && <code>{i.slot}</code>}
          <span>{i.msg}</span>
        </li>
      ))}
    </ul>
  );
}
