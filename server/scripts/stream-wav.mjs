// End-to-end test without a browser: streams a WAV file to the server in real time, exactly
// like the browser streams microphone chunks, and prints every pipeline decision with timings.
// It also runs the browser's silence detector over the audio and sends the same
// "audio.speech_end" signals the real client would.
//
//   node scripts/stream-wav.mjs path/to/interview.wav
//
// Requires the server to be running (npm run dev). Expects 16 kHz mono 16-bit PCM
// (other formats still stream, but pacing and the silence detector will be off).

import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { createSilenceDetector, rmsOf } from '../../client/src/audio/silenceDetector.js';

const CHUNK_MS = 250;
const SAMPLE_RATE = 16_000;
const BYTES_PER_CHUNK = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000; // 16-bit mono
const VAD_FRAME_MS = 50;
const WAV_HEADER_BYTES = 44;

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/stream-wav.mjs path/to/audio.wav');
  process.exit(1);
}

const audio = readFileSync(file);
const ws = new WebSocket(process.env.WS_URL ?? 'ws://localhost:8080/ws');
const startedAt = Date.now();
const stamp = () => `${((Date.now() - startedAt) / 1000).toFixed(2).padStart(6)}s`;
let answer = '';

// Returns how many speech_end events the browser VAD would fire within this chunk of PCM.
const vadUpdate = createSilenceDetector();
let vadClockMs = 0;
function speechEndsIn(chunk, isFirstChunk) {
  const pcm = isFirstChunk ? chunk.subarray(WAV_HEADER_BYTES) : chunk;
  const samplesPerFrame = (SAMPLE_RATE * VAD_FRAME_MS) / 1000;
  let events = 0;
  for (let offset = 0; offset + samplesPerFrame * 2 <= pcm.length; offset += samplesPerFrame * 2) {
    const frame = new Float32Array(samplesPerFrame);
    for (let i = 0; i < samplesPerFrame; i += 1) frame[i] = pcm.readInt16LE(offset + i * 2) / 32768;
    vadClockMs += VAD_FRAME_MS;
    if (vadUpdate(rmsOf(frame), vadClockMs) === 'speech_end') events += 1;
  }
  return events;
}

ws.on('open', async () => {
  ws.send(JSON.stringify({ type: 'session.start', resume: '', jd: '', chunkMs: CHUNK_MS }));
  // Schedule each chunk against an absolute timeline; chained setTimeouts drift and would
  // make the audio lag real time, inflating the measured detection latency.
  const streamStart = Date.now();
  for (let i = 0, offset = 0; offset < audio.length; i += 1, offset += BYTES_PER_CHUNK) {
    const due = streamStart + (i + 1) * CHUNK_MS; // chunk i covers audio up to (i+1)*CHUNK_MS
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, due - Date.now())));
    const chunk = audio.subarray(offset, offset + BYTES_PER_CHUNK);
    ws.send(chunk);
    for (let n = speechEndsIn(chunk, i === 0); n > 0; n -= 1) ws.send(JSON.stringify({ type: 'audio.speech_end' }));
  }
  ws.send(JSON.stringify({ type: 'session.stop' }));
  setTimeout(() => ws.close(), 1500);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  switch (msg.type) {
    case 'transcript.final':
      console.log(`${stamp()}  heard      "${msg.text}"`);
      break;
    case 'utterance.ignored':
      console.log(`${stamp()}  ignored    (${msg.reason})`);
      break;
    case 'question.detected':
      answer = '';
      console.log(`${stamp()}  QUESTION   "${msg.text}"`);
      break;
    case 'answer.delta':
      answer += msg.token;
      break;
    case 'answer.done':
      console.log(answer.replace(/^/gm, '              '));
      break;
    case 'metrics':
      console.log(
        `${stamp()}  latency    end of question -> first token ${msg.e2eMs}ms ` +
          `= STT ${msg.sttMs}ms + decide ${msg.decisionMs}ms (${msg.path}) + LLM ${msg.ttftMs}ms`,
      );
      break;
    case 'error':
      console.error(`${stamp()}  ERROR      ${msg.message}`);
      break;
    default:
      break;
  }
});
