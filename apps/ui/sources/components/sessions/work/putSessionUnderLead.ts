import { Modal } from '@/modal';
import { getStorage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { setSessionReportsTo } from '@/sync/ops/relations/setSessionReportsTo';
import { t } from '@/text';

import { canDropSessionUnder } from './putUnderCandidates';

/** The words for a refused `session.reports_to.set` — shared by "Put under…" and the list drag. */
export function describeReportsToRefusal(errorCode: string | undefined): string {
    switch (errorCode) {
        case 'reports_to_cycle':
            return t('sessionWork.putUnder.errors.cycle');
        case 'reports_to_cas_conflict':
            return t('sessionWork.putUnder.errors.changed');
        case 'reports_to_forbidden':
            return t('sessionWork.putUnder.errors.forbidden');
        default:
            return t('sessionWork.putUnder.errors.failed');
    }
}

export type PutSessionUnderLeadResult = 'applied' | 'not-eligible' | 'refused';

/**
 * The Sessions-list drop "put this Session under that one" (R-03). Re-checks the drop against the
 * latest store (the list kept moving while the person dragged), sends the one
 * `session.reports_to.set` Action with the lead the store holds now as the expected current lead,
 * and says a refusal in words. The server's fence and compare-and-set decide.
 */
export async function putSessionUnderLead(input: Readonly<{
    serverId: string | null;
    sessionId: string;
    leadSessionId: string;
}>): Promise<PutSessionUnderLeadResult> {
    const sessions = getStorage().getState().sessions as Readonly<Record<string, Session>>;
    if (!canDropSessionUnder(sessions, input.sessionId, input.leadSessionId)) return 'not-eligible';
    let errorCode: string | undefined;
    try {
        const result = await setSessionReportsTo({
            sessionId: input.sessionId,
            leadSessionId: input.leadSessionId,
            expectedLeadSessionId: sessions[input.sessionId]?.reportsTo?.sessionId ?? null,
            serverId: input.serverId,
        });
        if (result.ok) return 'applied';
        errorCode = result.errorCode;
    } catch {
        errorCode = undefined;
    }
    Modal.alert(t('sessionWork.putUnder.title'), describeReportsToRefusal(errorCode));
    return 'refused';
}
