export function QuestionPanel({ question }) {
  return (
    <section className="panel question-panel">
      <h2 className="panel-title">Detected question</h2>
      <div className="panel-body">
        {question ? (
          <p className="question-text">{question.text}</p>
        ) : (
          <p className="placeholder">Waiting for the interviewer to ask a question…</p>
        )}
      </div>
    </section>
  );
}
