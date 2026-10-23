// WebSocket message contract between browser and server.
// Binary frames are always audio chunks (browser -> server); everything else is JSON
// shaped as { type, ...payload }. Mirrored in client/src/protocol.js.

export const ClientMsg = Object.freeze({
  START: 'session.start', // { resume, jd, source }
  STOP: 'session.stop',
  MANUAL_QUESTION: 'question.manual', // { text }
});

export const ServerMsg = Object.freeze({
  STATUS: 'status', // { state }
  TRANSCRIPT_INTERIM: 'transcript.interim', // { text }
  TRANSCRIPT_FINAL: 'transcript.final', // { text }
  QUESTION: 'question.detected', // { id, text }
  ANSWER_DELTA: 'answer.delta', // { id, token }
  ANSWER_DONE: 'answer.done', // { id }
  METRICS: 'metrics', // { id, ...timings }
  ERROR: 'error', // { code, message }
});

export const Status = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  ANSWERING: 'answering',
  ERROR: 'error',
});

export function send(socket, type, payload = {}) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify({ type, ...payload }));
}
