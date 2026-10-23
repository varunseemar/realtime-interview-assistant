import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAnswerMessages, isBehavioral } from '../src/llm/prompts.js';

describe('isBehavioral', () => {
  it('recognises behavioral prompts', () => {
    assert.equal(isBehavioral('Tell me about a time you had a conflict with a teammate.'), true);
    assert.equal(isBehavioral('Describe a situation where you missed a deadline.'), true);
    assert.equal(isBehavioral('Have you ever had to learn something quickly?'), true);
  });

  it('leaves other questions alone', () => {
    assert.equal(isBehavioral('Tell me about yourself.'), false);
    assert.equal(isBehavioral('How would you design a rate limiter?'), false);
  });
});

describe('buildAnswerMessages', () => {
  const context = { resume: 'Built a chat app at Acme.', jd: 'Realtime engineer.' };

  it('puts resume and JD in the system prompt as delimited data', () => {
    const [system] = buildAnswerMessages({ question: 'Why this role?', context });
    assert.match(system.content, /<resume>\nBuilt a chat app at Acme\.\n<\/resume>/);
    assert.match(system.content, /<job_description>\nRealtime engineer\.\n<\/job_description>/);
  });

  it('replays history before the new question', () => {
    const messages = buildAnswerMessages({
      question: 'And how did you measure that?',
      context,
      history: [{ question: 'Tell me about Acme.', answer: '- I built a chat app.' }],
    });
    assert.deepEqual(
      messages.map((m) => m.role),
      ['system', 'user', 'assistant', 'user'],
    );
    assert.match(messages.at(-1).content, /^Interviewer: And how did you measure that\?/);
  });
});
