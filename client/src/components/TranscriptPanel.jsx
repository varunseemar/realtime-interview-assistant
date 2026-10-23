import { useEffect, useRef } from 'react';

export function TranscriptPanel({ finals, interim }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [finals, interim]);

  const isEmpty = finals.length === 0 && !interim;

  return (
    <section className="panel transcript-panel">
      <h2 className="panel-title">Live transcript</h2>
      <div className="panel-body transcript-body">
        {isEmpty && <p className="placeholder">Press Start and the conversation will appear here.</p>}
        {finals.map((segment) => (
          <span key={segment.id} className="transcript-final">
            {segment.text}{' '}
          </span>
        ))}
        {interim && <span className="transcript-interim">{interim}</span>}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
