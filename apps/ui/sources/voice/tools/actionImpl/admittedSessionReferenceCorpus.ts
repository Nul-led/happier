import { readActiveRetainedSessionListReferenceCorpus } from '@/components/sessions/shell/sessionListPaneRetention';

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
