// Pure, synchronous rules that classify a finished utterance from the interviewer.
// They are fast and free, so they run on every utterance; only the ambiguous
// "statement" verdict is escalated to the LLM classifier.
//
// analyze(text) -> { verdict, reason, text }
//   verdict: 'question'   – answer it
//            'noise'      – filler or small talk, ignore
//            'incomplete' – speaker probably isn't done (ends on "and", "the", ...)
//            'statement'  – no clear question cue; reason says whether it is too short

const MIN_WORDS = 3;

// An utterance made only of these words carries no question.
const FILLER_WORDS = new Set([
  'um', 'umm', 'uh', 'uhh', 'hmm', 'mm', 'mhm', 'mmhmm', 'ah', 'oh', 'okay', 'ok', 'right', 'yeah',
  'yes', 'yep', 'sure', 'great', 'cool', 'nice', 'alright', 'so', 'well', 'got', 'it', 'i', 'see',
  'perfect', 'awesome', 'thanks', 'thank', 'you', 'interesting', 'wow', 'good', 'fine', 'and', 'like',
  'makes', 'sense', 'that', 'sounds',
]);

// Sentences matching these are small talk / call logistics and get dropped.
const SMALL_TALK_PATTERNS = [
  /^(hi|hello|hey|good (morning|afternoon|evening))\b[^?]*$/, // greeting, unless it carries a question
  /\bcan you (hear|see) me\b/,
  /\bhow are you( doing)?( today)?\??$/,
  /\bhow('s| is) (it going|your day|everything)\b/,
  /\b(thanks|thank you)( so much)? for (joining|coming|your time|taking the time)\b/,
  /\bnice (to meet|meeting) you\b/,
  /\b(give|bear with) me (a|one) (sec|second|moment|minute)\b/,
  /\blet me (share my screen|pull up|find|check)\b/,
  /\byou('re| are) (on )?mute(d)?\b/,
  /\b(is|are) (my|the) (screen|audio|video|connection)\b/,
];

// If the utterance ends on one of these (and not with "?"), the speaker is mid-thought.
const TRAILING_CONTINUATIONS = new Set([
  'and', 'so', 'or', 'but', 'because', 'like', 'the', 'a', 'an', 'to', 'of', 'with', 'for', 'about',
  'your', 'my', 'is', 'are', 'was', 'that', 'which', 'if', 'then', 'when', 'what', 'how', 'um', 'uh',
]);

// Discourse words stripped before checking how a sentence starts.
const LEADING_FILLERS = new Set(['so', 'and', 'okay', 'ok', 'alright', 'now', 'well', 'great', 'cool', 'right', 'then', 'um', 'uh']);

const QUESTION_STARTERS = new Set([
  'what', "what's", 'why', 'how', "how's", 'when', 'where', 'which', 'who', 'whose', 'whom',
  'can', 'could', 'would', 'will', 'do', 'does', 'did', 'is', 'are', 'was', 'were', 'have', 'has',
  'should', 'tell', 'walk', 'describe', 'explain', 'give', 'share', 'talk', 'name', 'list', 'compare',
]);

// Interview prompts that are questions even without a question mark or a wh-word start.
// Bare "describe"/"explain" are left out on purpose ("let me explain how our team works");
// sentences that *start* with them are caught by QUESTION_STARTERS instead.
const PROMPT_PATTERN =
  /\b(tell (me|us) (about|more)|walk (me|us) through|talk (me|us) through|give (me|us) an example|share (an|a|some) |how (would|do|did|will|can) you|why (do|did|would|are|should) you|have you (ever )?|can you|could you|would you|i'?d (love|like) to (hear|know|understand)|i'?m curious)\b/;

export function normalize(text) {
  return (text ?? '').toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

const words = (text) => normalize(text).split(' ').filter(Boolean);

export function splitSentences(text) {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isFiller(sentence) {
  const w = words(sentence);
  return w.length === 0 || w.every((word) => FILLER_WORDS.has(word));
}

export function isSmallTalk(sentence) {
  const lower = sentence.toLowerCase().trim();
  return SMALL_TALK_PATTERNS.some((pattern) => pattern.test(lower));
}

export function endsIncomplete(text) {
  if (text.trim().endsWith('?')) return false;
  return TRAILING_CONTINUATIONS.has(words(text).at(-1));
}

export function isQuestionShaped(sentence) {
  if (sentence.trim().endsWith('?')) return true;
  const w = words(sentence);
  const first = w.find((word) => !LEADING_FILLERS.has(word));
  return QUESTION_STARTERS.has(first);
}

export function analyze(rawText) {
  const sentences = splitSentences(rawText ?? '').filter((s) => !isFiller(s) && !isSmallTalk(s));
  if (sentences.length === 0) {
    return { verdict: 'noise', reason: isFiller(rawText ?? '') ? 'filler' : 'small_talk', text: rawText };
  }

  const text = sentences.join(' ');

  if (endsIncomplete(text)) return { verdict: 'incomplete', reason: 'trailing_word', text };
  if (words(text).length < MIN_WORDS) return { verdict: 'statement', reason: 'too_short', text };

  if (isQuestionShaped(sentences.at(-1)) || PROMPT_PATTERN.test(text.toLowerCase())) {
    return { verdict: 'question', reason: 'question_cue', text };
  }
  return { verdict: 'statement', reason: 'no_question_cue', text };
}
