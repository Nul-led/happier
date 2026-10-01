import * as React from 'react';
import { usePluginHostApi, usePluginUiEphemeralSharedScope, type PluginUiEphemeralSharedScope } from '@happier-dev/plugin-ui';
import { TriagePullRequestStatusResultV1Schema, type TriagePullRequestStatusV1 } from '@happier-dev/triage-protocol/v1';
import { TRIAGE_READ_PULL_REQUEST_STATUS_ACTION_LOCAL_ID_V1 } from '../../actions/entryDetailProtocol.js';
import { TriageReobserveEntryInputV1Schema } from '../../actions/reobserveEntryProtocol.js';
import type { TriageSessionLinkedEntrySummaryV1 } from './linkedEntrySummary.js';

type StatusRead = Readonly<{
    owner: PluginUiEphemeralSharedScope | null;
    identity: string;
    status: TriagePullRequestStatusV1 | null;
    phase: 'reading' | 'ready' | 'unavailable';
}>;
const IDLE = Object.freeze({ status: null, phase: 'idle' as const });
export type LinkedPullRequestStatusRead = Readonly<{
    status: TriagePullRequestStatusV1 | null;
    phase: 'idle' | 'reading' | 'ready' | 'unavailable';
}>;

/** Row-local detail demand. The retained list window and its refresh coordinator are untouched. */
export function useLinkedPullRequestStatus(entry: TriageSessionLinkedEntrySummaryV1 | null, expanded: boolean, refreshRevision: number): LinkedPullRequestStatusRead {
    const host = usePluginHostApi();
    const owner = usePluginUiEphemeralSharedScope();
    const identity = entry?.kind === 'pullRequest' && entry.sourceInstanceId !== null && entry.detailSource !== null
        ? JSON.stringify([entry.entryRef, entry.sourceInstanceId]) : null;
    const inputJson = identity === null || entry === null ? null : JSON.stringify({
        v: 1, entryRef: entry.entryRef, sourceInstanceId: entry.sourceInstanceId, lastKnownLocator: entry.detailSource?.observation.locator,
    });
    const input = React.useMemo(() => inputJson === null ? null : TriageReobserveEntryInputV1Schema.parse(JSON.parse(inputJson)), [inputJson]);
    const observationAtMs = entry?.detailSource?.observation.observedAtMs ?? null;
    const [read, setRead] = React.useState<StatusRead | null>(null);
    const settled = React.useRef<Readonly<{ owner: PluginUiEphemeralSharedScope | null; inputJson: string; observationAtMs: number | null; refreshRevision: number }> | null>(null);

    React.useEffect(() => {
        if (!expanded || input === null || inputJson === null || identity === null) return;
        const previous = settled.current;
        if (previous?.owner === owner && previous.inputJson === inputJson
            && previous.observationAtMs === observationAtMs && previous.refreshRevision === refreshRevision) return;
        const controller = new AbortController();
        const retain = (previousRead: StatusRead | null) => previousRead?.owner === owner && previousRead.identity === identity ? previousRead.status : null;
        setRead((previousRead) => ({ owner, identity, status: retain(previousRead), phase: 'reading' }));
        void (async () => {
            try {
                const result = TriagePullRequestStatusResultV1Schema.parse(await host.executeAction(
                    TRIAGE_READ_PULL_REQUEST_STATUS_ACTION_LOCAL_ID_V1, input, { signal: controller.signal },
                ));
                if (controller.signal.aborted) return;
                settled.current = { owner, inputJson, observationAtMs, refreshRevision };
                setRead((previousRead) => ({ owner, identity,
                    status: result.kind === 'status' ? result : retain(previousRead),
                    phase: result.kind === 'status' ? 'ready' : 'unavailable' }));
            } catch {
                if (controller.signal.aborted) return;
                settled.current = { owner, inputJson, observationAtMs, refreshRevision };
                setRead((previousRead) => ({ owner, identity, status: retain(previousRead), phase: 'unavailable' }));
            }
        })();
        return () => { controller.abort(); };
    }, [expanded, host, identity, input, inputJson, observationAtMs, owner, refreshRevision]);

    // A changed Account/plugin scope or selected connection never renders the previous owner's facts.
    return read?.owner === owner && read.identity === identity ? read : IDLE;
}
