export type EphemeralRunnerShutdownSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP' | 'SIGBREAK';

export type EphemeralRunnerSignalSource = Readonly<{
  on(signal: EphemeralRunnerShutdownSignal, listener: () => void): unknown;
  off(signal: EphemeralRunnerShutdownSignal, listener: () => void): unknown;
}>;

/** One owner for every process-level endpoint exit request. */
export function bindEphemeralRunnerShutdown(input: Readonly<{
  requestClose(): Promise<'kept_open' | 'stopped'>;
  source?: EphemeralRunnerSignalSource;
}>): () => void {
  const source = input.source ?? process;
  let closeInFlight = false;
  let stopped = false;
  const requestStop = () => {
    if (closeInFlight || stopped) return;
    closeInFlight = true;
    void input.requestClose()
      .then((result) => {
        stopped = result === 'stopped';
      })
      .catch(() => undefined)
      .finally(() => {
        closeInFlight = false;
      });
  };
  const signals: readonly EphemeralRunnerShutdownSignal[] = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];
  for (const signal of signals) source.on(signal, requestStop);
  return () => {
    for (const signal of signals) source.off(signal, requestStop);
  };
}
