import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { createClassifier } from './detection/classifier.js';
import { createAnswerer } from './llm/answerer.js';
import { createGroqClient } from './llm/groqClient.js';
import { createSession } from './session.js';

const MAX_FRAME_BYTES = 1024 * 1024; // audio chunks are ~4KB; anything near 1MB is a bug or abuse

// Shared, stateless services; per-connection state lives in the session.
const groq = createGroqClient({ apiKey: config.groqApiKey });
const services = {
  classify: createClassifier({ groq, model: config.classifierModel }),
  streamAnswer: createAnswerer({ groq, model: config.answerModel }),
};

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_FRAME_BYTES });

wss.on('connection', (socket, req) => {
  console.log(`[server] client connected from ${req.socket.remoteAddress}`);
  createSession(socket, services);
  socket.on('close', () => console.log('[server] client disconnected'));
});

server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port} (WebSocket at /ws)`);
});
