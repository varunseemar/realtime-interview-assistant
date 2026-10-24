const TARGET_MS = 3000; // brief: < 3s from end of question to first answer token

const seconds = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)}s`);

// Which detection rule fired; explains a slow "decide" number at a glance.
const PATH_LABELS = {
  pause: 'pause',
  utterance_end: 'long gap',
  classifier: 'classifier',
  'wait+classifier': 'trailing word + classifier',
  follow_on: 'follow-on',
  manual: 'manual',
  typed: 'typed',
};

export function LatencyStats({ metrics }) {
  if (metrics.length === 0) {
    return <span className="latency latency-empty">Latency: waiting for first answer</span>;
  }

  const last = metrics.at(-1);
  const e2eValues = metrics.map((m) => m.e2eMs).filter((v) => v != null);
  const average = e2eValues.reduce((sum, v) => sum + v, 0) / e2eValues.length;
  const tone = last.e2eMs <= TARGET_MS ? 'good' : 'slow';

  return (
    <span
      className="latency"
      title="End of question → first answer token. STT = speech-to-text finalising the words. Decide = question detection (in brackets: which rule fired). LLM = model time to first token."
    >
      <span className={`latency-main latency-${tone}`}>{seconds(last.e2eMs)}</span> to first token
      <span className="latency-detail">
        STT {seconds(last.sttMs)} · decide {seconds(last.decisionMs)} ({PATH_LABELS[last.path] ?? last.path}) · LLM{' '}
        {seconds(last.ttftMs)} · avg {seconds(average)} ({metrics.length})
      </span>
    </span>
  );
}
