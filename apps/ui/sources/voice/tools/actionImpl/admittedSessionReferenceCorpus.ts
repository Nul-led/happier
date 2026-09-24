import { readActiveRetainedSessionListReferenceCorpus } from '@/components/sessions/shell/sessionListPaneRetention';
import { listServerProfiles } from '@/sync/domains/server/serverProfiles';
import {
    fetchSessionListQueryPageForHome,
    isSessionListQueryHomeOnline,
    resolveOrdinarySessionListHomeOwner,
} from '@/sync/domains/session/listing/sessionListQueryRuntime';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import type { VoiceSessionCorpusOptions } from './voiceSessionRows';

/**
 * The one corpus a bare Session reference may be resolved against.
 *
 * It is the focused data-active Sessions pane's exact qualified membership plus that pane's own
 * completeness, never raw row-cache presence: a row left behind by an ad-hoc read, a replaced
 * query or a removed Home must not make a bare id resolvable (Lane 07.1 §3, L07-I33).
 *
 * `null` means no single pane owns a corpus here, which resolves as `incomplete` rather than
 * absence — a Voice host with nothing loaded has not proven a Session does not exist.
 */
export function readAdmittedSessionReferenceCorpusOptions(
    state: Readonly<{
        ordinarySessionListMembershipByServerId: Readonly<Record<string, readonly string[] | undefined>>;
    }>,
): VoiceSessionCorpusOptions | null {
    const corpus = readActiveRetainedSessionListReferenceCorpus({
        ordinaryMembershipByServerId: state.ordinarySessionListMembershipByServerId,
    });
    if (!corpus) return null;
    return {
        knownServerIds: corpus.selectedServerIds,
        coverage: corpus.coverage,
        addresses: corpus.addresses,
    };
}

/**
 * The corpus a bare or spoken Session reference is resolved against, acquiring one
 * when no pane owns it.
 *
 * A mounted pane remains a valid scoped hint and is used as-is. Off the Sessions
 * list there is no pane, and a presentation artefact is not the authority for
 * "which Sessions may this reference mean": the canonical `session.list` operation
 * is. So this reads each reachable Home once through the existing row-only
 * acquisition seam — the same seam ad-hoc Voice/Action reads already use, which
 * hydrates shared rows without publishing ordinary, archived or mounted-query
 * membership — and carries that read's exact coverage into the resolution.
 *
 * A Home that could not be read stays uncovered, so the resolution reports
 * `incomplete` instead of calling a single match unique (Lane 07.1 §3 and its
 * child 07.2 acquisition requirement). No Account crawler, no Voice-local cache
 * and no first-match fallback.
 */
export async function acquireAdmittedSessionReferenceCorpusOptions(
    state: Readonly<{
        ordinarySessionListMembershipByServerId: Readonly<Record<string, readonly string[] | undefined>>;
    }>,
    options?: Readonly<{ signal?: AbortSignal }>,
): Promise<VoiceSessionCorpusOptions | null> {
    const paneCorpus = readAdmittedSessionReferenceCorpusOptions(state);
    if (paneCorpus) return paneCorpus;

    // The intended corpus is every Home a runtime mounts, fixed before reachability
    // is consulted: an offline/pending mounted Home stays in it as uncovered, so a
    // match on the reachable Homes cannot be called unique. Reachability only
    // decides which members can be read now; it never decides membership.
    const serverIds = [...new Set(
        listServerProfiles()
            .map((profile) => String(profile.id ?? '').trim())
            .filter((serverId) => serverId.length > 0),
    )].filter((serverId) => resolveOrdinarySessionListHomeOwner(serverId) !== null);
    const readableServerIds = serverIds.filter((serverId) => isSessionListQueryHomeOnline(serverId));
    if (readableServerIds.length === 0) return null;

    const signal = options?.signal ?? new AbortController().signal;
    const pages = await Promise.all(readableServerIds.map(async (serverId) => {
        try {
            const page = await fetchSessionListQueryPageForHome(serverId, {
                membership: 'rowOnly',
                source: { kind: 'ordinary', path: '/v2/sessions', allowV1Fallback: true },
                signal,
            });
            return page.current ? { serverId, page } : null;
        } catch {
            return null;
        }
    }));

    const addresses: SessionAddress[] = [];
    let covered = 0;
    let complete = readableServerIds.length === serverIds.length;
    for (const entry of pages) {
        if (!entry) {
            complete = false;
            continue;
        }
        covered += 1;
        for (const sessionId of entry.page.sessionIds) {
            const normalized = String(sessionId ?? '').trim();
            if (normalized) addresses.push({ serverId: entry.serverId, sessionId: normalized });
        }
        // Exhausted pages that withheld historical rows are still not the whole corpus.
        if (entry.page.hasNext || entry.page.attentionHasNext || (entry.page.metadataUpgradeRequiredCount ?? 0) > 0) complete = false;
    }
    if (covered === 0) return null;

    return {
        knownServerIds: serverIds,
        coverage: complete ? 'complete' : 'incomplete',
        addresses,
    };
}
