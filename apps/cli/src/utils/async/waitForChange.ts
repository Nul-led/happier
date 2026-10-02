/** Producer-owned notification wait; the caller owns its complete lifetime. */
export function waitForChange(params: Readonly<{
  subscribe: (wake: () => void) => () => void;
  hasChanged: () => boolean;
  signal?: AbortSignal;
}>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    const dispose = () => {
      unsubscribe();
      params.signal?.removeEventListener('abort', abort);
    };
    const wake = () => { dispose(); resolve(); };
    const abort = () => { dispose(); reject(params.signal?.reason); };
    unsubscribe = params.subscribe(wake);
    params.signal?.addEventListener('abort', abort, { once: true });
    if (params.signal?.aborted) abort();
    else if (params.hasChanged()) wake();
  });
}
