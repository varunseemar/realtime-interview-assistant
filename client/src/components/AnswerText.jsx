// Renders the model's "- bullet" lines as a list, and highlights [bracketed] cues the
// candidate is meant to fill in with their own details.

function withCues(line) {
  return line.split(/(\[[^\]]+\])/g).map((part, i) =>
    part.startsWith('[') && part.endsWith(']') ? (
      <mark key={i} className="cue">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function AnswerText({ text, streaming }) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-•*]\s*/, ''));

  return (
    <ul className="answer-list">
      {lines.map((line, i) => (
        <li key={i}>
          {withCues(line)}
          {streaming && i === lines.length - 1 && <span className="cursor" aria-hidden="true" />}
        </li>
      ))}
    </ul>
  );
}
