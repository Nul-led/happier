/** Hermes AbortSignal implementations need not implement throwIfAborted(). */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('Operation aborted'), { name: 'AbortError' });
}
