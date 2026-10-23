// Mirror of server/src/protocol.js — keep the two in sync.

export const ClientMsg = Object.freeze({
  START: 'session.start',
  STOP: 'session.stop',
  MANUAL_QUESTION: 'question.manual',
});

export const ServerMsg = Object.freeze({
  STATUS: 'status',
  TRANSCRIPT_INTERIM: 'transcript.interim',
  TRANSCRIPT_FINAL: 'transcript.final',
  QUESTION: 'question.detected',
  ANSWER_DELTA: 'answer.delta',
  ANSWER_DONE: 'answer.done',
  METRICS: 'metrics',
  ERROR: 'error',
});

export const Status = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  ANSWERING: 'answering',
  ERROR: 'error',
});
