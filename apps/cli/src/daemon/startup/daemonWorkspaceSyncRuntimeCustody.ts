type StoppableRuntime = Readonly<{ stop(): Promise<void> }>;

export type DaemonWorkspaceSyncRuntimeCustody<Runtime extends StoppableRuntime> = Readonly<{
  acquire(machineId: string, create: () => Promise<Runtime>): Promise<Runtime>;
  get(): Runtime | null;
  stop(): Promise<void>;
}>;

/** Owns the one daemon workspace-sync runtime until its stop succeeds. */
export function createDaemonWorkspaceSyncRuntimeCustody<Runtime extends StoppableRuntime>(): DaemonWorkspaceSyncRuntimeCustody<Runtime> {
  let active: Readonly<{ machineId: string; runtime: Runtime }> | null = null;
  let acquisition: Readonly<{ machineId: string; promise: Promise<Runtime> }> | null = null;
  let stopInFlight: Promise<void> | null = null;

  const stop = async (): Promise<void> => {
    const pendingAcquisition = acquisition;
    if (pendingAcquisition) {
      await pendingAcquisition.promise.catch(() => undefined);
      return await stop();
    }
    if (stopInFlight) return await stopInFlight;
    const current = active;
    if (!current) return;
    const attempt = current.runtime.stop().then(() => {
      if (active === current) active = null;
    });
    stopInFlight = attempt;
    try {
      await attempt;
    } finally {
      if (stopInFlight === attempt) stopInFlight = null;
    }
  };

  const acquire = async (machineId: string, create: () => Promise<Runtime>): Promise<Runtime> => {
    if (active?.machineId === machineId && !stopInFlight) return active.runtime;
    if (acquisition?.machineId === machineId) return await acquisition.promise;
    if (acquisition) {
      await acquisition.promise;
      return await acquire(machineId, create);
    }
    const promise = (async () => {
      await stop();
      const runtime = await create();
      active = { machineId, runtime };
      return runtime;
    })();
    acquisition = { machineId, promise };
    try {
      return await promise;
    } finally {
      if (acquisition?.promise === promise) acquisition = null;
    }
  };

  return Object.freeze({ acquire, get: () => active?.runtime ?? null, stop });
}
