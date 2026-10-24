// Decides *when* the interviewer has finished asking something worth answering.
//
// Inputs come from the STT stream:
//   addFinal(segment)  – a finalized transcript segment; segment.speechFinal = ~300ms pause
//   utteranceEnd()     – Deepgram saw a ~1s gap after the last word
//
// Decision ladder (cheapest first):
//   1. On a short pause (speech_final), answer immediately only if the rules see a clear question.
//   2. On a longer gap (UtteranceEnd), make the final call: ignore noise, wait a little longer
//      if the sentence trails off ("...and"), escalate ambiguous statements to the LLM classifier.
//   3. If the interviewer keeps talking right after a question fired, merge the new part
//      into it and fire again, so the session can restart the answer with the full question.
//
// Latency: ambiguous text is sent to the classifier *speculatively* as soon as it is seen
// (at the short pause, or when the trailing-word wait starts), so its verdict is usually
// ready by the time the longer gap confirms the speaker has stopped.
//
// Emits:
//   'question'    { text, audioEndSec, heardAt, path, followOn, forced? }
//                 heardAt = wall-clock ms the last final segment arrived from STT
//                 path    = which rung of the ladder fired (see PATH)
//   'ignored'     { text, reason }
//   'classifying' { text }

import { EventEmitter } from 'node:events';
import { analyze, normalize } from './heuristics.js';

const DEFAULT_OPTIONS = {
  incompleteGraceMs: 600, // extra wait when the utterance ends on "and", "the", ...
  followOnGapSec: 2.0, // speech starting this soon after a question is treated as part of it
  now: Date.now,
};

export const PATH = Object.freeze({
  PAUSE: 'pause', // clear question at the short pause
  UTTERANCE_END: 'utterance_end', // clear question, but only confirmed at the longer gap
  CLASSIFIER: 'classifier', // ambiguous, confirmed by the LLM classifier
  WAIT_CLASSIFIER: 'wait+classifier', // trailed off, waited, then classifier
  FOLLOW_ON: 'follow_on', // continuation merged into the previous question
  MANUAL: 'manual', // "Answer last thing said"
});

export class QuestionDetector extends EventEmitter {
  #classify;
  #options;
  #segments = []; // [{ text, start, end, receivedAt }] finals not yet decided on
  #graceTimer = null;
  #speculative = null; // { text, promise } classifier call started ahead of the decision
  #lastQuestion = null; // { text, end }
  #lastUtterance = ''; // most recent decided-on text, for "answer the last thing said"

  constructor({ classify, ...options }) {
    super();
    this.#classify = classify;
    this.#options = { ...DEFAULT_OPTIONS, ...options };
  }

  addFinal({ text, start, end, speechFinal }) {
    const trimmed = text?.trim();
    if (trimmed) {
      this.#cancelGrace(); // they kept talking
      this.#segments.push({ text: trimmed, start, end, receivedAt: this.#options.now() });
    }
    if (speechFinal) this.#evaluate('speech_final');
  }

  utteranceEnd() {
    this.#evaluate('utterance_end');
  }

  // Manual override from the UI: treat whatever was said last as the question.
  forceQuestion() {
    const segments = this.#takeSegments();
    const text = segments.length ? joinText(segments) : this.#lastUtterance;
    if (!text) return false;
    this.#lastQuestion = { text, end: segments.at(-1)?.end ?? this.#lastQuestion?.end ?? 0 };
    this.emit('question', {
      text,
      audioEndSec: this.#lastQuestion.end,
      heardAt: segments.at(-1)?.receivedAt ?? null,
      path: PATH.MANUAL,
      followOn: false,
      forced: true,
    });
    return true;
  }

  reset() {
    this.#cancelGrace();
    this.#segments = [];
    this.#speculative = null;
    this.#lastQuestion = null;
    this.#lastUtterance = '';
  }

  #evaluate(trigger) {
    if (this.#segments.length === 0) return;
    const result = analyze(joinText(this.#segments));

    if (result.verdict === 'question') {
      const path = trigger === 'speech_final' ? PATH.PAUSE : PATH.UTTERANCE_END;
      this.#emitQuestion(result.text, this.#takeSegments(), path);
      return;
    }

    // A 300ms pause is too short to reject anything — people pause mid-question.
    // But if the text is ambiguous, start the classifier now so its answer is ready later.
    if (trigger === 'speech_final') {
      if (result.verdict === 'statement' && result.reason !== 'too_short' && !this.#isFollowOn(this.#segments)) {
        this.#classifySpeculatively(result.text);
      }
      return;
    }

    if (result.verdict === 'noise') {
      this.#ignore(result.text, result.reason, this.#takeSegments());
      return;
    }

    if (result.verdict === 'incomplete') {
      // Already waiting for this utterance (e.g. a forced final and Deepgram's own
      // UtteranceEnd both arrived): don't restart the wait.
      if (this.#graceTimer) return;
      const pendingText = joinText(this.#segments);
      if (!this.#isFollowOn(this.#segments)) this.#classifySpeculatively(pendingText);
      this.#graceTimer = setTimeout(() => {
        this.#graceTimer = null;
        const segments = this.#takeSegments();
        // Speaker never continued: let the classifier judge the fragment as-is.
        if (segments.length) this.#decideStatement(joinText(segments), 'trailing_word', segments);
      }, this.#options.incompleteGraceMs);
      return;
    }

    this.#decideStatement(result.text, result.reason, this.#takeSegments());
  }

  async #decideStatement(text, reason, segments) {
    if (this.#isFollowOn(segments)) {
      this.#emitQuestion(text, segments, PATH.FOLLOW_ON);
      return;
    }
    if (reason === 'too_short') {
      this.#ignore(text, reason, segments);
      return;
    }

    this.emit('classifying', { text });
    const { isQuestion, question } = await this.#classifyCached(text);
    if (isQuestion) {
      const path = reason === 'trailing_word' ? PATH.WAIT_CLASSIFIER : PATH.CLASSIFIER;
      this.#emitQuestion(question || text, segments, path);
    } else {
      this.#ignore(text, 'not_a_question', segments);
    }
  }

  #cancelGrace() {
    clearTimeout(this.#graceTimer);
    this.#graceTimer = null;
  }

  #classifySpeculatively(text) {
    if (this.#speculative?.text === text) return;
    this.#speculative = { text, promise: this.#classify(text) };
  }

  // Reuses the speculative call if it was for exactly this text; otherwise classifies now.
  #classifyCached(text) {
    const speculative = this.#speculative;
    this.#speculative = null;
    return speculative?.text === text ? speculative.promise : this.#classify(text);
  }

  #emitQuestion(text, segments, path) {
    const followOn = this.#isFollowOn(segments);
    const fullText = followOn ? `${this.#lastQuestion.text} ${text}` : text;

    if (!followOn && this.#lastQuestion && normalize(fullText) === normalize(this.#lastQuestion.text)) {
      this.#ignore(text, 'duplicate', segments);
      return;
    }

    const end = segments.at(-1)?.end ?? 0;
    this.#lastQuestion = { text: fullText, end };
    this.#lastUtterance = fullText;
    this.emit('question', {
      text: fullText,
      audioEndSec: end,
      heardAt: segments.at(-1)?.receivedAt ?? null,
      path: followOn ? PATH.FOLLOW_ON : path,
      followOn,
    });
  }

  #ignore(text, reason, segments) {
    this.#lastUtterance = segments.length ? joinText(segments) : text;
    this.emit('ignored', { text, reason });
  }

  #isFollowOn(segments) {
    if (!this.#lastQuestion || segments.length === 0) return false;
    return segments[0].start - this.#lastQuestion.end <= this.#options.followOnGapSec;
  }

  #takeSegments() {
    const segments = this.#segments;
    this.#segments = [];
    return segments;
  }
}

function joinText(segments) {
  return segments.map((s) => s.text).join(' ');
}
