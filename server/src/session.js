// One Session per browser WebSocket connection. It owns the Deepgram stream, the
// question detector and the in-flight answer, and routes events between them:
//
//   audio frames -> DeepgramStream -> transcript events -> QuestionDetector -> answer stream -> browser

import { config } from './config.js';
import { QuestionDetector } from './detection/questionDetector.js';
import { isBehavioral } from './llm/prompts.js';
import { AudioClock, computeMetrics } from './metrics.js';
import { ClientMsg, ServerMsg, Status, send } from './protocol.js';
import { DeepgramStream } from './stt/deepgramStream.js';

const MAX_CONTEXT_CHARS = 12_000; // per field; keeps the prompt (and time to first token) small
const MAX_QUESTION_CHARS = 1_000;
const MEMORY_TURNS = 4; // earlier Q&A pairs sent with each question, for follow-ups

const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function createSession(socket, { classify, streamAnswer }) {
  let stt = null;
  let detector = null;
  let audioClock = new AudioClock();
  let context = { resume: '', jd: '' };
  let history = []; // completed [{ question, answer }], oldest first
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

  // speechEndAt: wall-clock ms the interviewer stopped talking (null for typed questions).
  // heardAt: when STT delivered the final words. path: which detection rule fired.
  async function answerQuestion(text, { speechEndAt = null, heardAt = null, path = 'typed' } = {}) {
    activeAnswer?.controller.abort(); // a newer question always wins
    const id = nextQuestionId++;
    const controller = new AbortController();
    activeAnswer = { id, controller };
    const timings = { speechEndAt, heardAt, detectedAt: Date.now(), firstTokenAt: null, doneAt: null };

    send(socket, ServerMsg.QUESTION, { id, text, behavioral: isBehavioral(text) });
    setStatus(Status.THINKING);

    try {
      const answer = await streamAnswer({
        question: text,
        context,
        history: history.slice(-MEMORY_TURNS),
        signal: controller.signal,
        onToken: (token) => {
          if (timings.firstTokenAt === null) {
            timings.firstTokenAt = Date.now();
            setStatus(Status.ANSWERING);
          }
          send(socket, ServerMsg.ANSWER_DELTA, { id, token });
        },
      });
      timings.doneAt = Date.now();
      history.push({ question: text, answer });
      send(socket, ServerMsg.ANSWER_DONE, { id });

      const metrics = computeMetrics(timings);
      send(socket, ServerMsg.METRICS, { id, path, ...metrics });
      console.log(
        `[metrics] #${id} e2e=${metrics.e2eMs}ms = stt ${metrics.sttMs}ms + decide ${metrics.decisionMs}ms ` +
          `(${path}) + llm ${metrics.ttftMs}ms | "${text.slice(0, 80)}"`,
      );
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
    d.on('question', ({ text, audioEndSec, heardAt, path, forced }) => {
      if (forced) {
        answerQuestion(text, { path });
        return;
      }
      answerQuestion(text, { speechEndAt: audioClock.toWallClock(audioEndSec), heardAt, path });
    });
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
      if (segment.isFinal) {
        detector?.addFinal(segment);
        // A forced final means we already saw enough silence: treat it as the end of the turn.
        if (segment.fromFinalize) detector?.utteranceEnd();
      }
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

  function startListening({ resume, jd, chunkMs }) {
    stopListening();
    context = { resume: clip(resume, MAX_CONTEXT_CHARS), jd: clip(jd, MAX_CONTEXT_CHARS) };
    history = [];
    audioClock = new AudioClock(Number(chunkMs) || undefined);
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
    const typed = clip(text, MAX_QUESTION_CHARS);
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
      case ClientMsg.SPEECH_END:
        stt?.finalizePending();
        break;
      default:
        reportError('unknown_message', `Unknown message type: ${msg.type}`);
    }
  }

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      if (!stt) return;
      audioClock.markChunk();
      stt.send(data);
    } else {
      handleControlMessage(data);
    }
  });

  socket.on('close', stopListening);
  socket.on('error', (err) => console.error('[session] socket error:', err.message));
}
