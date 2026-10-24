import { useCallback, useState } from 'react';
import { AnswerPanel } from './components/AnswerPanel.jsx';
import { ContextForm } from './components/ContextForm.jsx';
import { QuestionPanel } from './components/QuestionPanel.jsx';
import { StatusBar } from './components/StatusBar.jsx';
import { TranscriptPanel } from './components/TranscriptPanel.jsx';
import { CHUNK_MS, useAudioCapture } from './hooks/useAudioCapture.js';
import { useInterviewSocket } from './hooks/useInterviewSocket.js';
import { useLocalStorage } from './hooks/useLocalStorage.js';
import { ClientMsg } from './protocol.js';

export default function App() {
  const [source, setSource] = useState('tab');
  const [running, setRunning] = useState(false);
  const [context, setContext] = useLocalStorage('interview-context', { resume: '', jd: '' });
  const contextReady = Boolean(context.resume.trim() || context.jd.trim());
  const [showContext, setShowContext] = useState(!contextReady);

  const capture = useAudioCapture();
  const { state, connect, sendJson, sendBinary, disconnect, reportError } = useInterviewSocket();

  const stop = useCallback(() => {
    capture.stop();
    sendJson(ClientMsg.STOP);
    disconnect();
    setRunning(false);
  }, [capture, sendJson, disconnect]);

  // Order matters: the permission prompt must come straight from the click, and the
  // recorder only starts once the server has a Deepgram stream ready for the audio.
  const start = useCallback(async () => {
    try {
      await capture.open(source, { onEnded: stop });
      await connect({
        onUnexpectedClose: () => {
          capture.stop();
          setRunning(false);
        },
      });
      sendJson(ClientMsg.START, { source, resume: context.resume, jd: context.jd, chunkMs: CHUNK_MS });
      capture.record({
        onChunk: sendBinary,
        // Browser-side silence detection lets the server finalize the transcript without
        // waiting for Deepgram's own endpointing.
        onSpeechEnd: () => sendJson(ClientMsg.SPEECH_END),
      });
      setRunning(true);
      setShowContext(false);
    } catch (err) {
      capture.stop();
      disconnect();
      reportError(err.message);
    }
  }, [capture, source, stop, connect, sendJson, sendBinary, disconnect, reportError, context]);

  const ask = useCallback((text) => sendJson(ClientMsg.MANUAL_QUESTION, { text }), [sendJson]);
  const answerLast = useCallback(() => sendJson(ClientMsg.MANUAL_QUESTION, {}), [sendJson]);

  return (
    <div className="app">
      <StatusBar
        status={state.status}
        running={running}
        source={source}
        onSourceChange={setSource}
        onStart={start}
        onStop={stop}
        contextReady={contextReady}
        onToggleContext={() => setShowContext((open) => !open)}
        metrics={state.metrics}
        level={capture.level}
      />

      {state.error && (
        <div className="error-banner" role="alert">
          {state.error}
        </div>
      )}

      {running && capture.quiet && (
        <div className="warning-banner" role="status">
          {source === 'tab'
            ? "No audio from the shared tab yet. Tab audio only contains what the tab plays (the other people in the call), not your own microphone. Make sure someone is speaking there and that \"Share tab audio\" was ticked."
            : 'No audio from the microphone yet. Check that the right mic is selected and not muted.'}
        </div>
      )}

      {showContext && (
        <ContextForm
          context={context}
          onChange={setContext}
          running={running}
          onClose={() => setShowContext(false)}
        />
      )}

      <main className="layout">
        <TranscriptPanel items={state.transcript} interim={state.interim} />
        <div className="right-column">
          <QuestionPanel question={state.question} running={running} onAsk={ask} onAnswerLast={answerLast} />
          <AnswerPanel
            question={state.question}
            answer={state.answer}
            answerDone={state.answerDone}
            history={state.history}
          />
        </div>
      </main>
    </div>
  );
}
