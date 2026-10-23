// Captures audio from a browser tab (getDisplayMedia) or the microphone (getUserMedia)
// and emits compressed webm/opus chunks via MediaRecorder.

import { useCallback, useRef } from 'react';

const CHUNK_MS = 250; // smaller = lower latency, more WebSocket frames
const PREFERRED_MIME = 'audio/webm;codecs=opus';

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

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    streamRef.current = null;
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
  const record = useCallback((onChunk) => {
    const audioOnly = new MediaStream(streamRef.current.getAudioTracks());
    const options = MediaRecorder.isTypeSupported(PREFERRED_MIME) ? { mimeType: PREFERRED_MIME } : {};
    const recorder = new MediaRecorder(audioOnly, options);
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) onChunk(event.data);
    });
    recorder.start(CHUNK_MS);
    recorderRef.current = recorder;
  }, []);

  return { open, record, stop };
}
