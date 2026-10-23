// Thin wrapper around Deepgram's live transcription WebSocket.
// We talk to the raw WebSocket API instead of the SDK: the protocol is small
// (send audio bytes, receive JSON events) and this keeps every step visible.
//
// Emits:
//   'open'
//   'transcript'   { text, isFinal, speechFinal, start, end }   (times in seconds of audio)
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

    switch (msg.type) {
      case 'Results': {
        const alternative = msg.channel?.alternatives?.[0];
        this.emit('transcript', {
          text: alternative?.transcript ?? '',
          isFinal: Boolean(msg.is_final),
          speechFinal: Boolean(msg.speech_final),
          start: msg.start,
          end: msg.start + msg.duration,
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
