const TARGET_MS = 3000; // brief: < 3s from end of question to first answer token

const seconds = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)}s`);

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
      title="End of question → first answer token. Detection = speech-to-text endpointing + question check. LLM = model time to first token."
    >
      <span className={`latency-main latency-${tone}`}>{seconds(last.e2eMs)}</span> to first token
      <span className="latency-detail">
        detect {seconds(last.detectionMs)} · LLM {seconds(last.ttftMs)} · avg {seconds(average)} ({metrics.length})
      </span>
    </span>
  );
}
