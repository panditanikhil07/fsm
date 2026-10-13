import { useEffect, useState } from 'react';
import { api } from '../../api/client';

const REVIEW_OPTIONS = [
  { value: 'right', label: 'Pass' },
  { value: 'wrong', label: 'Needs work' },
];

export default function SidePanel({ activeLane, activeState, slots, slotKeys, filled, onlyCompleted = false }) {
  const [calls, setCalls] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [rating, setRating] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listCalls(20)
      .then((items) => {
        const list = items || [];
        setCalls(list);
        if (list.length && !selectedId) setSelectedId(list[0].call_id);
      })
      .catch(() => setCalls([]));
  }, []);

  const visibleCalls = calls.filter((call) => !onlyCompleted || ['completed', 'transferred', 'callback_requested'].includes(call.outcome));
  const selectedCall = visibleCalls.find((call) => call.call_id === selectedId) || visibleCalls[0] || null;

  useEffect(() => {
    if (!selectedCall) {
      setRating('');
      setNote('');
      return;
    }
    setRating(selectedCall.review?.result || selectedCall.rating || '');
    setNote(selectedCall.review?.note || '');
  }, [selectedCall]);

  const handleSaveReview = async () => {
    if (!selectedCall) return;
    setSaving(true);
    try {
      const updated = await api.reviewCall(selectedCall.call_id, {
        result: rating || undefined,
        note: note.trim(),
      });
      setCalls((current) => current.map((call) => (call.call_id === updated.call_id ? updated : call)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="side">
      <section className="panel lane minimalLanePanel">
        <div className="panelTitle"><div><b>Current lane / state</b><small>live execution position</small></div></div>
        <div className="heroState compactHero">
          <span>{activeLane || '—'}</span>
          <strong>{activeState || '—'}</strong>
        </div>
        <div className="miniStatus">
          <div className="miniStat">
            <label>Slots filled</label>
            <strong>{filled}/{slotKeys.length || 0}</strong>
          </div>
          <div className="miniStat">
            <label>Captured</label>
            <strong>{Object.keys(slots || {}).length}</strong>
          </div>
        </div>
      </section>

      <section className="panel historyPanel">
        <div className="panelTitle"><div><b>Call history</b><small>recent session history</small></div></div>

        <div className="historyList">
          {visibleCalls.length === 0 ? (
            <div className="empty">{onlyCompleted ? 'No done calls yet.' : 'No saved calls yet.'}</div>
          ) : (
            visibleCalls.map((call) => (
              <button
                key={call.call_id}
                type="button"
                className={'historyItem' + (selectedCall?.call_id === call.call_id ? ' active' : '')}
                onClick={() => setSelectedId(call.call_id)}
              >
                <div className="historyRow">
                  <strong>{call.caller_number || 'Unknown caller'}</strong>
                  <span className={'outcomeTag ' + (call.outcome || 'incomplete')}>{call.outcome || 'incomplete'}</span>
                </div>
                <small>{new Date(call.ended_at || call.started_at || Date.now()).toLocaleString()}</small>
                <em>{call.final_state || '—'} · {call.review?.result || call.rating || 'unrated'}</em>
              </button>
            ))
          )}
        </div>

        {selectedCall && (
          <div className="reviewBox">
            <div className="reviewMeta">
              <strong>{selectedCall.caller_number}</strong>
              <span>{selectedCall.outcome || 'incomplete'}</span>
            </div>
            <div className="ratingChoices">
              {REVIEW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={'ratingButton' + (rating === option.value ? ' selected' : '')}
                  onClick={() => setRating(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a review note for this call..."
              rows={4}
            />
            <button type="button" className="secondary saveReviewBtn" onClick={handleSaveReview} disabled={saving}>
              {saving ? 'Saving...' : 'Save review'}
            </button>
          </div>
        )}
      </section>
    </aside>
  );
}
