// One Session per browser WebSocket connection. It owns the Deepgram stream and
// routes events between the browser, STT, question detection and the LLM.

import { config } from './config.js';
import { ClientMsg, ServerMsg, Status, send } from './protocol.js';
import { DeepgramStream } from './stt/deepgramStream.js';

export function createSession(socket) {
  let stt = null;
  let status = Status.IDLE;

  const setStatus = (next) => {
    if (next === status) return;
    status = next;
    send(socket, ServerMsg.STATUS, { state: next });
  };

  const reportError = (code, message) => {
    console.error(`[session] ${code}: ${message}`);
    send(socket, ServerMsg.ERROR, { code, message });
  };

  function startListening() {
    stopListening();

    stt = new DeepgramStream({ apiKey: config.deepgramApiKey });

    stt.on('transcript', ({ text, isFinal }) => {
      if (!text) return; // Deepgram sends empty results during silence.
      send(socket, isFinal ? ServerMsg.TRANSCRIPT_FINAL : ServerMsg.TRANSCRIPT_INTERIM, { text });
    });

    stt.on('error', (err) => reportError('stt_error', `Speech-to-text error: ${err.message}`));

    stt.on('close', ({ code, expected }) => {
      if (expected) return;
      reportError('stt_closed', `Speech-to-text connection closed unexpectedly (code ${code}). Press Start to retry.`);
      stt = null;
      setStatus(Status.ERROR);
    });

    stt.connect();
    setStatus(Status.LISTENING);
  }

  function stopListening() {
    stt?.finish();
    stt = null;
    setStatus(Status.IDLE);
  }

  function handleControlMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      reportError('bad_message', 'Received a message that is not valid JSON.');
      return;
    }

    switch (msg.type) {
      case ClientMsg.START:
        startListening();
        break;
      case ClientMsg.STOP:
        stopListening();
        break;
      default:
        reportError('unknown_message', `Unknown message type: ${msg.type}`);
    }
  }

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      stt?.send(data);
    } else {
      handleControlMessage(data);
    }
  });

  socket.on('close', stopListening);
  socket.on('error', (err) => console.error('[session] socket error:', err.message));
}
