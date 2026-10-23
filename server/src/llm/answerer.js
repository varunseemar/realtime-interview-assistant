// Streams a short, speakable answer for a detected question.

import { buildAnswerMessages } from './prompts.js';

// Generous cap: hidden reasoning tokens count against it too. Prompt keeps answers ~90 words.
const MAX_COMPLETION_TOKENS = 450;
const TEMPERATURE = 0.4;

export function createAnswerer({ groq, model }) {
  return function streamAnswer({ question, context, history, signal, onToken }) {
    return groq.streamChat({
      model,
      messages: buildAnswerMessages({ question, context, history }),
      maxTokens: MAX_COMPLETION_TOKENS,
      temperature: TEMPERATURE,
      signal,
      onToken,
    });
  };
}
