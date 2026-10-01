import * as React from 'react';

import type { ItemAction } from '@/components/ui/lists/itemActions';
import { publishPresentationNotice } from '@/components/sessions/presentation/presentationNotices';
import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import { t } from '@/text';

import { useSessionCompanionRevealPort } from '../presentation/SessionCompanionRevealPort';
import {
    applySessionCompanionMutationWithNotice,
    buildSessionPresentationNoticeKeyPrefix,
} from '../presentation/sessionCompanionPresentationAdapter';
import { useSessionCompanionController } from '../state/useSessionCompanionController';

const NOOP_OPEN_COMPANION = (): void => {};

/**
 * "Add to Companion" for a pane (lab WC3: the second way in, beside the Companion's own popover). It
 * keeps one link row to the pane through the Companion's one add path — `show`, which also reveals a
 * hidden Companion — and is absent once the pane is already there.
 */
export function usePaneCompanionActions(input: Readonly<{
    sessionId: string;
    serverId: string | null;
    paneId: string | null;
}>): readonly ItemAction[] {
    const address = React.useMemo(
        () => normalizeSessionAddress(input.serverId, input.sessionId),
        [input.serverId, input.sessionId],
    );
    const reveal = useSessionCompanionRevealPort(address);
    const companion = useSessionCompanionController({
        sessionId: input.sessionId,
        serverId: input.serverId,
        openFullSurface: reveal?.openFullSurface ?? NOOP_OPEN_COMPANION,
    });
    const noticeKeyPrefix = React.useMemo(
        () => buildSessionPresentationNoticeKeyPrefix(address, input.sessionId),
        [address, input.sessionId],
    );
    const paneId = input.paneId;
    const kept = paneId !== null && companion.preference.items.some((item) => item.kind === 'pane' && item.paneId === paneId);
    return React.useMemo<readonly ItemAction[]>(() => {
        if (paneId === null || kept || !reveal || companion.availability !== 'ready') return [];
        return [{
            id: 'add-to-companion',
            title: t('sessionBoard.companion.actions.addToCompanion'),
            icon: 'stack',
            onPress: () => {
                const outcome = applySessionCompanionMutationWithNotice({
                    companion,
                    publishNotice: publishPresentationNotice,
                    noticeKeyPrefix,
                    kind: 'companion.item.add',
                    message: t('sessionBoard.companion.notices.added'),
                    apply: (current) => current.show({ kind: 'pane', paneId }),
                });
                if (outcome) reveal.revealAfterMutation(outcome);
            },
        }];
    }, [companion, kept, noticeKeyPrefix, paneId, reveal]);
}
