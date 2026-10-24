import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSilenceDetector, rmsOf } from './silenceDetector.js';

// Runs a sequence of [rms, durationMs] steps through the detector in 50ms frames.
function run(steps) {
  const update = createSilenceDetector();
  const events = [];
  let now = 0;
  for (const [rms, duration] of steps) {
    for (let t = 0; t < duration; t += 50) {
      now += 50;
      const event = update(rms, now);
      if (event) events.push({ event, at: now });
    }
  }
  return events;
}

describe('createSilenceDetector', () => {
  it('reports the end of speech after the silence window', () => {
    const events = run([
      [0.1, 1000], // speech until t=1000
      [0.0, 1000],
    ]);
    assert.deepEqual(events, [{ event: 'speech_end', at: 1700 }]);
  });

  it('ignores short noises', () => {
    assert.deepEqual(run([[0.1, 150], [0.0, 1000]]), []);
  });

  it('does not fire during short pauses inside speech', () => {
    const events = run([
      [0.1, 800],
      [0.0, 400], // brief pause
      [0.1, 800],
      [0.0, 1000],
    ]);
    assert.equal(events.length, 1);
  });

  it('fires once per utterance', () => {
    const events = run([
      [0.1, 600],
      [0.0, 2000],
      [0.1, 600],
      [0.0, 2000],
    ]);
    assert.equal(events.length, 2);
  });
});

describe('rmsOf', () => {
  it('computes root mean square', () => {
    assert.equal(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
  });
});
