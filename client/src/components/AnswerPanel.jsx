export function AnswerPanel({ answer }) {
  return (
    <section className="panel answer-panel">
      <h2 className="panel-title">Suggested answer</h2>
      <div className="panel-body">
        {answer ? (
          <div className="answer-text">{answer}</div>
        ) : (
          <p className="placeholder">A short, speakable answer will stream in here.</p>
        )}
      </div>
    </section>
  );
}
