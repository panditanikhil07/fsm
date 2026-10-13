import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider,
  applyNodeChanges, useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import StateNode, { LaneNode } from './StateNode';
import { buildGraph } from '../../lib/graph';
import { connect, newStateDef, removeEdge, retargetEdge, uniqueName, deleteState } from '../../lib/script';

const nodeTypes = { state: StateNode, lane: LaneNode };

function Inner({ script, layout, setLayout, issues, selected, selectedEdge, onSelect, onSelectEdge, update }) {
  const rf = useReactFlow();
  const graph = useMemo(() => buildGraph(script, layout, issues, selectedEdge), [script, layout, issues, selectedEdge]);
  const [nodes, setNodes] = useState(graph.nodes);
  const nodeCount = script.states ? Object.keys(script.states).length : 0;

  // the script is the source of truth; local node state only exists so dragging feels instant
  useEffect(() => { setNodes(graph.nodes.map((n) => ({ ...n, selected: n.id === selected }))); }, [graph, selected]);

  const onNodesChange = useCallback((changes) => {
    setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== 'select' && c.type !== 'remove'), ns));
  }, []);

  const addState = useCallback((position, lane, from) => {
    const name = uniqueName(script.states, 'NEW_STATE');
    update((d) => {
      d.states[name] = newStateDef(d, { lane: lane || d.lanes[0]?.id });
      if (from) connect(d, from, name);
    });
    setLayout((l) => ({ ...l, [name]: position }));
    onSelect(name);
  }, [script.states, update, setLayout, onSelect]);

  // expose "add state" to the toolbar through a DOM event (keeps toolbar outside the provider simple)
  useEffect(() => {
    const on = (e) => {
      const el = document.querySelector('.canvasWrap');
      const r = el?.getBoundingClientRect();
      const pos = rf.screenToFlowPosition({ x: (r?.left || 0) + (r?.width || 600) / 2, y: (r?.top || 0) + (r?.height || 400) / 2 });
      addState({ x: pos.x - 110, y: pos.y - 40 }, e.detail?.lane);
    };
    const fit = () => rf.fitView({ padding: 0.15, duration: 300 });
    window.addEventListener('builder:add-state', on);
    window.addEventListener('builder:fit', fit);
    return () => { window.removeEventListener('builder:add-state', on); window.removeEventListener('builder:fit', fit); };
  }, [rf, addState]);

  const onConnect = useCallback((c) => {
    if (c.source === c.target) return;
    update((d) => { connect(d, c.source, c.target); });
  }, [update]);

  // dropping a connection on empty canvas creates a new connected state right there
  const onConnectEnd = useCallback((event, cs) => {
    if (cs.isValid || !cs.fromNode) return;
    const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
    const pos = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
    addState({ x: pos.x, y: pos.y - 40 }, script.states[cs.fromNode.id]?.lane, cs.fromNode.id);
  }, [rf, addState, script.states]);

  const onReconnect = useCallback((oldEdge, c) => {
    update((d) => retargetEdge(d, oldEdge.source, oldEdge.data, c.target));
  }, [update]);

  return (
    <ReactFlow
      colorMode="dark" nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_, n) => setLayout((l) => ({ ...l, [n.id]: n.position }))}
      onNodeClick={(_, n) => onSelect(n.id)}
      onEdgeClick={(_, e) => onSelectEdge(e)}
      onPaneClick={() => onSelect(null)}
      onConnect={onConnect} onConnectEnd={onConnectEnd} onReconnect={onReconnect}
      onEdgesDelete={(es) => update((d) => [...es].sort((a, b) => (b.data.index ?? 0) - (a.data.index ?? 0)).forEach((e) => removeEdge(d, e.source, e.data)))}
      onNodesDelete={(ns) => ns.filter((n) => n.type === 'state').forEach((n) => { update((d) => deleteState(d, n.id)); onSelect(null); })}
      deleteKeyCode={['Backspace', 'Delete']}
      defaultViewport={{ x: 24, y: 16, zoom: nodeCount > 12 ? 0.62 : 0.9 }} minZoom={0.15} maxZoom={1.6}
      proOptions={{ hideAttribution: true }} nodesConnectable edgesReconnectable
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={2} nodeColor={(n) => (n.type === 'lane' ? 'transparent' : n.data.st?.terminal ? '#e53e3e' : '#3b6ef5')} />
    </ReactFlow>
  );
}

export default function Canvas(props) {
  return (
    <div className="canvasWrap">
      <ReactFlowProvider><Inner {...props} /></ReactFlowProvider>
    </div>
  );
}
