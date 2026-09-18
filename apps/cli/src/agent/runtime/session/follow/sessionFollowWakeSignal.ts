/**
 * Content-free, process-local invalidation for Follow wake reconciliation.
 * It carries no source identity or authority: every awakened destination must
 * re-observe, hydrate, authorize and fence the durable edge before admission.
 */
const waiters = new Set<() => void>();
let generation = 0;

export function publishSessionFollowWakeInvalidation(): void {
  generation += 1;
  for (const wake of [...waiters]) wake();
}

export function readSessionFollowWakeInvalidationGeneration(): number {
  return generation;
}

export function waitForSessionFollowWakeInvalidation(
  afterGeneration: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (generation !== afterGeneration) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (changed: boolean) => {
      waiters.delete(onWake);
      signal.removeEventListener('abort', onAbort);
      resolve(changed);
    };
    const onWake = () => finish(true);
    const onAbort = () => finish(false);
    waiters.add(onWake);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
