import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyze } from '../src/detection/heuristics.js';

const verdictOf = (text) => analyze(text).verdict;

describe('analyze', () => {
  it('accepts direct questions', () => {
    assert.equal(verdictOf('Why do you want to work here?'), 'question');
    assert.equal(verdictOf('What is the difference between let and const?'), 'question');
  });

  it('accepts questions the STT did not punctuate', () => {
    assert.equal(verdictOf('how would you design a rate limiter'), 'question');
  });

  it('accepts imperative interview prompts', () => {
    assert.equal(verdictOf('Tell me about yourself.'), 'question');
    assert.equal(verdictOf('Walk me through your last project.'), 'question');
    assert.equal(verdictOf('So, describe a time you disagreed with a teammate.'), 'question');
    assert.equal(verdictOf("I'd love to hear how you handled scaling there."), 'question');
  });

  it('ignores filler', () => {
    assert.equal(verdictOf('Okay.'), 'noise');
    assert.equal(verdictOf('Um, yeah, got it. Makes sense.'), 'noise');
  });

  it('ignores small talk and logistics', () => {
    assert.equal(verdictOf('Hi, can you hear me okay?'), 'noise');
    assert.equal(verdictOf('Hello, how are you doing today?'), 'noise');
    assert.equal(verdictOf('Thanks for joining. Give me a second.'), 'noise');
  });

  it('strips small talk but keeps the question that follows it', () => {
    const result = analyze('Hi, thanks for joining. So tell me about yourself.');
    assert.equal(result.verdict, 'question');
    assert.equal(result.text, 'So tell me about yourself.');
  });

  it('keeps a greeting that carries a question', () => {
    assert.equal(verdictOf("Hi, what's your background?"), 'question');
  });

  it('waits when the speaker trails off', () => {
    assert.equal(verdictOf('Can you tell me about the'), 'incomplete');
    assert.equal(verdictOf('So what I want to understand is your experience with Kafka and.'), 'incomplete');
  });

  it('does not treat a trailing preposition before "?" as incomplete', () => {
    assert.equal(verdictOf('What are you working on?'), 'question');
  });

  it('treats interviewer statements as ambiguous, not questions', () => {
    assert.equal(verdictOf('Let me explain how our team works.'), 'statement');
    assert.equal(verdictOf('Our team builds payment infrastructure for banks.'), 'statement');
  });

  it('flags very short fragments', () => {
    assert.deepEqual(
      { verdict: analyze('Your resume.').verdict, reason: analyze('Your resume.').reason },
      { verdict: 'statement', reason: 'too_short' },
    );
  });
});
