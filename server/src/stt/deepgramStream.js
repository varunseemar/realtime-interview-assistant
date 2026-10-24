// Thin wrapper around Deepgram's live transcription WebSocket.
// We talk to the raw WebSocket API instead of the SDK: the protocol is small
// (send audio bytes, receive JSON events) and this keeps every step visible.
//
// Silence-triggered finalize: Deepgram sometimes keeps a phrase "interim" for several seconds
// after the speaker stops (seen with sentences ending on "and", and with noisy call audio),
// which delays both its final result and its UtteranceEnd. Interim results carry word
// timings, so we can see the silence ourselves: once the last word is SILENCE_FINALIZE_SEC
// old, we send a Finalize message and Deepgram returns the final result immediately.
//
// Emits:
//   'open'
//   'transcript'   { text, isFinal, speechFinal, fromFinalize, start, end }
//                  (seconds of audio; `end` is the last *word's* end, not the trailing silence)
//   'utteranceEnd' { lastWordEnd }                              (silence gap detected)
//   'speechStarted'
//   'error'        Error
//   'close'        { code, reason, expected }

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';
const KEEPALIVE_MS = 5000; // Deepgram closes the stream after ~10s without data.
const CLOSE_TIMEOUT_MS = 3000; // How long to wait for Deepgram to flush after CloseStream.
const MAX_PENDING_CHUNKS = 100; // ~25s of 250ms chunks buffered while connecting.
const SILENCE_FINALIZE_SEC = 0.8; // trailing silence (in audio) that forces a final result

// No `encoding` param: the browser sends containerised webm/opus, which Deepgram auto-detects.
const DEFAULT_PARAMS = {
  model: 'nova-3',
  language: 'en',
  interim_results: 'true', // partial words while the person is still talking
  smart_format: 'true', // punctuation, casing, numbers
  endpointing: '300', // ms of silence before a segment is marked speech_final
  utterance_end_ms: '1000', // word-gap based end-of-utterance event, robust to background noise
  vad_events: 'true', // SpeechStarted events
};

// DEBUG_STT=1 prints every Deepgram event with its audio timestamps, for diagnosing latency.
const DEBUG = process.env.DEBUG_STT === '1';

function logEvent(msg) {
  const time = new Date().toISOString().slice(11, 23);
  if (msg.type === 'Results') {
    const flags = `${msg.is_final ? 'final' : 'interim'}${msg.speech_final ? '+speech_final' : ''}${msg.from_finalize ? '+from_finalize' : ''}`;
    const end = (msg.start + msg.duration).toFixed(2);
    console.log(`[stt ${time}] ${flags.padEnd(26)} audio ${msg.start.toFixed(2)}-${end}s "${msg.channel?.alternatives?.[0]?.transcript ?? ''}"`);
  } else {
    console.log(`[stt ${time}] ${msg.type}${msg.last_word_end != null ? ` last_word_end=${msg.last_word_end}` : ''}`);
  }
}

function describeError(err) {
  if (/\b401\b/.test(err.message)) return new Error('Deepgram rejected the API key. Check DEEPGRAM_API_KEY in server/.env.');
  if (/\b402\b/.test(err.message)) return new Error('Deepgram account is out of credit.');
  return err;
}

export class DeepgramStream extends EventEmitter {
  #apiKey;
  #params;
  #ws = null;
  #pending = [];
  #keepAliveTimer = null;
  #closeTimer = null;
  #closing = false;
  #finalizeSentFor = null; // interim text we already forced, so we ask only once
  #pendingInterim = ''; // latest interim text not yet covered by a final result

  constructor({ apiKey, params = {} }) {
    super();
    this.#apiKey = apiKey;
    this.#params = { ...DEFAULT_PARAMS, ...params };
  }

  connect() {
    const url = `${DEEPGRAM_URL}?${new URLSearchParams(this.#params)}`;
    const ws = new WebSocket(url, { headers: { Authorization: `Token ${this.#apiKey}` } });
    this.#ws = ws;

    ws.on('open', () => {
      // The first queued chunk carries the webm header, so order matters here.
      for (const chunk of this.#pending) ws.send(chunk);
      this.#pending = [];
      this.#keepAliveTimer = setInterval(() => this.#sendControl('KeepAlive'), KEEPALIVE_MS);
      this.emit('open');
    });

    ws.on('message', (data) => this.#handleMessage(data));
    ws.on('error', (err) => this.emit('error', describeError(err)));
    ws.on('close', (code, reason) => {
      clearInterval(this.#keepAliveTimer);
      clearTimeout(this.#closeTimer);
      this.emit('close', { code, reason: reason.toString(), expected: this.#closing });
    });
  }

  send(chunk) {
    if (this.#closing || !this.#ws) return;
    if (this.#ws.readyState === WebSocket.OPEN) {
      this.#ws.send(chunk);
    } else if (this.#ws.readyState === WebSocket.CONNECTING && this.#pending.length < MAX_PENDING_CHUNKS) {
      this.#pending.push(chunk);
    }
  }

  // Ask Deepgram to flush any remaining transcript, then close.
  finish() {
    if (this.#closing || !this.#ws) return;
    this.#closing = true;
    if (this.#ws.readyState === WebSocket.OPEN) {
      this.#sendControl('CloseStream');
      this.#closeTimer = setTimeout(() => this.#ws.terminate(), CLOSE_TIMEOUT_MS);
    } else {
      this.#ws.terminate();
    }
  }

  // Called when the browser's voice-activity detector hears the speaker stop. Only acts if
  // Deepgram is still holding unfinalized words; otherwise there's nothing to flush.
  finalizePending() {
    if (this.#pendingInterim) this.#forceFinal(this.#pendingInterim);
  }

  #forceFinal(text) {
    if (this.#finalizeSentFor === text) return;
    this.#finalizeSentFor = text;
    if (DEBUG) console.log(`[stt ${new Date().toISOString().slice(11, 23)}] -> Finalize`);
    this.#sendControl('Finalize');
  }

  #sendControl(type) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify({ type }));
  }

  #handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (DEBUG) logEvent(msg);

    switch (msg.type) {
      case 'Results': {
        const alternative = msg.channel?.alternatives?.[0];
        const text = alternative?.transcript ?? '';
        const audioEnd = msg.start + msg.duration;
        const lastWordEnd = alternative?.words?.at(-1)?.end;

        if (msg.is_final) {
          this.#finalizeSentFor = null;
          this.#pendingInterim = '';
        } else if (text) {
          this.#pendingInterim = text;
          if (lastWordEnd != null && audioEnd - lastWordEnd >= SILENCE_FINALIZE_SEC) this.#forceFinal(text);
        }

        this.emit('transcript', {
          text,
          isFinal: Boolean(msg.is_final),
          speechFinal: Boolean(msg.speech_final),
          fromFinalize: Boolean(msg.from_finalize),
          start: msg.start,
          end: lastWordEnd ?? audioEnd,
        });
        break;
      }
      case 'UtteranceEnd':
        this.emit('utteranceEnd', { lastWordEnd: msg.last_word_end });
        break;
      case 'SpeechStarted':
        this.emit('speechStarted');
        break;
      default:
        // 'Metadata' and other informational messages are ignored.
        break;
    }
  }
}
