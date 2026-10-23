// Minimal client for Groq's OpenAI-compatible chat completions endpoint, using fetch.
// Two calls: streamChat (Server-Sent Events, token by token) and completeJson (one-shot JSON mode).

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// gpt-oss models "think" before answering. Low effort keeps that to a handful of tokens,
// and include_reasoning=false keeps the hidden reasoning out of the stream.
const REASONING_DEFAULTS = { reasoning_effort: 'low', include_reasoning: false };

export class GroqError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GroqError';
    this.status = status;
  }
}

function describeFailure(status, detail) {
  if (status === 401) return 'Groq rejected the API key. Check GROQ_API_KEY in server/.env.';
  if (status === 429) return 'Groq rate limit reached. Wait a few seconds and try again.';
  return `Groq request failed (HTTP ${status}): ${detail.slice(0, 200)}`;
}

export function createGroqClient({ apiKey }) {
  async function post(body, signal) {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...REASONING_DEFAULTS, ...body }),
      signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new GroqError(describeFailure(response.status, detail), response.status);
    }
    return response;
  }

  // Calls onToken(text) for every content delta; resolves with the full text.
  async function streamChat({ model, messages, maxTokens, temperature, signal, onToken }) {
    const response = await post(
      { model, messages, stream: true, max_completion_tokens: maxTokens, temperature },
      signal,
    );

    const decoder = new TextDecoder();
    let pending = '';
    let fullText = '';

    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop(); // last line may be incomplete

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice('data: '.length).trim();
        if (data === '[DONE]') return fullText;

        const event = JSON.parse(data);
        if (event.error) throw new GroqError(event.error.message ?? 'Groq stream error');
        const token = event.choices?.[0]?.delta?.content;
        if (token) {
          fullText += token;
          onToken(token);
        }
      }
    }
    return fullText;
  }

  async function completeJson({ model, messages, maxTokens, signal }) {
    const response = await post(
      { model, messages, max_completion_tokens: maxTokens, temperature: 0, response_format: { type: 'json_object' } },
      signal,
    );
    const body = await response.json();
    return JSON.parse(body.choices[0].message.content);
  }

  return { streamChat, completeJson };
}
