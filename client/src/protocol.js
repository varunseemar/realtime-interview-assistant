// Mirror of server/src/protocol.js — keep the two in sync.

export const ClientMsg = Object.freeze({
  START: 'session.start',
  STOP: 'session.stop',
  MANUAL_QUESTION: 'question.manual',
  SPEECH_END: 'audio.speech_end',
});

export const ServerMsg = Object.freeze({
  STATUS: 'status',
  TRANSCRIPT_INTERIM: 'transcript.interim',
  TRANSCRIPT_FINAL: 'transcript.final',
  UTTERANCE_IGNORED: 'utterance.ignored',
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
