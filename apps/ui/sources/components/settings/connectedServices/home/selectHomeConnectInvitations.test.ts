import { describe, expect, it } from 'vitest';

import { HOME_CONNECT_INVITATION_STEP_ID, homeConnectServiceStepId, selectHomeConnectInvitations } from './selectHomeConnectInvitations';

const service = (localId: string, usedBy: string[], section: 'agents' | 'tools' = 'agents') => ({
    serviceKey: `p/${localId}`,
    label: localId,
    usedBy,
    section,
});

describe('selectHomeConnectInvitations', () => {
    const claude = service('claude', ['Claude Code']);
    const gemini = service('gemini', ['Gemini CLI']);
    const github = service('github', [], 'tools');

    it('before any account, invites with every service an agent accepts (never code hosts)', () => {
        const result = selectHomeConnectInvitations({ connectable: [claude, gemini, github], hidden: new Set(), hasAccounts: false });
        expect(result).toEqual({ kind: 'invite', services: [claude, gemini] });
    });

    it('after the first account, offers only the next service, and each "Not now" moves to the one after', () => {
        expect(selectHomeConnectInvitations({ connectable: [claude, gemini], hidden: new Set(), hasAccounts: true }))
            .toEqual({ kind: 'next', service: claude });
        expect(selectHomeConnectInvitations({
            connectable: [claude, gemini],
            hidden: new Set([homeConnectServiceStepId(claude.serviceKey)]),
            hasAccounts: true,
        })).toEqual({ kind: 'next', service: gemini });
    });

    it('leaves once every service is connected or dismissed, and "Hide" removes the whole invitation', () => {
        expect(selectHomeConnectInvitations({
            connectable: [claude],
            hidden: new Set([homeConnectServiceStepId(claude.serviceKey)]),
            hasAccounts: true,
        })).toEqual({ kind: 'none' });
        expect(selectHomeConnectInvitations({
            connectable: [claude, gemini],
            hidden: new Set([HOME_CONNECT_INVITATION_STEP_ID]),
            hasAccounts: false,
        })).toEqual({ kind: 'none' });
    });
});
