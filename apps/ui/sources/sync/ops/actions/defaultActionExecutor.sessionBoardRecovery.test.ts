import { describe, expect, it } from 'vitest';

import { createSessionBoardOutcomeUnknownFailureV1 } from '@happier-dev/protocol/sessions/board';

import { projectRetiredSessionBoardActionFailure } from './defaultActionExecutor';

const intent = {
    sessionId: 'session-one',
    itemId: 'release-checklist',
    expectedItemRevision: null,
    item: {
        v: 1,
        title: 'Release checklist',
        frame: 'card',
        height: { mode: 'auto', fallback: 'regular' },
        source: {
            kind: 'declarative',
            document: { version: 1, root: { kind: 'markdown', text: 'Ready' } },
        },
    },
    placement: { tabId: 'overview', tabTitle: 'Overview' },
} as const;

const requestBody = JSON.stringify({
    operation: 'upsert_item',
    itemId: intent.itemId,
    expectedItemRevision: null,
    itemContent: { t: 'plain', v: intent.item },
    placement: {
        expectedLayoutRevision: null,
        layoutContent: {
            t: 'plain',
            v: {
                v: 1,
                tabs: [{
                    id: 'overview',
                    title: 'Overview',
                    items: [{ itemId: intent.itemId, width: 'medium' }],
                }],
            },
        },
    },
});

describe('retired Session Board Action result projection', () => {
    const binding = {
        actionId: 'session.board.item.upsert' as const,
        actionInput: intent,
        serverId: 'home-a',
        sessionId: 'session-one',
    };

    it('keeps a pre-dispatch retirement definite and carries no recovery packet', () => {
        expect(projectRetiredSessionBoardActionFailure({
            ...binding,
            mutationDispatched: false,
            retirementStatus: 'forbidden',
            recoveryDetails: { recovery: { secret: 'must-not-pass' } },
        })).toEqual({ ok: false, errorCode: 'forbidden', error: 'forbidden' });
    });

    it('returns only the strict originating recovery packet when scope retires after dispatch', () => {
        const issued = createSessionBoardOutcomeUnknownFailureV1({
            actionId: 'session.board.item.upsert',
            serverId: 'home-a',
            sessionId: 'session-one',
            requestBody,
            mutationRequest: JSON.parse(requestBody),
            intent,
        });

        expect(projectRetiredSessionBoardActionFailure({
            ...binding,
            mutationDispatched: true,
            retirementStatus: 'forbidden',
            recoveryDetails: issued.details,
        })).toEqual(issued);
    });

    it('does not pass arbitrary retired Account result data through the recovery exception', () => {
        expect(projectRetiredSessionBoardActionFailure({
            ...binding,
            mutationDispatched: true,
            retirementStatus: 'forbidden',
            recoveryDetails: {
                recovery: {
                    v: 1,
                    actionId: 'session.board.item.upsert',
                    serverId: 'home-a',
                    sessionId: 'session-one',
                    requestBody,
                    mutationRequest: JSON.parse(requestBody),
                    intent,
                    newlyActiveAccountContent: 'must-not-pass',
                },
            },
        })).toEqual({ ok: false, errorCode: 'outcome_unknown', error: 'outcome_unknown' });
    });

    it('does not expose a recovery packet bound to another Home or invocation intent', () => {
        const issued = createSessionBoardOutcomeUnknownFailureV1({
            actionId: 'session.board.item.upsert',
            serverId: 'home-b',
            sessionId: 'session-one',
            requestBody,
            mutationRequest: JSON.parse(requestBody),
            intent,
        });

        expect(projectRetiredSessionBoardActionFailure({
            ...binding,
            mutationDispatched: true,
            retirementStatus: 'forbidden',
            recoveryDetails: issued.details,
        })).toEqual({ ok: false, errorCode: 'outcome_unknown', error: 'outcome_unknown' });
        expect(projectRetiredSessionBoardActionFailure({
            ...binding,
            actionInput: { ...intent, itemId: 'another-item' },
            mutationDispatched: true,
            retirementStatus: 'forbidden',
            recoveryDetails: {
                recovery: {
                    ...issued.details.recovery,
                    serverId: 'home-a',
                },
            },
        })).toEqual({ ok: false, errorCode: 'outcome_unknown', error: 'outcome_unknown' });
    });
});
