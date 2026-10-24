// Captures audio from a browser tab (getDisplayMedia) or the microphone (getUserMedia),
// emits compressed webm/opus chunks via MediaRecorder, and monitors loudness for the
// level meter, the "no audio" warning and fast end-of-speech detection.

import { useCallback, useRef, useState } from 'react';
import { monitorVoiceActivity } from '../audio/voiceActivity.js';

export const CHUNK_MS = 250; // smaller = lower latency, more WebSocket frames
const PREFERRED_MIME = 'audio/webm;codecs=opus';
const LEVEL_UPDATE_MS = 125; // re-render the meter ~8x/s, not on every 50ms frame
const QUIET_WARNING_MS = 8000; // no sound for this long while listening -> warn the user

async function getAudioStream(source) {
  if (source === 'tab') {
    // Chrome requires video: true to offer tab audio; we simply never record the video track.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('No audio was shared. Choose a browser tab and tick "Share tab audio".');
    }
    return stream;
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
}

function describeMediaError(err) {
  if (err.name === 'NotAllowedError') return 'Permission to capture audio was denied.';
  if (err.name === 'NotFoundError') return 'No microphone was found.';
  return err.message;
}

export function useAudioCapture() {
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const stopMonitorRef = useRef(null);
  const [level, setLevel] = useState(0); // 0..1 for the meter
  const [quiet, setQuiet] = useState(false); // true when nothing audible for a while

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    stopMonitorRef.current?.();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    stopMonitorRef.current = null;
    streamRef.current = null;
    setLevel(0);
    setQuiet(false);
  }, []);

  // Step 1: ask for permission and get the stream. Must run inside the click handler.
  const open = useCallback(async (source, { onEnded }) => {
    let stream;
    try {
      stream = await getAudioStream(source);
    } catch (err) {
      throw new Error(describeMediaError(err));
    }
    // Fires when the user clicks Chrome's "Stop sharing" or unplugs the mic.
    stream.getAudioTracks()[0].addEventListener('ended', onEnded);
    streamRef.current = stream;
  }, []);

  // Step 2: start emitting chunks (called once the server is ready to receive them).
  const record = useCallback(({ onChunk, onSpeechEnd }) => {
    const audioOnly = new MediaStream(streamRef.current.getAudioTracks());
    const options = MediaRecorder.isTypeSupported(PREFERRED_MIME) ? { mimeType: PREFERRED_MIME } : {};
    const recorder = new MediaRecorder(audioOnly, options);
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) onChunk(event.data);
    });
    recorder.start(CHUNK_MS);
    recorderRef.current = recorder;

    let peak = 0;
    let lastUpdate = 0;
    let lastSoundAt = performance.now();
    stopMonitorRef.current = monitorVoiceActivity(audioOnly, {
      onSpeechEnd,
      onFrame: (rms, isLoud) => {
        const now = performance.now();
        if (isLoud) lastSoundAt = now;
        peak = Math.max(peak, rms);
        if (now - lastUpdate < LEVEL_UPDATE_MS) return;
        // Log scale: -60 dBFS..0 dBFS -> 0..1, so quiet speech still moves the meter.
        const db = 20 * Math.log10(Math.max(peak, 1e-6));
        setLevel(Math.min(1, Math.max(0, (db + 60) / 60)));
        setQuiet(now - lastSoundAt > QUIET_WARNING_MS);
        peak = 0;
        lastUpdate = now;
      },
    });
  }, []);

  return { open, record, stop, level, quiet };
}
