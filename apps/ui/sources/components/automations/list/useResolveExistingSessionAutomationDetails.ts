import * as React from 'react';

import type { AutomationDefinition } from '@/sync/domains/automations/automationTypes';
import { runTasksWithLimit } from '@/sync/runtime/orchestration/runTasksWithLimit';
import { loadSyncTuning } from '@/sync/runtime/syncTuning';
import { sync } from '@/sync/sync';

function directDetailKey(
    accountScopeKey: string,
    automation: Readonly<{ id: string; templateVersion: number }>,
): string {
    return `${accountScopeKey}\u0000${automation.id}\u0000${automation.templateVersion}`;
}

/** Resolves only private existing-Session targets omitted from bounded list rows. */
export function useResolveExistingSessionAutomationDetails(params: Readonly<{
    automations: readonly AutomationDefinition[];
    accountScopeKey: string;
    enabled: boolean;
}>) {
    const inFlightKeys = React.useRef(new Set<string>());
    const mounted = React.useRef(true);
    React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const candidates = React.useMemo(() => params.automations.filter((automation) => (
        automation.targetType === 'existingSession'
        && automation.detail.kind === 'unloaded'
        && automation.linkedExistingSessionId === null
    )), [params.automations]);
    const [completedKeys, setCompletedKeys] = React.useState<ReadonlySet<string>>(() => new Set());
    const [failedKeys, setFailedKeys] = React.useState<ReadonlySet<string>>(() => new Set());
    const [activeKeys, setActiveKeys] = React.useState<ReadonlySet<string>>(() => new Set());
    const pending = React.useMemo(() => candidates.filter((automation) => {
        const key = directDetailKey(params.accountScopeKey, automation);
        return !completedKeys.has(key) && !failedKeys.has(key) && !inFlightKeys.current.has(key);
    }), [candidates, completedKeys, failedKeys, params.accountScopeKey]);
    const hasFailure = React.useMemo(() => candidates.some(
        (automation) => failedKeys.has(directDetailKey(params.accountScopeKey, automation)),
    ), [candidates, failedKeys, params.accountScopeKey]);

    React.useEffect(() => {
        if (!params.enabled || pending.length === 0) return;
        const reserved = pending.map((automation) => ({
            automation,
            key: directDetailKey(params.accountScopeKey, automation),
        })).filter(({ key }) => {
            if (inFlightKeys.current.has(key)) return false;
            inFlightKeys.current.add(key);
            return true;
        });
        if (reserved.length === 0) return;
        setActiveKeys((previous) => new Set([
            ...previous,
            ...reserved.map(({ key }) => key),
        ]));
        void (async () => {
            const resolved: string[] = [];
            const failed: string[] = [];
            await runTasksWithLimit(
                reserved.map(({ automation, key }) => async () => {
                    try {
                        await sync.refreshAutomationDefinitionDetail(automation.id);
                        resolved.push(key);
                    } catch {
                        failed.push(key);
                    } finally {
                        inFlightKeys.current.delete(key);
                    }
                }),
                loadSyncTuning().automationDefinitionDetailHydrationConcurrencyLimit,
            );
            if (!mounted.current) return;
            if (resolved.length > 0) setCompletedKeys((previous) => new Set([...previous, ...resolved]));
            if (failed.length > 0) setFailedKeys((previous) => new Set([...previous, ...failed]));
            setActiveKeys((previous) => {
                const next = new Set(previous);
                for (const { key } of reserved) next.delete(key);
                return next;
            });
        })();
    }, [params.accountScopeKey, params.enabled, pending]);

    const hasActive = React.useMemo(() => candidates.some(
        (automation) => activeKeys.has(directDetailKey(params.accountScopeKey, automation)),
    ), [activeKeys, candidates, params.accountScopeKey]);

    return {
        resolving: params.enabled && (pending.length > 0 || hasActive),
        hasFailure,
        retry: React.useCallback(() => setFailedKeys(new Set()), []),
    } as const;
}
