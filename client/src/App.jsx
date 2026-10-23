import { useCallback, useState } from 'react';
import { AnswerPanel } from './components/AnswerPanel.jsx';
import { QuestionPanel } from './components/QuestionPanel.jsx';
import { StatusBar } from './components/StatusBar.jsx';
import { TranscriptPanel } from './components/TranscriptPanel.jsx';
import { useAudioCapture } from './hooks/useAudioCapture.js';
import { useInterviewSocket } from './hooks/useInterviewSocket.js';
import { ClientMsg } from './protocol.js';

export default function App() {
  const [source, setSource] = useState('tab');
  const [running, setRunning] = useState(false);
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
      sendJson(ClientMsg.START, { source });
      capture.record(sendBinary);
      setRunning(true);
    } catch (err) {
      capture.stop();
      disconnect();
      reportError(err.message);
    }
  }, [capture, source, stop, connect, sendJson, sendBinary, disconnect, reportError]);

  return (
    <div className="app">
      <StatusBar
        status={state.status}
        running={running}
        source={source}
        onSourceChange={setSource}
        onStart={start}
        onStop={stop}
      />

      {state.error && (
        <div className="error-banner" role="alert">
          {state.error}
        </div>
      )}

      <main className="layout">
        <TranscriptPanel finals={state.finals} interim={state.interim} />
        <div className="right-column">
          <QuestionPanel question={state.question} />
          <AnswerPanel answer={state.answer} />
        </div>
      </main>
    </div>
  );
}
