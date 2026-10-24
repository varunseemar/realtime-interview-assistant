import { Status } from '../protocol.js';
import { LatencyStats } from './LatencyStats.jsx';
import { LevelMeter } from './LevelMeter.jsx';

const STATUS_LABELS = {
  [Status.IDLE]: 'Idle',
  [Status.LISTENING]: 'Listening',
  [Status.THINKING]: 'Thinking',
  [Status.ANSWERING]: 'Answering',
  [Status.ERROR]: 'Error',
};

export function StatusBar({
  status,
  running,
  source,
  onSourceChange,
  onStart,
  onStop,
  contextReady,
  onToggleContext,
  metrics,
  level,
}) {
  return (
    <header className="status-bar">
      <h1 className="app-title">Interview Assistant</h1>

      <span className={`status-pill status-${status}`} role="status" aria-live="polite">
        <span className="status-dot" />
        {STATUS_LABELS[status] ?? status}
      </span>

      <LevelMeter level={level} active={running} />

      <label className="source-select">
        Audio
        <select value={source} onChange={(e) => onSourceChange(e.target.value)} disabled={running}>
          <option value="tab">Browser tab (interviewer)</option>
          <option value="mic">Microphone</option>
        </select>
      </label>

      <button type="button" className="btn btn-ghost" onClick={onToggleContext}>
        Context {contextReady ? '✓' : '(empty)'}
      </button>

      <LatencyStats metrics={metrics} />

      <div className="controls">
        {running ? (
          <button type="button" className="btn btn-stop" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn-start" onClick={onStart}>
            Start
          </button>
        )}
      </div>
    </header>
  );
}
