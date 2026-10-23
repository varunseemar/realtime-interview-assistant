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
// Emits:
//   'question'    { text, audioEndSec, followOn }
//   'ignored'     { text, reason }
//   'classifying' { text }

import { EventEmitter } from 'node:events';
import { analyze, normalize } from './heuristics.js';

const DEFAULT_OPTIONS = {
  incompleteGraceMs: 1500, // extra wait when the utterance ends on "and", "the", ...
  followOnGapSec: 2.0, // speech starting this soon after a question is treated as part of it
};

export class QuestionDetector extends EventEmitter {
  #classify;
  #options;
  #segments = []; // [{ text, start, end }] finals not yet decided on
  #graceTimer = null;
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
      clearTimeout(this.#graceTimer);
      this.#segments.push({ text: trimmed, start, end });
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
    this.emit('question', { text, audioEndSec: this.#lastQuestion.end, followOn: false });
    return true;
  }

  reset() {
    clearTimeout(this.#graceTimer);
    this.#segments = [];
    this.#lastQuestion = null;
    this.#lastUtterance = '';
  }

  #evaluate(trigger) {
    if (this.#segments.length === 0) return;
    const result = analyze(joinText(this.#segments));

    if (result.verdict === 'question') {
      this.#emitQuestion(result.text, this.#takeSegments());
      return;
    }

    // A 300ms pause is too short to reject anything — people pause mid-question.
    if (trigger === 'speech_final') return;

    if (result.verdict === 'noise') {
      this.#ignore(result.text, result.reason, this.#takeSegments());
      return;
    }

    if (result.verdict === 'incomplete') {
      clearTimeout(this.#graceTimer);
      this.#graceTimer = setTimeout(() => {
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
      this.#emitQuestion(text, segments);
      return;
    }
    if (reason === 'too_short') {
      this.#ignore(text, reason, segments);
      return;
    }

    this.emit('classifying', { text });
    const { isQuestion, question } = await this.#classify(text);
    if (isQuestion) {
      this.#emitQuestion(question || text, segments);
    } else {
      this.#ignore(text, 'not_a_question', segments);
    }
  }

  #emitQuestion(text, segments) {
    const followOn = this.#isFollowOn(segments);
    const fullText = followOn ? `${this.#lastQuestion.text} ${text}` : text;

    if (!followOn && this.#lastQuestion && normalize(fullText) === normalize(this.#lastQuestion.text)) {
      this.#ignore(text, 'duplicate', segments);
      return;
    }

    const end = segments.at(-1)?.end ?? 0;
    this.#lastQuestion = { text: fullText, end };
    this.#lastUtterance = fullText;
    this.emit('question', { text: fullText, audioEndSec: end, followOn });
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
