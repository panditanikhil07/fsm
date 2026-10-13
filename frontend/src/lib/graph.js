// states.json  <->  canvas nodes/edges
import { entryState } from './script';
import { truncate } from './format';

export const COL_W = 330;
export const ROW_H = 200;
const TOP = 80;

export function autoLayout(script) {
  const laneIds = (script.lanes || []).map((l) => l.id);
  const rows = {};
  const pos = {};
  for (const [name, st] of Object.entries(script.states || {})) {
    let col = laneIds.indexOf(st.lane);
    if (col < 0) col = laneIds.length;
    rows[col] = (rows[col] ?? -1) + 1;
    pos[name] = { x: col * COL_W, y: TOP + rows[col] * ROW_H };
  }
  return pos;
}

export function buildGraph(script, layout, issues, selectedEdge) {
  const states = script.states || {};
  const pos = { ...autoLayout(script), ...layout };
  const entry = entryState(script);
  const byState = {};
  for (const i of issues) if (i.state) (byState[i.state] ||= []).push(i);

  const nodes = (script.lanes || []).map((l, i) => ({
    id: `lane:${l.id}`, type: 'lane', position: { x: i * COL_W, y: 0 },
    data: { label: l.label || l.id, demand: !!l.on_demand },
    draggable: false, selectable: false, focusable: false, zIndex: -1,
  }));

  const edges = [];
  const COLOR = { transition: '#8aa0ff', next: '#6f7d96', exhausted: '#ee7a82' };
  const addEdge = (id, source, target, label, kind, data) => {
    if (source === target || !states[target]) return;
    edges.push({
      id, source, target, label: truncate(label, 34), type: 'default',
      markerEnd: { type: 'arrowclosed', width: 16, height: 16, color: COLOR[kind] },
      style: { stroke: COLOR[kind] },
      labelStyle: { fill: '#cfd8ea', fontSize: 10 }, labelBgStyle: { fill: '#0d121c', fillOpacity: 0.95 },
      labelBgPadding: [5, 3], labelBgBorderRadius: 5,
      className: `e-${kind}${selectedEdge === id ? ' selected' : ''}`,
      data: { kind, ...data }, interactionWidth: 20,
    });
  };

  for (const [name, st] of Object.entries(states)) {
    const selfLoops = (st.transitions || []).filter((t) => t.goto === name).length + (st.next === name ? 1 : 0);
    nodes.push({
      id: name, type: 'state', position: pos[name],
      data: { name, st, entry: name === entry, selfLoops, issues: byState[name] || [] },
    });
    (st.transitions || []).forEach((t, i) => addEdge(`t:${name}:${i}`, name, t.goto, t.condition || '(no condition)', 'transition', { index: i }));
    if (st.next) addEdge(`n:${name}`, name, st.next, 'next', 'next', {});
    if (st.on_exhausted && states[st.on_exhausted]) addEdge(`x:${name}`, name, st.on_exhausted, 'retries exhausted', 'exhausted', {});
  }
  return { nodes, edges };
}
