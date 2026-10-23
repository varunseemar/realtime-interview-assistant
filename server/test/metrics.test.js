import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AudioClock, computeMetrics } from '../src/metrics.js';

describe('AudioClock', () => {
  it('anchors audio time zero one chunk before the first chunk arrived', () => {
    const clock = new AudioClock(250);
    clock.markChunk(10_250);
    clock.markChunk(10_500); // later chunks don't move the origin
    assert.equal(clock.toWallClock(0), 10_000);
    assert.equal(clock.toWallClock(3.5), 13_500);
  });

  it('returns null before any audio has arrived', () => {
    assert.equal(new AudioClock().toWallClock(1), null);
  });
});

describe('computeMetrics', () => {
  it('splits end-to-end latency into detection and LLM time', () => {
    const metrics = computeMetrics({ speechEndAt: 1000, detectedAt: 1400, firstTokenAt: 2000, doneAt: 2300 });
    assert.deepEqual(metrics, { detectionMs: 400, ttftMs: 600, e2eMs: 1000, totalMs: 1300 });
  });

  it('measures typed questions from the moment they were submitted', () => {
    const metrics = computeMetrics({ speechEndAt: null, detectedAt: 1000, firstTokenAt: 1500, doneAt: 1800 });
    assert.deepEqual(metrics, { detectionMs: null, ttftMs: 500, e2eMs: 500, totalMs: 800 });
  });
});
