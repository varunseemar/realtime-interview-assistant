import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { QuestionDetector } from '../src/detection/questionDetector.js';

// Builds a detector with a fake classifier and records everything it emits.
function setup({ classifierSays = false } = {}) {
  const classified = [];
  const detector = new QuestionDetector({
    incompleteGraceMs: 20,
    classify: async (text) => {
      classified.push(text);
      return { isQuestion: classifierSays, question: text };
    },
  });
  const events = [];
  detector.on('question', (e) => events.push({ type: 'question', ...e }));
  detector.on('ignored', (e) => events.push({ type: 'ignored', ...e }));
  return { detector, events, classified };
}

const segment = (text, start, end, speechFinal = true) => ({ text, start, end, speechFinal });

describe('QuestionDetector', () => {
  it('fires on a short pause when the question is clear', () => {
    const { detector, events } = setup();
    detector.addFinal(segment('Tell me about yourself.', 0, 1.5));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'question');
    assert.equal(events[0].text, 'Tell me about yourself.');
    assert.equal(events[0].audioEndSec, 1.5);
  });

  it('joins segments that arrive before the pause', () => {
    const { detector, events } = setup();
    detector.addFinal(segment('So walk me through', 0, 1, false));
    detector.addFinal(segment('your last project.', 1, 2));
    assert.equal(events[0].text, 'So walk me through your last project.');
  });

  it('does not reject anything on a short pause alone', () => {
    const { detector, events } = setup();
    detector.addFinal(segment('Okay.', 0, 0.5));
    assert.equal(events.length, 0);
    detector.utteranceEnd();
    assert.equal(events[0].type, 'ignored');
    assert.equal(events[0].reason, 'filler');
  });

  it('ignores small talk at utterance end', () => {
    const { detector, events } = setup();
    detector.addFinal(segment('Hi, can you hear me okay?', 0, 1.2));
    detector.utteranceEnd();
    assert.deepEqual(events.map((e) => e.type), ['ignored']);
  });

  it('escalates ambiguous statements to the classifier', async () => {
    const { detector, events, classified } = setup({ classifierSays: true });
    detector.addFinal(segment('I am curious about the scaling work you did at Acme.', 0, 3));
    detector.utteranceEnd();
    await delay(0);
    assert.deepEqual(classified, ['I am curious about the scaling work you did at Acme.']);
    assert.equal(events[0].type, 'question');
  });

  it('ignores statements the classifier rejects', async () => {
    const { detector, events } = setup({ classifierSays: false });
    detector.addFinal(segment('Our team builds payment infrastructure for banks.', 0, 3));
    detector.utteranceEnd();
    await delay(0);
    assert.equal(events[0].type, 'ignored');
    assert.equal(events[0].reason, 'not_a_question');
  });

  it('waits for the rest of a sentence that trails off', async () => {
    const { detector, events } = setup();
    detector.addFinal(segment('Can you tell me about the', 0, 2));
    detector.utteranceEnd();
    detector.addFinal(segment('hardest bug you fixed?', 2.8, 4));
    assert.equal(events.length, 1);
    assert.equal(events[0].text, 'Can you tell me about the hardest bug you fixed?');
    await delay(40); // grace timer must have been cancelled
    assert.equal(events.length, 1);
  });

  it('merges a continuation that follows a fired question', async () => {
    const { detector, events } = setup();
    detector.addFinal(segment('How would you design a URL shortener?', 0, 2));
    detector.addFinal(segment('that handles a billion links a day.', 3, 5));
    detector.utteranceEnd();
    await delay(0);
    assert.equal(events.length, 2);
    assert.equal(events[1].followOn, true);
    assert.equal(events[1].text, 'How would you design a URL shortener? that handles a billion links a day.');
  });

  it('does not merge speech that starts long after the question', async () => {
    const { detector, events } = setup();
    detector.addFinal(segment('Tell me about yourself.', 0, 2));
    detector.addFinal(segment('Why do you want this role?', 40, 42));
    assert.equal(events[1].followOn, false);
    assert.equal(events[1].text, 'Why do you want this role?');
  });

  it('ignores an exact repeat of the last question', () => {
    const { detector, events } = setup();
    detector.addFinal(segment('Tell me about yourself.', 0, 2));
    detector.addFinal(segment('Tell me about yourself.', 30, 32));
    assert.equal(events[1].type, 'ignored');
    assert.equal(events[1].reason, 'duplicate');
  });

  it('forceQuestion answers the last ignored utterance', async () => {
    const { detector, events } = setup();
    detector.addFinal(segment('Kafka versus RabbitMQ.', 0, 2));
    detector.utteranceEnd();
    await delay(0);
    assert.equal(events[0].type, 'ignored');
    assert.equal(detector.forceQuestion(), true);
    assert.equal(events[1].type, 'question');
    assert.equal(events[1].text, 'Kafka versus RabbitMQ.');
    assert.equal(events[1].path, 'manual');
  });

  it('reports which rule fired', async () => {
    const { detector, events } = setup({ classifierSays: true });
    detector.addFinal(segment('Tell me about yourself.', 0, 2));
    detector.addFinal(segment('I am curious about the scaling work you did at Acme.', 30, 33));
    detector.utteranceEnd();
    await delay(0);
    assert.deepEqual(events.map((e) => e.path), ['pause', 'classifier']);
  });

  it('records when the final words arrived from STT', () => {
    let clock = 1000;
    const detector = new QuestionDetector({ classify: async () => ({ isQuestion: false }), now: () => clock });
    const events = [];
    detector.on('question', (e) => events.push(e));
    detector.addFinal(segment('So walk me through', 0, 1, false));
    clock = 1800;
    detector.addFinal(segment('your last project.', 1, 2));
    assert.equal(events[0].heardAt, 1800);
  });

  it('starts the classifier at the short pause and reuses it at the long gap', async () => {
    const { detector, events, classified } = setup({ classifierSays: true });
    detector.addFinal(segment('I am curious about the scaling work you did at Acme.', 0, 3));
    assert.equal(classified.length, 1, 'classifier should start before the long gap');
    detector.utteranceEnd();
    await delay(0);
    assert.equal(classified.length, 1, 'the speculative result should be reused');
    assert.equal(events[0].path, 'classifier');
  });

  it('discards a speculative result when the speaker kept talking', async () => {
    const { detector, classified } = setup({ classifierSays: false });
    detector.addFinal(segment('I am curious about the scaling work', 0, 2));
    detector.addFinal(segment('you did at Acme last year.', 2.2, 4));
    detector.utteranceEnd();
    await delay(0);
    assert.deepEqual(classified, [
      'I am curious about the scaling work',
      'I am curious about the scaling work you did at Acme last year.',
    ]);
  });

  it('classifies a trailing fragment once the extra wait expires', async () => {
    const { detector, events } = setup({ classifierSays: true });
    detector.addFinal(segment('What I want to understand is your experience with Kafka and', 0, 4));
    detector.utteranceEnd();
    await delay(40);
    assert.equal(events[0].path, 'wait+classifier');
  });
});
