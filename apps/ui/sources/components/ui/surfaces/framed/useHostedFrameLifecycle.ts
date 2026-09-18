import * as React from 'react';

export const DEFAULT_HOSTED_FRAME_READY_TIMEOUT_MS = 30_000;

export function scheduleHostedFrameReadyTimeout(input: Readonly<{
    timeoutMs?: number;
    onTimeout: () => void;
}>): () => void {
    const timeout = setTimeout(input.onTimeout, input.timeoutMs ?? DEFAULT_HOSTED_FRAME_READY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
}

export type HostedFrameFailure =
    | 'guest_error'
    | 'load_failed'
    | 'ready_timeout'
    | 'unexpected_navigation';

/** One source-neutral frame attempt lifecycle shared by installed and caller adapters. */
export function useHostedFrameLifecycle(input: Readonly<{
    lifetimeKey: string;
    readyRequired: boolean;
    readyTimeoutMs?: number | null;
    onReadyTimeout?: () => void;
    onRetireAttempt?: () => void;
}>) {
    const [attempt, setAttempt] = React.useState(0);
    const [loaded, setLoaded] = React.useState(false);
    const [ready, setReady] = React.useState(false);
    const [failure, setFailure] = React.useState<HostedFrameFailure | null>(null);
    const onReadyTimeoutRef = React.useRef(input.onReadyTimeout);
    const onRetireAttemptRef = React.useRef(input.onRetireAttempt);
    onReadyTimeoutRef.current = input.onReadyTimeout;
    onRetireAttemptRef.current = input.onRetireAttempt;
    const lifetimeKeyRef = React.useRef(input.lifetimeKey);

    React.useLayoutEffect(() => {
        if (lifetimeKeyRef.current === input.lifetimeKey) return;
        lifetimeKeyRef.current = input.lifetimeKey;
        onRetireAttemptRef.current?.();
        setAttempt(0);
        setLoaded(false);
        setReady(false);
        setFailure(null);
    }, [input.lifetimeKey]);

    const fail = React.useCallback((reason: HostedFrameFailure) => {
        onRetireAttemptRef.current?.();
        setFailure((current) => current ?? reason);
    }, []);
    const reload = React.useCallback(() => {
        onRetireAttemptRef.current?.();
        setLoaded(false);
        setReady(false);
        setFailure(null);
        setAttempt((current) => current + 1);
    }, []);
    const markLoaded = React.useCallback(() => setLoaded(true), []);
    const markReady = React.useCallback(() => {
        setReady(true);
        setFailure(null);
    }, []);

    React.useEffect(() => {
        if (!loaded || ready || failure || !input.readyRequired || input.readyTimeoutMs === null) return;
        return scheduleHostedFrameReadyTimeout({
            timeoutMs: input.readyTimeoutMs ?? undefined,
            onTimeout: () => {
            onReadyTimeoutRef.current?.();
            fail('ready_timeout');
            },
        });
    }, [fail, failure, input.readyRequired, input.readyTimeoutMs, loaded, ready]);

    return Object.freeze({ attempt, failure, fail, reload, markLoaded, markReady });
}
