import { navigate } from '../hooks/useRoute';

const TABS = [
  ['/test', 'Test console'],
  // ['/scripts', 'Scripts'],
  // ['/builder', 'Flow builder'],
];

export default function TopBar({ path, eyebrow, title, children }) {
  return (
    <header className="top">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
      </div>
      <nav className="nav" aria-label="Sections">
        {TABS.map(([to, label]) => (
          <button key={to} className={path.startsWith(to) ? 'active' : ''} onClick={() => navigate(to)}>{label}</button>
        ))}
      </nav>
      <div className="topActions">{children}</div>
    </header>
  );
}
