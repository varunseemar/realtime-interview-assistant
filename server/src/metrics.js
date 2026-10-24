// Latency measurement. The headline number is "end of question -> first answer token",
// which the brief targets at under 3 seconds.
//
// Deepgram timestamps words in seconds of *audio*, so we map audio time to wall-clock time:
// the first chunk arrives roughly one chunk-length after recording started, so
// audio t=0 ≈ (arrival of first chunk - chunkMs). This is accurate to well under one chunk
// as long as audio is streamed in real time (which MediaRecorder does).

export class AudioClock {
  #chunkMs;
  #originMs = null;

  constructor(chunkMs = 250) {
    this.#chunkMs = chunkMs;
  }

  markChunk(nowMs = Date.now()) {
    if (this.#originMs === null) this.#originMs = nowMs - this.#chunkMs;
  }

  // Wall-clock ms at which the given audio second was spoken, or null before any audio.
  toWallClock(audioSec) {
    if (this.#originMs === null || typeof audioSec !== 'number') return null;
    return this.#originMs + audioSec * 1000;
  }
}

const elapsed = (from, to) => (from == null || to == null ? null : Math.max(0, Math.round(to - from)));

// All inputs are wall-clock ms. speechEndAt is null for typed questions.
// heardAt is when the last final transcript segment arrived, which splits detection into
// "waiting for STT to finalise the words" and "deciding it was a question".
export function computeMetrics({ speechEndAt, heardAt = null, detectedAt, firstTokenAt, doneAt }) {
  const origin = speechEndAt ?? detectedAt;
  return {
    detectionMs: elapsed(speechEndAt, detectedAt), // STT endpointing + rules/classifier
    sttMs: elapsed(speechEndAt, heardAt), // end of speech -> final transcript received
    decisionMs: elapsed(heardAt, detectedAt), // final transcript -> question fired (pauses, classifier)
    ttftMs: elapsed(detectedAt, firstTokenAt), // LLM time to first token
    e2eMs: elapsed(origin, firstTokenAt), // end of question -> first token (headline)
    totalMs: elapsed(origin, doneAt), // end of question -> full answer
  };
}
