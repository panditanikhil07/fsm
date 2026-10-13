import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { truncate } from '../../lib/format';

const TYPE_ICON = { customer_facing: '💬', router: '⤳', gate: '⛩' };

function StateNode({ data, selected }) {
  const { name, st, entry, selfLoops, issues } = data;
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  const line = st.reply_template ? Object.values(st.reply_template).find(Boolean) : '';
  const silent = st.type !== 'customer_facing';

  return (
    <div className={'fnode' + (selected ? ' selected' : '') + (silent ? ' silent' : '') + (st.terminal ? ' terminal' : '') + (st.on_demand ? ' demand' : '') + (errors ? ' hasError' : '')}>
      <Handle type="target" position={Position.Left} />
      <div className="fnodeHead">
        <span className="fnodeIcon" title={st.type}>{TYPE_ICON[st.type] || '•'}</span>
        <b title={name}>{name}</b>
        {entry && <span className="badge ok">START</span>}
        {st.terminal && <span className="badge bad">END</span>}
        {st.on_demand && <span className="badge info">ON DEMAND</span>}
      </div>
      <p className="fnodeText">{truncate(line || st.prompt, 92) || <em>no reply text yet</em>}</p>
      <div className="fnodeFoot">
        {(st.required_slots || []).slice(0, 3).map((s) => <span className="miniTag" key={s}>{s}</span>)}
        {(st.required_slots || []).length > 3 && <span className="miniTag">+{st.required_slots.length - 3}</span>}
        {(st.tools || []).length > 0 && <span className="miniTag tool">⚙ {st.tools.length}</span>}
        {selfLoops > 0 && <span className="miniTag" title="loops back to itself">↻</span>}
        {errors > 0 && <span className="miniTag err" title="errors">{errors} ✕</span>}
        {warns > 0 && <span className="miniTag warn" title="warnings">{warns} !</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const LaneNode = memo(({ data }) => (
  <div className={'laneHead' + (data.demand ? ' demand' : '')}>{data.label}</div>
));

export default memo(StateNode);
