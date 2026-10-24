const BARS = 5;

// Small input-level meter so it's obvious whether any audio is being captured.
export function LevelMeter({ level, active }) {
  const lit = active ? Math.round(level * BARS) : 0;
  return (
    <span className="level-meter" role="meter" aria-label="Audio input level" aria-valuenow={Math.round(level * 100)}>
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} className={`level-bar ${i < lit ? 'level-bar-on' : ''}`} style={{ height: `${6 + i * 3}px` }} />
      ))}
    </span>
  );
}
