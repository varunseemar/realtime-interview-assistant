// Smoke test without a browser or microphone: sends typed questions through the real
// WebSocket session and prints each streamed answer with its latency.
//
//   node scripts/ask.mjs "Tell me about yourself." "Why this role?"
//
// Requires the server to be running (npm run dev). Uses a small built-in sample resume/JD.

import WebSocket from 'ws';

const SAMPLE_RESUME =
  'Alex Doe. Full-stack developer, 2 years. Built a real-time chat app with Socket.IO and Redis serving 5k users at Acme Labs. Node.js, Express, React, MongoDB, Docker. B.Tech Computer Science 2023.';
const SAMPLE_JD =
  'Software Engineer at VoiceAI. Build real-time streaming features with Node.js and React. Experience with WebSockets and LLM APIs is a plus.';

const questions = process.argv.slice(2);
if (questions.length === 0) {
  console.error('Usage: node scripts/ask.mjs "question one" ["question two" ...]');
  process.exit(1);
}

const url = process.env.WS_URL ?? 'ws://localhost:8080/ws';
const ws = new WebSocket(url);
let answer = '';

function askNext() {
  const question = questions.shift();
  if (!question) {
    ws.close();
    return;
  }
  answer = '';
  ws.send(JSON.stringify({ type: 'question.manual', text: question }));
}

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'session.start', resume: SAMPLE_RESUME, jd: SAMPLE_JD }));
  setTimeout(askNext, 300);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'question.detected') console.log(`\nQ: ${msg.text}`);
  if (msg.type === 'answer.delta') answer += msg.token;
  if (msg.type === 'answer.done') console.log(answer);
  if (msg.type === 'metrics') {
    console.log(`[first token ${msg.ttftMs}ms, full answer ${msg.totalMs}ms, ${answer.trim().split(/\s+/).length} words]`);
    askNext();
  }
  if (msg.type === 'error') console.error(`ERROR: ${msg.message}`);
});

ws.on('error', (err) => {
  console.error(`Could not connect to ${url}: ${err.message}. Is the server running?`);
  process.exit(1);
});
