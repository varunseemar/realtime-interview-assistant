import { AnswerText } from './AnswerText.jsx';

function History({ items }) {
  if (items.length === 0) return null;
  return (
    <details className="history">
      <summary>Previous questions ({items.length})</summary>
      {items.map((item) => (
        <div key={item.id} className="history-item">
          <p className="history-question">{item.question}</p>
          <AnswerText text={item.answer} streaming={false} />
        </div>
      ))}
    </details>
  );
}

export function AnswerPanel({ question, answer, answerDone, history }) {
  const streaming = Boolean(question) && !answerDone;

  return (
    <section className="panel answer-panel">
      <h2 className="panel-title">Suggested answer</h2>
      <div className="panel-body">
        {question?.behavioral && answer && (
          <p className="behavioral-note">
            Behavioral template: swap the highlighted parts (and any specifics) for your real story.
          </p>
        )}
        {answer ? (
          <AnswerText text={answer} streaming={streaming} />
        ) : (
          <p className="placeholder">
            {question ? 'Generating…' : 'A short, speakable answer will stream in here.'}
          </p>
        )}
        <History items={history} />
      </div>
    </section>
  );
}
