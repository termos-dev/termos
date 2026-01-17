import { Box, Text, useInput, useApp } from 'ink';
import { useState, useEffect } from 'react';
import { readFileSync, existsSync } from 'fs';
import { useFileWatch } from './shared/index.js';

declare const onComplete: (result: unknown) => void;
declare const args: {
  title?: string;
  steps?: string;      // comma-separated step names
  tasks?: string;      // alias for steps
  items?: string;      // alias for steps
  step?: string;       // current step (1-indexed)
  status?: string;     // status message
  stateFile?: string;  // file to watch for state updates
  'no-header'?: boolean; // Hide header when pane host shows title
};

interface StepState {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export default function Progress() {
  const { exit } = useApp();

  const title = args?.title || 'Progress';
  const stepNames = (args?.steps || args?.tasks || args?.items)?.split(',').map(s => s.trim()).filter(Boolean) || ['Step 1', 'Step 2', 'Step 3'];
  const initialStep = args?.step ? parseInt(args.step, 10) : 1;
  const initialStatus = args?.status || '';

  const [steps, setSteps] = useState<StepState[]>(
    stepNames.map((name, i) => ({
      name,
      status: i < initialStep - 1 ? 'done' : i === initialStep - 1 ? 'running' : 'pending',
    }))
  );
  const [currentMessage, setCurrentMessage] = useState(initialStatus);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Spinner animation
  useEffect(() => {
    const interval = setInterval(() => {
      setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  // Watch state file for updates
  const stateFile = args?.stateFile && existsSync(args.stateFile) ? args.stateFile : undefined;
  useFileWatch(stateFile, () => {
    if (!args?.stateFile) return;

    try {
      const content = readFileSync(args.stateFile, 'utf-8');
      const state = JSON.parse(content);

      if (state.step !== undefined) {
        setSteps(prev => prev.map((s, i) => ({
          ...s,
          status: i < state.step - 1 ? 'done' : i === state.step - 1 ? 'running' : 'pending',
        })));
      }
      if (state.status) {
        setCurrentMessage(state.status);
      }
      if (state.done) {
        setSteps(prev => prev.map(s => ({ ...s, status: 'done' })));
        onComplete({
          action: 'accept',
          completed: stepNames,
          current: null,
        });
        exit();
      }
      if (state.error) {
        const errorStep = state.step ? state.step - 1 : steps.findIndex(s => s.status === 'running');
        setSteps(prev => prev.map((s, i) => ({
          ...s,
          status: i === errorStep ? 'error' : s.status,
        })));
        setCurrentMessage(state.error);
      }
    } catch {
      // Ignore parse errors
    }
  }, { interval: 500 });

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      const completed = steps.filter(s => s.status === 'done').map(s => s.name);
      const current = steps.find(s => s.status === 'running')?.name || null;
      onComplete({
        action: 'cancel',
        completed,
        current,
      });
      exit();
      return;
    }
  });

  const completedCount = steps.filter(s => s.status === 'done').length;
  const progress = Math.round((completedCount / steps.length) * 100);
  const progressBarWidth = 20;
  const filledWidth = Math.round((completedCount / steps.length) * progressBarWidth);

  return (
    <Box flexDirection="column" paddingX={1}>
      {!args?.['no-header'] && (
        <Box marginBottom={1}>
          <Text bold color="cyan">{title}</Text>
          <Text dimColor> ({completedCount}/{steps.length})</Text>
        </Box>
      )}

      {/* Progress bar */}
      <Box marginBottom={1}>
        <Text color="green">{'█'.repeat(filledWidth)}</Text>
        <Text dimColor>{'░'.repeat(progressBarWidth - filledWidth)}</Text>
        <Text> {progress}%</Text>
      </Box>

      {/* Steps */}
      <Box flexDirection="column">
        {steps.map((step, idx) => {
          let icon: string;
          let color: string | undefined;

          switch (step.status) {
            case 'done':
              icon = '✓';
              color = 'green';
              break;
            case 'running':
              icon = SPINNER_FRAMES[spinnerFrame];
              color = 'cyan';
              break;
            case 'error':
              icon = '✗';
              color = 'red';
              break;
            default:
              icon = '○';
              color = 'gray';
          }

          return (
            <Box key={idx}>
              <Text color={color}>{icon} </Text>
              <Text color={step.status === 'pending' ? 'gray' : undefined}>
                {step.name}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Current status message */}
      {currentMessage && (
        <Box marginTop={1}>
          <Text dimColor>{currentMessage}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>q=cancel</Text>
      </Box>
    </Box>
  );
}
