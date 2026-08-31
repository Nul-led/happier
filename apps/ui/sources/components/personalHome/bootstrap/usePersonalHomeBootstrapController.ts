import * as React from 'react';

import { isDesktopHost } from '@/utils/platform/desktopHost';

import { derivePersonalHomeBootstrapSnapshot } from './derivePersonalHomeBootstrapSnapshot';
import type {
    PersonalHomeBootstrapOperation,
    PersonalHomeBootstrapSnapshot,
    PersonalHomeFacts,
} from './personalHomeBootstrapTypes';

export type PersonalHomeBootstrapOperationRunner = (facts: PersonalHomeFacts) => Promise<void>;

export type PersonalHomeBootstrapControllerOptions = Readonly<{
    readFacts: () => Promise<PersonalHomeFacts>;
    operations?: Partial<Record<PersonalHomeBootstrapOperation, PersonalHomeBootstrapOperationRunner>>;
    initialFacts?: PersonalHomeFacts | null;
    enabled?: boolean;
}>;

export type PersonalHomeBootstrapController = Readonly<{
    facts: PersonalHomeFacts | null;
    snapshot: PersonalHomeBootstrapSnapshot;
    error: Error | null;
    isChecking: boolean;
    isOperating: boolean;
    refresh: () => void;
    retry: () => void;
    execute: (runner: PersonalHomeBootstrapOperationRunner) => Promise<boolean>;
}>;

const EMPTY_ROWS = [
    { id: 'home' as const, status: 'pending' as const },
    { id: 'app' as const, status: 'pending' as const },
    { id: 'computer' as const, status: 'pending' as const },
] as const;

function checkingSnapshot(): PersonalHomeBootstrapSnapshot {
    return {
        shouldGateShell: true,
        homeReady: false,
        daemonReady: false,
        phase: 'checking',
        daemonState: 'not-started',
        rows: EMPTY_ROWS,
        action: 'none',
    };
}

function operationForSnapshot(snapshot: PersonalHomeBootstrapSnapshot): PersonalHomeBootstrapOperation | null {
    switch (snapshot.phase) {
        case 'preparing-home':
            return 'prepare-home';
        case 'connecting-app':
            return 'connect-app';
        case 'closing-signup':
            return 'close-signup';
        case 'preparing-computer':
            return 'prepare-computer';
        default:
            return null;
    }
}

function errorSnapshot(snapshot: PersonalHomeBootstrapSnapshot, error: Error): PersonalHomeBootstrapSnapshot {
    const code = 'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null;
    if (
        code === 'personal_home_existing_runtime_conflict'
        || code === 'personal_home_credentials_unverified'
    ) {
        return {
            ...snapshot,
            shouldGateShell: true,
            phase: 'blocked',
            action: 'choose-existing-runtime',
            detail: {
                code: 'existing_runtime',
                message: error.message,
                retryable: false,
            },
        };
    }
    if (
        code === 'personal_home_existing_runtime_operation_failed'
        || snapshot.action === 'choose-existing-runtime'
    ) {
        return {
            ...snapshot,
            phase: 'blocked',
            action: 'choose-existing-runtime',
            detail: {
                code: 'existing_runtime_operation_failed',
                message: error.message,
                retryable: true,
            },
        };
    }
    return {
        ...snapshot,
        shouldGateShell: snapshot.homeReady ? false : true,
        phase: 'blocked',
        action: 'retry',
        detail: {
            code: 'bootstrap_operation_failed',
            message: error.message,
            retryable: true,
        },
    };
}

export function usePersonalHomeBootstrapController(
    options: PersonalHomeBootstrapControllerOptions,
): PersonalHomeBootstrapController {
    const enabled = options.enabled !== false;
    const [facts, setFacts] = React.useState<PersonalHomeFacts | null>(options.initialFacts ?? null);
    const [error, setError] = React.useState<Error | null>(null);
    const [isChecking, setIsChecking] = React.useState(options.initialFacts == null);
    const [hasAuthoritativeFacts, setHasAuthoritativeFacts] = React.useState(false);
    const [isOperating, setIsOperating] = React.useState(false);
    const [refreshVersion, setRefreshVersion] = React.useState(0);
    const operationKeyRef = React.useRef<string | null>(null);
    const operationInFlightRef = React.useRef(false);
    const mountedRef = React.useRef(true);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const refresh = React.useCallback(() => {
        if (operationInFlightRef.current) return;
        operationKeyRef.current = null;
        setHasAuthoritativeFacts(false);
        setError(null);
        setRefreshVersion((value) => value + 1);
    }, []);

    const retry = React.useCallback(() => {
        refresh();
    }, [refresh]);

    React.useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        setIsChecking(true);
        void options.readFacts()
            .then((nextFacts) => {
                if (cancelled || !mountedRef.current) return;
                setFacts(nextFacts);
                setHasAuthoritativeFacts(true);
                setError(null);
            })
            .catch((cause: unknown) => {
                if (cancelled || !mountedRef.current) return;
                const nextError = cause instanceof Error ? cause : new Error(String(cause));
                setError(nextError);
            })
            .finally(() => {
                if (!cancelled && mountedRef.current) setIsChecking(false);
            });
        return () => {
            cancelled = true;
        };
    }, [enabled, options.readFacts, refreshVersion]);

    const derivedSnapshot = React.useMemo(
        () => facts ? derivePersonalHomeBootstrapSnapshot(facts) : checkingSnapshot(),
        [facts],
    );
    const snapshot = error ? errorSnapshot(derivedSnapshot, error) : derivedSnapshot;

    const execute = React.useCallback(async (
        runner: PersonalHomeBootstrapOperationRunner,
    ): Promise<boolean> => {
        if (!enabled || !facts || operationInFlightRef.current) return false;
        const startedFromExistingRuntimeDecision = derivedSnapshot.action === 'choose-existing-runtime';
        operationInFlightRef.current = true;
        setIsOperating(true);

        let operationError: Error | null = null;
        try {
            await runner(facts);
        } catch (cause: unknown) {
            const nextError = cause instanceof Error ? cause : new Error(String(cause));
            const code = 'code' in nextError && typeof (nextError as { code?: unknown }).code === 'string'
                ? (nextError as { code: string }).code
                : null;
            operationError = startedFromExistingRuntimeDecision
                && code !== 'personal_home_existing_runtime_conflict'
                && code !== 'personal_home_credentials_unverified'
                ? Object.assign(new Error(nextError.message, { cause: nextError }), {
                    code: 'personal_home_existing_runtime_operation_failed',
                })
                : nextError;
        }

        // Facts are the recovery contract. Re-read them after both success and failure so a
        // partially completed operation cannot publish an error over stale readiness state.
        let nextFacts: PersonalHomeFacts | null = null;
        try {
            nextFacts = await options.readFacts();
        } catch (cause: unknown) {
            if (!operationError) {
                operationError = cause instanceof Error ? cause : new Error(String(cause));
            }
        }

        operationInFlightRef.current = false;
        if (!mountedRef.current) return operationError == null;
        if (nextFacts) setFacts(nextFacts);
        setError(operationError);
        setIsOperating(false);
        return operationError == null;
    }, [derivedSnapshot.action, enabled, facts, options.readFacts]);

    React.useEffect(() => {
        if (!enabled || !facts || !hasAuthoritativeFacts || error || isChecking || isOperating) return;
        const operation = operationForSnapshot(snapshot);
        const runner = operation ? options.operations?.[operation] : undefined;
        if (!operation || !runner) return;
        if (
            operation === 'prepare-computer'
            && (
                facts.localHomeReachability !== 'reachable'
                || !facts.localHomeIdentity
                || facts.localHomeAuth !== 'present'
            )
        ) return;

        // This key is intentionally transient. Facts remain the recovery contract after a restart.
        const operationKey = `${operation}:${facts.relayRuntime?.status ?? ''}:${facts.localHomeIdentity ?? ''}:${facts.localHomeAuth}:${facts.anonymousSignup}:${facts.daemon?.machineId ?? ''}`;
        if (operationKeyRef.current === operationKey) return;
        operationKeyRef.current = operationKey;
        void execute(runner);
    }, [enabled, error, execute, facts, hasAuthoritativeFacts, isChecking, isOperating, options.operations, snapshot]);

    return {
        facts,
        snapshot,
        error,
        isChecking,
        isOperating,
        refresh,
        retry,
        execute,
    };
}

/** The default host predicate is kept here so gate placement can be tested without importing Tauri APIs. */
export function isPersonalHomeDesktopHost(): boolean {
    return isDesktopHost();
}
