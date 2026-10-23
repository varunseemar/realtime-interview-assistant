import { useState } from 'react';

// Fallbacks for when automatic detection misses: type a question, or force an answer
// to whatever the interviewer said last.
export function ManualAsk({ disabled, onAsk, onAnswerLast }) {
  const [text, setText] = useState('');

  const submit = (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    onAsk(text.trim());
    setText('');
  };

  return (
    <form className="manual-ask" onSubmit={submit}>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a question…"
        disabled={disabled}
        aria-label="Type a question to answer"
      />
      <button type="submit" className="btn btn-secondary" disabled={disabled || !text.trim()}>
        Ask
      </button>
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onAnswerLast}>
        Answer last thing said
      </button>
    </form>
  );
}
