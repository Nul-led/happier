import * as React from 'react';

import { formatAccountServiceHost } from '@/sync/domains/accountDirectory/accountDirectoryEndpoint';
import { t } from '@/text';

type SelectionFailureKind = 'invalid' | 'unsupported' | 'unavailable';
type SelectionOutcome = Readonly<{ kind: string }>;

/** One message per failed check, in the welcome vocabulary every service picker shares. */
export function describeAccountServiceSelectionFailure(kind: SelectionFailureKind, enteredUrl: string): string {
    if (kind === 'invalid') return t('welcome.signInServiceInvalidAddress');
    if (kind === 'unsupported') return t('welcome.signInServiceUnsupportedBody');
    const service = formatAccountServiceHost(enteredUrl);
    return service
        ? t('welcome.signInServiceUnavailableBody', { service })
        : t('welcome.signInServiceUnavailableTitle');
}

function isSelectionFailure(outcome: SelectionOutcome): outcome is Readonly<{ kind: SelectionFailureKind }> {
    return outcome.kind === 'invalid' || outcome.kind === 'unsupported' || outcome.kind === 'unavailable';
}

export type AccountServiceSelection<Outcome extends SelectionOutcome> = Readonly<{
    /** The address being checked, while a check is in flight. */
    pendingUrl: string | null;
    /** What the last check found wrong, ready to show under the field. */
    error: string | null;
    /** Runs the operation for an address; a newer attempt or `cancel` supersedes it (null result). */
    submit: (rawUrl: string) => Promise<Outcome | null>;
    clearError: () => void;
    cancel: () => void;
}>;

/**
 * Attempt ownership for choosing a sign-in service: one check in flight per address, a newer
 * address or leaving the picker aborts the older check, and a failure becomes one message. Both
 * service pickers (onboarding's wizard form and the Account page's inline chooser) run through it
 * with their own operation, so the two presentations cannot drift in how they validate.
 */
export function useAccountServiceSelection<Outcome extends SelectionOutcome>(
    operation: (url: string, options: Readonly<{ signal: AbortSignal }>) => Promise<Outcome>,
): AccountServiceSelection<Outcome> {
    const activeRef = React.useRef<Readonly<{ url: string; controller: AbortController }> | null>(null);
    const [pendingUrl, setPendingUrl] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    const cancel = React.useCallback(() => {
        activeRef.current?.controller.abort();
        activeRef.current = null;
        setPendingUrl(null);
    }, []);
    React.useEffect(() => () => {
        activeRef.current?.controller.abort();
        activeRef.current = null;
    }, []);

    const submit = React.useCallback(async (rawUrl: string): Promise<Outcome | null> => {
        const url = rawUrl.trim();
        if (!url) {
            setError(t('welcome.signInServiceInvalidAddress'));
            return null;
        }
        if (activeRef.current?.url === url) return null;
        activeRef.current?.controller.abort();
        const attempt = { url, controller: new AbortController() };
        activeRef.current = attempt;
        setError(null);
        setPendingUrl(url);
        try {
            const outcome = await operation(url, { signal: attempt.controller.signal });
            if (activeRef.current !== attempt || attempt.controller.signal.aborted) return null;
            if (isSelectionFailure(outcome)) setError(describeAccountServiceSelectionFailure(outcome.kind, url));
            return outcome;
        } finally {
            if (activeRef.current === attempt) {
                activeRef.current = null;
                setPendingUrl(null);
            }
        }
    }, [operation]);

    const clearError = React.useCallback(() => setError(null), []);

    return React.useMemo(() => ({ pendingUrl, error, submit, clearError, cancel }), [pendingUrl, error, submit, clearError, cancel]);
}
