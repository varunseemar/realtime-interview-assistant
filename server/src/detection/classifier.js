// LLM fallback for utterances the heuristics can't decide on.
// Bounded by a timeout: if the model is slow or errors, we fail closed (don't answer)
// because a wrong answer on screen is worse than a missed one — the UI has a manual override.

import { buildClassifierMessages } from '../llm/prompts.js';

const DEFAULT_TIMEOUT_MS = 1200;

export function createClassifier({ groq, model, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return async function classify(text) {
    try {
      const result = await groq.completeJson({
        model,
        messages: buildClassifierMessages(text),
        maxTokens: 200,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const question = typeof result.question === 'string' ? result.question.trim() : '';
      return { isQuestion: result.is_question === true, question: question || text };
    } catch (err) {
      console.warn(`[classifier] treating as not a question (${err.name}: ${err.message})`);
      return { isQuestion: false, question: text };
    }
  };
}
