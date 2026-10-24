// Watches the captured stream's loudness with a Web Audio AnalyserNode (nothing is played
// back). Reports the level for the meter and an "end of speech" signal for fast endpointing.

import { createSilenceDetector, rmsOf, VAD_DEFAULTS } from './silenceDetector.js';

const FRAME_MS = 50;

// onFrame(rms, isLoud) runs every frame; onSpeechEnd() once per utterance. Returns stop().
export function monitorVoiceActivity(stream, { onFrame, onSpeechEnd }) {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser); // analyser only; not connected to speakers
  context.resume().catch(() => {});

  const samples = new Float32Array(analyser.fftSize);
  const update = createSilenceDetector();

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const rms = rmsOf(samples);
    onFrame(rms, rms >= VAD_DEFAULTS.threshold);
    if (update(rms, performance.now()) === 'speech_end') onSpeechEnd();
  }, FRAME_MS);

  return () => {
    clearInterval(timer);
    source.disconnect();
    context.close().catch(() => {});
  };
}
