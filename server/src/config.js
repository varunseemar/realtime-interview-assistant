// Reads configuration from environment variables (loaded from server/.env by
// `node --env-file-if-exists`). Fails fast with a readable message if a key is missing.

const REQUIRED = ['DEEPGRAM_API_KEY', 'GROQ_API_KEY'];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `[config] Missing required environment variables: ${missing.join(', ')}.\n` +
      '         Copy server/.env.example to server/.env and fill in your keys.',
  );
  process.exit(1);
}

export const config = Object.freeze({
  port: Number(process.env.PORT) || 8080,
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  answerModel: process.env.GROQ_ANSWER_MODEL || 'openai/gpt-oss-20b',
  classifierModel: process.env.GROQ_CLASSIFIER_MODEL || 'openai/gpt-oss-20b',
});
