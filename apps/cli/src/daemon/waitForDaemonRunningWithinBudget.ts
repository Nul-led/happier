import type { ChildProcess } from 'node:child_process';

export function hasObservableDaemonStartProcessExited(
  child: Pick<ChildProcess, 'exitCode' | 'signalCode'>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  // Windows returns the short-lived PowerShell launcher rather than the
  // detached daemon process, so its exit cannot establish daemon failure.
  if (platform === 'win32') return false;
  return (
    child.exitCode !== null && child.exitCode !== undefined
  ) || (
    child.signalCode !== null && child.signalCode !== undefined
  );
}

export async function waitForDaemonRunningWithinBudget(params: {
  isRunning: () => Promise<boolean>;
  shouldAbort?: () => boolean;
  timeoutMs: number;
  pollMs: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  if (await params.isRunning()) return true;
  if (params.shouldAbort?.()) return false;

  const sleep =
    typeof params.sleep === 'function'
      ? params.sleep
      : (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  let remainingMs = params.timeoutMs;
  let nextPollMs = params.pollMs;
  while (remainingMs > 0) {
    const sleepMs = Math.min(nextPollMs, remainingMs);
    await sleep(sleepMs);
    remainingMs -= sleepMs;
    if (await params.isRunning()) return true;
    if (params.shouldAbort?.()) return false;
    // Startup can be slow under load. Keep the first readiness probe quick, then
    // match the stack's one-second lifecycle observation cadence on misses.
    nextPollMs = Math.min(nextPollMs * 2, 1_000);
  }

  return false;
}
