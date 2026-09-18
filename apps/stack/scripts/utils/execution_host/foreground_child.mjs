import { spawn } from 'node:child_process';

function defaultBoundary() {
  return {
    spawn(command, args, options) {
      return spawn(command, args, options);
    },
    onSignal(handler) {
      const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
      for (const signal of signals) process.on(signal, handler);
      return () => {
        for (const signal of signals) process.off(signal, handler);
      };
    },
  };
}

export async function runForegroundChild({ command, args, options, boundary = defaultBoundary() }) {
  const child = boundary.spawn(command, args, options);
  const removeSignalHandlers = boundary.onSignal((signal) => {
    try {
      child.kill(signal);
    } catch {
      // The child may already have reached its terminal state.
    }
  });
  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      child.once('error', rejectPromise);
      child.once('close', (exitCode, signal) => resolvePromise({ exitCode, signal }));
    });
  } finally {
    removeSignalHandlers();
  }
}
