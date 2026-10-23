// Owns the WebSocket to the backend and turns server events into UI state.

import { useCallback, useReducer, useRef } from 'react';
import { ServerMsg, Status } from '../protocol.js';

const initialState = {
  status: Status.IDLE,
  finals: [], // [{ id, text }] confirmed transcript segments
  interim: '', // current in-progress segment, replaced on every update
  question: null, // { id, text }
  answer: '',
  error: null,
};

function applyServerMessage(state, msg) {
  switch (msg.type) {
    case ServerMsg.STATUS:
      return { ...state, status: msg.state };
    case ServerMsg.TRANSCRIPT_INTERIM:
      return { ...state, interim: msg.text };
    case ServerMsg.TRANSCRIPT_FINAL:
      return {
        ...state,
        interim: '',
        finals: [...state.finals, { id: state.finals.length, text: msg.text }],
      };
    case ServerMsg.ERROR:
      return { ...state, error: msg.message };
    default:
      return state;
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'reset':
      return { ...initialState };
    case 'server':
      return applyServerMessage(state, action.msg);
    case 'closed':
      return { ...state, status: action.unexpected ? Status.ERROR : Status.IDLE, interim: '' };
    case 'error':
      return { ...state, status: Status.ERROR, error: action.message };
    default:
      return state;
  }
}

function socketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function useInterviewSocket() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef(null);
  const closingRef = useRef(false);

  const connect = useCallback(
    ({ onUnexpectedClose } = {}) =>
      new Promise((resolve, reject) => {
        dispatch({ type: 'reset' });
        closingRef.current = false;
        const ws = new WebSocket(socketUrl());
        wsRef.current = ws;
        let opened = false;

        ws.addEventListener('open', () => {
          opened = true;
          resolve();
        });

        ws.addEventListener('message', (event) => {
          let msg;
          try {
            msg = JSON.parse(event.data);
          } catch {
            return;
          }
          dispatch({ type: 'server', msg });
        });

        ws.addEventListener('close', () => {
          wsRef.current = null;
          if (!opened) {
            reject(new Error('Could not reach the server. Is it running on port 8080?'));
            return;
          }
          const unexpected = !closingRef.current;
          dispatch({ type: 'closed', unexpected });
          if (unexpected) {
            dispatch({ type: 'error', message: 'Lost connection to the server.' });
            onUnexpectedClose?.();
          }
        });
      }),
    [],
  );

  const sendJson = useCallback((type, payload = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...payload }));
    }
  }, []);

  const sendBinary = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(data);
  }, []);

  const disconnect = useCallback(() => {
    closingRef.current = true;
    wsRef.current?.close();
  }, []);

  const reportError = useCallback((message) => dispatch({ type: 'error', message }), []);

  return { state, connect, sendJson, sendBinary, disconnect, reportError };
}
