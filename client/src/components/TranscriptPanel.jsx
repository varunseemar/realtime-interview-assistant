import { useEffect, useRef } from 'react';

const IGNORED_LABELS = {
  filler: 'filler',
  small_talk: 'small talk',
  too_short: 'too short',
  not_a_question: 'not a question',
  duplicate: 'repeat',
};

function TranscriptItem({ item }) {
  if (item.kind === 'final') return <span className="transcript-final">{item.text} </span>;
  if (item.kind === 'question') return <span className="chip chip-question">question detected</span>;
  return (
    <span className="chip chip-ignored" title={item.text}>
      ignored · {IGNORED_LABELS[item.reason] ?? item.reason}
    </span>
  );
}

export function TranscriptPanel({ items, interim }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [items, interim]);

  const isEmpty = items.length === 0 && !interim;

  return (
    <section className="panel transcript-panel">
      <h2 className="panel-title">Live transcript</h2>
      <div className="panel-body transcript-body">
        {isEmpty && <p className="placeholder">Press Start and the conversation will appear here.</p>}
        {items.map((item) => (
          <TranscriptItem key={item.id} item={item} />
        ))}
        {interim && <span className="transcript-interim">{interim}</span>}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
