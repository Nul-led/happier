export type ServerFeaturesSnapshotRefreshLoop = Readonly<{
  stop(): void;
}>;

/**
 * Runs the daemon's single server-feature refresh timer. Each completed refresh schedules exactly
 * one successor so an active transition can shorten the next wait without creating a second
 * poller or overlapping interval ticks.
 */
export function startServerFeaturesSnapshotRefreshLoop(params: Readonly<{
  refresh(): Promise<void>;
  isTransitionActive(): boolean;
  transitionIntervalMs: number;
  stableIntervalMs: number;
  onError?: (error: unknown) => void;
}>): ServerFeaturesSnapshotRefreshLoop {
  let stopped = false;
  let timeout: NodeJS.Timeout | null = null;

  const scheduleNext = () => {
    if (stopped) return;
    const delayMs = params.isTransitionActive()
      ? params.transitionIntervalMs
      : params.stableIntervalMs;
    timeout = setTimeout(() => {
      timeout = null;
      void refreshAndSchedule();
    }, delayMs);
    timeout.unref?.();
  };
  const refreshAndSchedule = async (): Promise<void> => {
    try {
      await params.refresh();
    } catch (error) {
      params.onError?.(error);
    } finally {
      scheduleNext();
    }
  };

  void refreshAndSchedule();

  return {
    stop() {
      stopped = true;
      if (timeout) clearTimeout(timeout);
      timeout = null;
    },
  };
}
