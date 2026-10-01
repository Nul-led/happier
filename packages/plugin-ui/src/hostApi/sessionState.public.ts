import * as React from 'react';
import type { SessionStateV1 } from '@happier-dev/plugin-sdk/ui';

import { usePluginHostApi } from './context.js';

/**
 * One mounted read of a Session's live state.
 *
 * - `loading`: the first read has not settled.
 * - `ready`: `state` is the current host snapshot.
 * - `unavailable`: this Account cannot reach the Session, or the read failed.
 * - `unsupported`: the mounted host does not advertise `readSession`.
 */
export type SessionStateReadV1 = Readonly<{
  status: 'loading' | 'ready' | 'unavailable' | 'unsupported';
  state: SessionStateV1 | null;
}>;

const LOADING: SessionStateReadV1 = Object.freeze({ status: 'loading', state: null });
const UNAVAILABLE: SessionStateReadV1 = Object.freeze({ status: 'unavailable', state: null });
const UNSUPPORTED: SessionStateReadV1 = Object.freeze({ status: 'unsupported', state: null });

/**
 * Read and follow the live state of one Session — typically one linked to this
 * plugin's own entry — through the mounted host.
 *
 * The host's `readSession` stays the one snapshot authority: this hook reads
 * once, observes `watchSession` invalidations, and re-reads on each. It keeps
 * the last snapshot while a re-read is in flight, never polls, persists
 * nothing, and retires its watch on unmount or when `sessionId` changes. A host
 * that serves reads but not watches yields a truthful one-shot snapshot.
 */
export function useSessionState(sessionId: string | null): SessionStateReadV1 {
  const host = usePluginHostApi();
  const methods = host.version().methods;
  const canRead = methods.includes('readSession');
  const canWatch = methods.includes('watchSession');
  const [read, setRead] = React.useState<SessionStateReadV1>(LOADING);

  React.useEffect(() => {
    if (sessionId === null) {
      setRead(UNAVAILABLE);
      return;
    }
    if (!canRead) {
      setRead(UNSUPPORTED);
      return;
    }
    let current = true;
    const cancellation = new AbortController();
    let subscription: Readonly<{ dispose(): void }> | null = null;
    // A snapshot belongs to the Session it was read for.
    setRead(LOADING);

    const refresh = async (): Promise<void> => {
      try {
        const state = await host.readSession(sessionId, { signal: cancellation.signal });
        if (current) setRead(state ? Object.freeze({ status: 'ready', state }) : UNAVAILABLE);
      } catch {
        if (current) setRead(UNAVAILABLE);
      }
    };

    void (async () => {
      if (canWatch) {
        try {
          const established = await host.watchSession(sessionId, (event) => {
            if (!current) return;
            if (event.kind === 'invalidated') void refresh();
            else setRead(UNAVAILABLE);
          }, { signal: cancellation.signal });
          if (!current) {
            established.dispose();
            return;
          }
          subscription = established;
        } catch {
          // An unreachable Session refuses its watch; the read below reports it.
        }
      }
      await refresh();
    })();

    return () => {
      current = false;
      cancellation.abort();
      subscription?.dispose();
    };
  }, [canRead, canWatch, host, sessionId]);

  return read;
}
