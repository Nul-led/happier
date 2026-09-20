import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamInvitationPreviewV1 } from '@happier-dev/protocol/teams';

// The bundled first-party voice projection is a generated build artifact, not
// source. This join shell renders no voice surface, so it stays independent of
// that artifact the same way the Team settings shell tests do.
vi.mock('@/voice/registry/generatedBundledVoiceEntries', () => ({
    BUNDLED_FIRST_PARTY_VOICE_CONTRIBUTIONS: Object.freeze([]),
    BUNDLED_FIRST_PARTY_VOICE_PRESENTATIONS: Object.freeze([]),
}));

import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { renderScreen } from '@/dev/testkit/render/renderScreen';

import { TeamInvitationPreviewDetails } from './TeamInvitationPreviewDetails';

function activePreview(overrides: Partial<TeamInvitationPreviewV1> = {}): TeamInvitationPreviewV1 {
    return {
        home: { serverId: 'srv_acme', displayName: 'Acme Home', storageMode: null, hosting: null },
        team: { teamId: 'team-1', name: 'Acme Team', logo: null, accentSeed: 'team-1' },
        role: 'member',
        historyAccess: 'from_membership',
        state: 'active',
        expiresAt: Date.UTC(2030, 0, 1),
        recipientEmailMask: null,
        inviterLabel: null,
        ...overrides,
    };
}

describe('TeamInvitationPreviewDetails', () => {
    afterEach(() => standardCleanup());

    it('names who invited you when the Home published a label for them', async () => {
        const rendered = await renderScreen(
            <TeamInvitationPreviewDetails
                state={{ kind: 'ready', preview: activePreview({ inviterLabel: 'Ada Lovelace' }) }}
            />,
        );

        const line = rendered.findByTestId('team-join-preview-inviter');
        expect(line).not.toBeNull();
        expect(rendered.getTextContent()).toContain('Ada Lovelace');
    });

    it('says nothing about the inviter when the Home published no label', async () => {
        const rendered = await renderScreen(
            <TeamInvitationPreviewDetails state={{ kind: 'ready', preview: activePreview() }} />,
        );

        // An inviter whose Account no longer resolves leaves the consequences the
        // Home did publish intact rather than showing an empty or placeholder line.
        expect(rendered.findByTestId('team-join-preview-inviter')).toBeNull();
        expect(rendered.findByTestId('team-join-preview-role')).not.toBeNull();
    });
});
