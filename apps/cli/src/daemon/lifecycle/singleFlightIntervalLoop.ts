export type SingleFlightIntervalLoopHandle = Readonly<{
  stop: () => Promise<void>;
  trigger: () => void;
  pause: () => void;
  resume: () => void;
}>;

export function startSingleFlightIntervalLoop(args: Readonly<{
  intervalMs: number;
  task: (signal: AbortSignal) => void | { nextAutomaticRunAfterMs: number } | Promise<void | { nextAutomaticRunAfterMs: number }>;
  onError?: (error: unknown) => void;
  unref?: boolean;
  failureBackoffMs?: number;
  maxFailureBackoffMs?: number;
}>): SingleFlightIntervalLoopHandle {
  let stopped = false;
  let inFlight = false;
  let paused = false;
  let pendingForcedRerun = false;
  let failureCount = 0;
  let nextAutomaticRunAtMs = 0;
  let activeRun: Promise<void> | null = null;
  const abortController = new AbortController();
  const intervalMs = Math.max(1, Math.floor(args.intervalMs));
  const failureBackoffMs = Math.max(0, Math.floor(args.failureBackoffMs ?? 0));
  const maxFailureBackoffMs = Math.max(
    failureBackoffMs,
    Math.floor(args.maxFailureBackoffMs ?? failureBackoffMs),
  );

  const runOnce = (options: Readonly<{ force?: boolean }> = {}) => {
    if (stopped) return;
    if (paused) return;
    if (inFlight) {
      // An explicit trigger while a run is in flight coalesces into exactly
      // one forced rerun once that run settles; stop/pause prevents it.
      if (options.force) pendingForcedRerun = true;
      return;
    }
    if (!options.force && Date.now() < nextAutomaticRunAtMs) return;

    inFlight = true;
    activeRun = Promise.resolve()
      .then(() => args.task(abortController.signal))
      .then((result) => {
        failureCount = 0;
        nextAutomaticRunAtMs = typeof result?.nextAutomaticRunAfterMs === 'number'
          && Number.isFinite(result.nextAutomaticRunAfterMs)
          && result.nextAutomaticRunAfterMs > 0
          ? Date.now() + Math.floor(result.nextAutomaticRunAfterMs)
          : 0;
      })
      .catch((error) => {
        if (failureBackoffMs > 0) {
          const multiplier = Math.max(1, 2 ** failureCount);
          const delayMs = Math.min(maxFailureBackoffMs, failureBackoffMs * multiplier);
          failureCount += 1;
          nextAutomaticRunAtMs = Date.now() + delayMs;
        }
        args.onError?.(error);
      })
      .finally(() => {
        inFlight = false;
        activeRun = null;
        if (pendingForcedRerun) {
          pendingForcedRerun = false;
          runOnce({ force: true });
        }
      });
  };

  const timer = setInterval(runOnce, intervalMs);
  if (args.unref === true) {
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  return {
    stop: async () => {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
        abortController.abort();
      }
      await activeRun;
    },
    trigger: () => {
      runOnce({ force: true });
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
  };
}
