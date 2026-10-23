import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { createSession } from './session.js';

const MAX_FRAME_BYTES = 1024 * 1024; // audio chunks are ~4KB; anything near 1MB is a bug or abuse

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_FRAME_BYTES });

wss.on('connection', (socket, req) => {
  console.log(`[server] client connected from ${req.socket.remoteAddress}`);
  createSession(socket);
  socket.on('close', () => console.log('[server] client disconnected'));
});

server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port} (WebSocket at /ws)`);
});
