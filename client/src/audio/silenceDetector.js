// Tiny energy-based voice activity detector. Pure logic (no browser APIs) so it can be unit
// tested and reused by the server's WAV test script.
//
// Feed it the RMS level of each audio frame. It reports 'speech_end' once the level has
// stayed below the threshold for `silenceMs` after at least `minSpeechMs` of speech.
// The server uses that event to make Deepgram finalize immediately instead of waiting
// for its own endpointing, which can lag by seconds on noisy or trailing-off speech.

export const VAD_DEFAULTS = Object.freeze({
  threshold: 0.01, // RMS (≈ -40 dBFS). Call apps' noise suppression keeps silence far below this.
  minSpeechMs: 300, // ignore clicks and short noises
  silenceMs: 700, // how long the level must stay low to count as "stopped talking"
});

export function createSilenceDetector(options = {}) {
  const { threshold, minSpeechMs, silenceMs } = { ...VAD_DEFAULTS, ...options };
  let speechStartedAt = null; // start of the current run of speech
  let lastLoudAt = null; // last frame above the threshold
  let armed = false; // enough speech heard to report its end

  return function update(rms, nowMs) {
    if (rms >= threshold) {
      if (speechStartedAt === null) speechStartedAt = nowMs;
      lastLoudAt = nowMs;
      if (nowMs - speechStartedAt >= minSpeechMs) armed = true;
      return null;
    }

    if (lastLoudAt !== null && nowMs - lastLoudAt >= silenceMs) {
      const event = armed ? 'speech_end' : null;
      speechStartedAt = null;
      lastLoudAt = null;
      armed = false;
      return event;
    }
    return null;
  };
}

export function rmsOf(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
