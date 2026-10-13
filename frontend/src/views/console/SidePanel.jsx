import React from 'react';
import { Metric } from './parts';

export default function SidePanel({ ms, activeLane, activeState, currentSide, retry, terminal, flowPath, laneGroups, visitedStates }) {
  return (
    <aside className="side">
      <section className="panel metrics">
        <div className="panelTitle"><div><b>Latency</b><small>instrumented per turn</small></div></div>
        <div className="metricGrid">
          <Metric label="Last turn" value={ms.last_turn_ms} />
          <Metric label="Total" value={ms.total_ms} />
          <Metric label="LLM 1 · classify" value={ms.classify_ms} />
          <Metric label="LLM 2 · capture" value={ms.capture_ms} />
          <Metric label="FSM" value={ms.fsm_ms} />
          <Metric label="Tools" value={ms.tool_ms} />
          <Metric label="Turns" value={ms.turns} unit="" digits={0} />
        </div>
      </section>

      <section className="panel lane">
        <div className="panelTitle"><div><b>Lane / state</b><small>current execution position</small></div></div>
        <div className="heroState">
          <span>{activeLane || '—'}</span>
          <strong>{activeState || '—'}</strong>
          <small className={'graphBadge ' + currentSide}>graph side: {currentSide}</small>
        </div>
        {retry.max >= 0 && !terminal && (
          <div className="retryMeter" title="Retries used in this state">
            {Array.from({ length: Math.max(retry.max, 1) }, (_, i) => <i key={i} className={i < retry.used ? 'used' : ''} />)}
            <span>{retry.used}/{retry.max} retries</span>
          </div>
        )}
        <div className="flowRail" aria-label="Conversation flow path">
          {flowPath.map((item, index) => (
            <React.Fragment key={`${item.state}-${index}`}>
              {index > 0 && <span className="flowArrow">›</span>}
              <div className={'flowNode ' + item.side + (item.silent ? ' silent' : '')} title={item.silent ? 'silent state' : ''}><small>{item.state}</small></div>
            </React.Fragment>
          ))}
        </div>
        <div className="laneList">
          {laneGroups.map(({ id, label, states }) => (
            <div key={id} className={'laneGroup' + (id === activeLane ? ' current' : '')}>
              <div className="laneName">{label}</div>
              {states.map((key) => (
                <div key={key} className={'stateRow ' + (key === activeState ? 'current' : '')}>
                  <span>{key === activeState ? '●' : visitedStates.has(key) ? '○' : ''}</span>{key}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
