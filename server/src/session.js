// One Session per browser WebSocket connection. It owns the Deepgram stream, the
// question detector and the in-flight answer, and routes events between them:
//
//   audio frames -> DeepgramStream -> transcript events -> QuestionDetector -> answer stream -> browser

import { config } from './config.js';
import { QuestionDetector } from './detection/questionDetector.js';
import { isBehavioral } from './llm/prompts.js';
import { ClientMsg, ServerMsg, Status, send } from './protocol.js';
import { DeepgramStream } from './stt/deepgramStream.js';

const MAX_CONTEXT_CHARS = 12_000; // per field; keeps the prompt (and time to first token) small

const clip = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_CONTEXT_CHARS) : '');

export function createSession(socket, { classify, streamAnswer }) {
  let stt = null;
  let detector = null;
  let context = { resume: '', jd: '' };
  let activeAnswer = null; // { id, controller }
  let nextQuestionId = 1;
  let status = Status.IDLE;

  const setStatus = (next) => {
    if (next === status) return;
    status = next;
    send(socket, ServerMsg.STATUS, { state: next });
  };

  const idleStatus = () => (stt ? Status.LISTENING : Status.IDLE);

  const reportError = (code, message) => {
    console.error(`[session] ${code}: ${message}`);
    send(socket, ServerMsg.ERROR, { code, message });
  };

  // ---------- answering ----------

  async function answerQuestion(text) {
    activeAnswer?.controller.abort(); // a newer question always wins
    const id = nextQuestionId++;
    const controller = new AbortController();
    activeAnswer = { id, controller };

    send(socket, ServerMsg.QUESTION, { id, text, behavioral: isBehavioral(text) });
    setStatus(Status.THINKING);

    let receivedFirstToken = false;
    try {
      await streamAnswer({
        question: text,
        context,
        signal: controller.signal,
        onToken: (token) => {
          if (!receivedFirstToken) {
            receivedFirstToken = true;
            setStatus(Status.ANSWERING);
          }
          send(socket, ServerMsg.ANSWER_DELTA, { id, token });
        },
      });
      send(socket, ServerMsg.ANSWER_DONE, { id });
    } catch (err) {
      if (controller.signal.aborted) return; // superseded or session stopped — not an error
      reportError('llm_error', err.message);
      send(socket, ServerMsg.ANSWER_DONE, { id, failed: true });
    } finally {
      if (activeAnswer?.id === id) {
        activeAnswer = null;
        setStatus(idleStatus());
      }
    }
  }

  function cancelAnswer() {
    activeAnswer?.controller.abort();
    activeAnswer = null;
  }

  // ---------- listening ----------

  function createDetector() {
    const d = new QuestionDetector({ classify });
    d.on('question', ({ text }) => answerQuestion(text));
    d.on('classifying', () => {
      if (!activeAnswer) setStatus(Status.THINKING);
    });
    d.on('ignored', ({ text, reason }) => {
      send(socket, ServerMsg.UTTERANCE_IGNORED, { text, reason });
      if (!activeAnswer) setStatus(idleStatus());
    });
    return d;
  }

  function createStt() {
    const s = new DeepgramStream({ apiKey: config.deepgramApiKey });

    s.on('transcript', (segment) => {
      if (segment.text) {
        send(socket, segment.isFinal ? ServerMsg.TRANSCRIPT_FINAL : ServerMsg.TRANSCRIPT_INTERIM, {
          text: segment.text,
        });
      }
      if (segment.isFinal) detector?.addFinal(segment);
    });

    s.on('utteranceEnd', () => detector?.utteranceEnd());
    s.on('error', (err) => reportError('stt_error', `Speech-to-text error: ${err.message}`));
    s.on('close', ({ code, reason, expected }) => {
      if (expected) return;
      const detail = reason ? `: ${reason}` : '';
      reportError('stt_closed', `Speech-to-text connection closed (code ${code}${detail}). Press Start to retry.`);
      stt = null;
      setStatus(Status.ERROR);
    });

    return s;
  }

  function startListening({ resume, jd }) {
    stopListening();
    context = { resume: clip(resume), jd: clip(jd) };
    detector = createDetector();
    stt = createStt();
    stt.connect();
    setStatus(Status.LISTENING);
  }

  function stopListening() {
    cancelAnswer();
    detector?.reset();
    detector?.removeAllListeners(); // drop late results from an in-flight classifier call
    detector = null;
    stt?.finish();
    stt = null;
    setStatus(Status.IDLE);
  }

  // "Answer this" from the UI: typed text, or (empty) whatever was said last.
  function handleManualQuestion({ text }) {
    const typed = typeof text === 'string' ? text.trim() : '';
    if (typed) {
      answerQuestion(typed);
    } else if (!detector?.forceQuestion()) {
      reportError('nothing_to_answer', 'Nothing has been said yet.');
    }
  }

  // ---------- transport ----------

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
        startListening(msg);
        break;
      case ClientMsg.STOP:
        stopListening();
        break;
      case ClientMsg.MANUAL_QUESTION:
        handleManualQuestion(msg);
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
