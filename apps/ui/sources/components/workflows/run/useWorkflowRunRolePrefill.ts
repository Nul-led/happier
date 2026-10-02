import * as React from 'react';
import type { RoleOverrideV1 } from '@happier-dev/protocol';
import { useActiveServerAccountScope } from '@/sync/domains/state/storage';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { readWorkflowRunRolePrefill } from '@/sync/domains/workflows/workflowRunListActions';

const EMPTY_OVERRIDES: readonly RoleOverrideV1[] = Object.freeze([]);

/** Review-local draft, seeded by FIN's existing accepted-run reader. No persisted role memory. */
export function useWorkflowRunRolePrefill(sourceArtifactId: string | null | undefined) {
    const scope = useActiveServerAccountScope();
    const identity = JSON.stringify([scope?.serverId, scope?.accountId, sourceArtifactId]);
    const [attempt, retry] = React.useReducer((value: number) => value + 1, 0);
    const [state, setState] = React.useState<Readonly<{
        identity: string; status: 'ready' | 'loading' | 'failed'; overrides: readonly RoleOverrideV1[];
    }>>({ identity, status: sourceArtifactId ? 'loading' : 'ready', overrides: EMPTY_OVERRIDES });
    React.useEffect(() => {
        if (!sourceArtifactId) {
            setState({ identity, status: 'ready', overrides: EMPTY_OVERRIDES });
            return;
        }
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (!lifetime) {
            setState({ identity, status: 'failed', overrides: EMPTY_OVERRIDES });
            return;
        }
        const abort = new AbortController();
        const retirement = lifetime.onRetire(() => abort.abort());
        setState({ identity, status: 'loading', overrides: EMPTY_OVERRIDES });
        void readWorkflowRunRolePrefill({ sourceArtifactId, accountId: lifetime.scope.accountId, signal: abort.signal })
            .then((overrides) => {
                if (!abort.signal.aborted && lifetime.isCurrent()) setState({ identity, status: 'ready', overrides: overrides ?? EMPTY_OVERRIDES });
            }, () => {
                if (!abort.signal.aborted && lifetime.isCurrent()) setState({ identity, status: 'failed', overrides: EMPTY_OVERRIDES });
            });
        return () => { abort.abort(); retirement.dispose(); };
    }, [attempt, identity, sourceArtifactId]);
    const onChange = React.useCallback((overrides: readonly RoleOverrideV1[]) => {
        setState({ identity, status: 'ready', overrides });
    }, [identity]);
    return { overrides: state.identity === identity ? state.overrides : EMPTY_OVERRIDES,
        status: state.identity === identity ? state.status : sourceArtifactId ? 'loading' as const : 'ready' as const,
        onChange, retry };
}
