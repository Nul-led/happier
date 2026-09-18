import type { ScmUiBackendPlugin } from '@/scm/registry/scmUiBackendPlugin';
import {
    resolveScmCommitSelectionPolicy,
    resolveScmUiPolicy,
    resolveSupportedDiffAreas,
} from '@/scm/registry/scmUiBackendPlugin';
import { inferScmRemoteTarget } from '@happier-dev/protocol';

export const saplingScmUiPlugin: ScmUiBackendPlugin = {
    id: 'sapling',
    displayName: 'Sapling',
    mapCapabilitiesToUiPolicy(snapshot) {
        return resolveScmUiPolicy(snapshot?.capabilities);
    },
    diffModeConfig(snapshot) {
        const availableModes = snapshot?.capabilities
            ? resolveSupportedDiffAreas(snapshot.capabilities)
            : (['pending'] as const);
        return {
            defaultMode: 'pending',
            availableModes: [...availableModes],
            labels: {
                included: 'Included',
                pending: 'Pending',
                both: 'Combined',
            },
        };
    },
    commitActionConfig(snapshot) {
        return {
            label: snapshot?.capabilities?.operationLabels?.commit ?? 'Commit changes',
            ...resolveScmCommitSelectionPolicy(snapshot?.capabilities),
        };
    },
    remoteActionConfig(snapshot) {
        return {
            fetch: snapshot?.capabilities?.writeRemoteFetch === true,
            pull: snapshot?.capabilities?.writeRemotePull === true,
            push: snapshot?.capabilities?.writeRemotePush === true,
            confirmationCopy: 'Sapling remote operation',
        };
    },
    inferRemoteTarget(snapshot) {
        return inferScmRemoteTarget({
            upstream: snapshot?.branch.upstream,
            head: snapshot?.branch.head,
            allowHeadFallback: false,
        });
    },
    errorNormalizer(input) {
        return input instanceof Error ? input.message : String(input ?? 'Unknown source-control error');
    },
    statusSummaryMapper(snapshot) {
        if (!snapshot) return null;
        return {
            changedFiles: snapshot.entries.length,
            includedFiles: snapshot.totals.includedFiles,
            pendingFiles: snapshot.totals.pendingFiles,
            untrackedFiles: snapshot.totals.untrackedFiles,
        };
    },
};
