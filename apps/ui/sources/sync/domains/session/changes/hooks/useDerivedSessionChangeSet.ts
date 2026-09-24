import * as React from 'react';

import { compareTurnChangeSetChronology, type SessionChangeSet, type TurnChangeSet } from '@happier-dev/protocol';

import { useSession, useSessionMessages } from '@/sync/domains/state/storage';
import { readStoredSessionMessagesForAddress } from '@/sync/domains/messages/readStoredSessionMessagesForAddress';
import {
    areSessionAddressesEqual,
    normalizeSessionAddress,
    type SessionAddress,
} from '@/sync/domains/session/sessionAddress';

import { deriveLatestTurnScopedChangeSet } from '../derivation/deriveLatestTurnScopedChangeSet';
import { deriveSessionChangeSet } from '../derivation/deriveSessionChangeSet';
import { deriveTurnChangeSetsFromMessages } from '../derivation/deriveTurnChangeSetsFromMessages';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';

type UseDerivedSessionChangeSetResult = Readonly<{
    turnChangeSets: readonly TurnChangeSet[];
    latestTurnChangeSet: TurnChangeSet | null;
    latestTurnScopedChangeSet: SessionChangeSet | null;
    sessionChangeSet: SessionChangeSet | null;
    latestTurnDiffByPath: ReadonlyMap<string, string> | null;
    latestTurnAgentReportedDiffByPath: ReadonlyMap<string, string> | null;
    latestTurnCheckpointDiffByPath: ReadonlyMap<string, string> | null;
    providerDiffByPath: ReadonlyMap<string, string> | null;
}>;

function buildDiffByPath(changeSet: SessionChangeSet | null): ReadonlyMap<string, string> | null {
    if (!changeSet) return null;
    const entries = changeSet.files
        .map((file) => {
            const diff = typeof file.unifiedDiff === 'string' ? file.unifiedDiff.trim() : '';
            if (!diff) return null;
            return [file.filePath, diff] as const;
        })
        .filter((entry): entry is readonly [string, string] => entry !== null);
    return entries.length > 0 ? new Map(entries) : null;
}

export function useDerivedSessionChangeSet(address: SessionAddress | null): UseDerivedSessionChangeSetResult {
    const requestedAddress = React.useMemo(
        () => normalizeSessionAddress(address?.serverId, address?.sessionId),
        [address?.serverId, address?.sessionId],
    );
    const sessionId = requestedAddress?.sessionId ?? '';
    const session = useSession(sessionId);
    const { messages: storedMessages } = useSessionMessages(sessionId, {
        enabled: requestedAddress !== null,
    });

    const messages = React.useMemo(() => readStoredSessionMessagesForAddress(
        {
            sessions: sessionId ? { [sessionId]: session } : {},
            sessionMessages: sessionId ? { [sessionId]: { messages: storedMessages } } : {},
        },
        requestedAddress,
    ), [requestedAddress, session, sessionId, storedMessages]);

    const exactSession = React.useMemo(() => {
        if (!requestedAddress || !session) return null;
        const storedAddress = normalizeSessionAddress(session.serverId, sessionId);
        return areSessionAddressesEqual(storedAddress, requestedAddress) ? session : null;
    }, [requestedAddress, session, sessionId]);

    const turnChangeSets = React.useMemo(() => {
        return deriveTurnChangeSetsFromMessages(messages);
    }, [messages]);

    const latestTurnChangeSet = React.useMemo(() => {
        // "Latest" is canonical turn identity, not transcript arrival order: a turn's evidence can
        // be published after a later turn's, and the presented scope must still be the later turn.
        return turnChangeSets.reduce<TurnChangeSet | null>((latest, turn) => (
            latest === null || compareTurnChangeSetChronology(latest, turn) <= 0 ? turn : latest
        ), null);
    }, [turnChangeSets]);

    const sessionChangeSet = React.useMemo(() => {
        return deriveSessionChangeSet({
            sessionId,
            metadata: exactSession ? readSessionOwnerMetadataView(exactSession) : null,
            turnChangeSets,
        });
    }, [
        exactSession?.metadata,
        exactSession?.metadataLayoutVersion,
        exactSession?.ownerMetadataView,
        sessionId,
        turnChangeSets,
    ]);

    const latestTurnScopedChangeSet = React.useMemo(() => {
        return deriveLatestTurnScopedChangeSet({
            sessionId,
            latestTurnChangeSet,
        });
    }, [latestTurnChangeSet, sessionId]);

    const latestTurnDiffByPath = React.useMemo<ReadonlyMap<string, string> | null>(() => {
        return buildDiffByPath(latestTurnScopedChangeSet);
    }, [latestTurnScopedChangeSet]);

    const latestTurnAgentReportedDiffByPath = React.useMemo<ReadonlyMap<string, string> | null>(() => {
        return buildDiffByPath(deriveLatestTurnScopedChangeSet({
            sessionId,
            latestTurnChangeSet,
            evidenceScope: 'agent_reported',
        }));
    }, [latestTurnChangeSet, sessionId]);

    const latestTurnCheckpointDiffByPath = React.useMemo<ReadonlyMap<string, string> | null>(() => {
        return buildDiffByPath(deriveLatestTurnScopedChangeSet({
            sessionId,
            latestTurnChangeSet,
            evidenceScope: 'checkpoint',
        }));
    }, [latestTurnChangeSet, sessionId]);

    const providerDiffByPath = React.useMemo<ReadonlyMap<string, string> | null>(() => {
        return buildDiffByPath(sessionChangeSet);
    }, [sessionChangeSet]);

    return {
        turnChangeSets,
        latestTurnChangeSet,
        latestTurnScopedChangeSet,
        sessionChangeSet,
        latestTurnDiffByPath,
        latestTurnAgentReportedDiffByPath,
        latestTurnCheckpointDiffByPath,
        providerDiffByPath,
    };
}
