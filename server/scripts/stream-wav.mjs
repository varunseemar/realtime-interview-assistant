// End-to-end test without a browser: streams a WAV file to the server in real time, exactly
// like the browser streams microphone chunks, and prints every pipeline decision with timings.
//
//   node scripts/stream-wav.mjs path/to/interview.wav
//
// Requires the server to be running (npm run dev). Any WAV works; 16 kHz mono 16-bit is assumed
// for real-time pacing (other formats still work, just paced faster or slower than real time).

import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const CHUNK_MS = 250;
const BYTES_PER_CHUNK = (16_000 * 2 * CHUNK_MS) / 1000; // 16 kHz * 16-bit mono

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

ws.on('open', async () => {
  ws.send(JSON.stringify({ type: 'session.start', resume: '', jd: '', chunkMs: CHUNK_MS }));
  // Schedule each chunk against an absolute timeline; chained setTimeouts drift and would
  // make the audio lag real time, inflating the measured detection latency.
  const streamStart = Date.now();
  for (let i = 0, offset = 0; offset < audio.length; i += 1, offset += BYTES_PER_CHUNK) {
    const due = streamStart + (i + 1) * CHUNK_MS; // chunk i covers audio up to (i+1)*CHUNK_MS
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, due - Date.now())));
    ws.send(audio.subarray(offset, offset + BYTES_PER_CHUNK));
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
        `${stamp()}  latency    end-of-question -> first token ${msg.e2eMs}ms ` +
          `(detect ${msg.detectionMs}ms + LLM ${msg.ttftMs}ms)`,
      );
      break;
    case 'error':
      console.error(`${stamp()}  ERROR      ${msg.message}`);
      break;
    default:
      break;
  }
});
