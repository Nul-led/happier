import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { renderScreen, standardCleanup, teamCredentialResourceFixture } from '@/dev/testkit';

import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';
import type { TeamSectionContext } from '../teamSectionContext';
import { EMPTY_TEAM_CREDENTIAL_RESOURCE_DRAFT, type TeamCredentialResourceDraft } from './teamCredentialEditorDraft';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installSettingsViewCommonModuleMocks();

afterEach(() => standardCleanup());

const context = {
    scope: { serverId: 'server-1', accountId: 'account-owner' },
    address: { serverId: 'server-1', teamId: 'team-1' },
} as TeamSectionContext;

const usageCapabilities = {
    inferenceRequests: 'available',
    totalTokens: 'available',
    costUsd: 'unavailable',
    limitCoverage: 'brokered_only',
} as const;

async function mount(initial: TeamCredentialResourceDraft) {
    const { TeamCredentialLimitsEditorSection } = await import('./TeamCredentialLimitsEditorSection');
    let latest = initial;
    function ControlledEditor() {
        const [draft, setDraft] = React.useState(initial);
        latest = draft;
        return (
            <TeamCredentialLimitsEditorSection
                context={context}
                resource={teamCredentialResourceFixture({ usageCapabilities })}
                usageCapabilities={usageCapabilities}
                draft={draft}
                busy={false}
                onRequestDraftChange={setDraft}
            />
        );
    }
    return { screen: await renderScreen(<ControlledEditor />), draft: () => latest };
}

describe('TeamCredentialLimitsEditorSection', () => {
    it('edits and removes saved rules through the complete controlled resource draft', async () => {
        const initial = {
            ...EMPTY_TEAM_CREDENTIAL_RESOURCE_DRAFT,
            limits: [{
                id: 'limit-existing',
                subjectKind: 'resource' as const,
                subjectId: '',
                metric: 'total_tokens' as const,
                period: 'month' as const,
                maximum: 'raw-invalid-value',
                enabled: false,
            }],
        };
        const { screen, draft } = await mount(initial);

        await screen.pressByTestIdAsync('team-credential-limit-edit:limit-existing');
        expect(draft().pendingLimit).toEqual(initial.limits[0]);
        expect(screen.findByTestId('team-credential-limit-maximum')?.props.value).toBe('raw-invalid-value');

        act(() => screen.changeTextByTestId('team-credential-limit-maximum', '250'));
        await screen.pressByTestIdAsync('team-credential-limit-save');
        expect(draft().limits).toEqual([{ ...initial.limits[0], maximum: '250' }]);
        expect(draft().limits[0]?.id).toBe('limit-existing');
        expect(draft().limits[0]?.enabled).toBe(false);

        await screen.pressByTestIdAsync('team-credential-limit-remove:limit-existing');
        expect(draft().limits).toEqual([]);
        expect(draft().name).toBe(initial.name);
        expect(draft().audience).toBe(initial.audience);
    });

    it('adds a named-member rule with the picker actor Account id and only canonical metrics', async () => {
        const { screen, draft } = await mount(EMPTY_TEAM_CREDENTIAL_RESOURCE_DRAFT);

        await screen.pressByTestIdAsync('team-credential-limit-add');
        expect(screen.findByTestId('team-credential-limit-metric:inference_requests')).not.toBeNull();
        expect(screen.findByTestId('team-credential-limit-metric:total_tokens')).not.toBeNull();
        expect(screen.findByTestId('team-credential-limit-metric:cost_usd')).toBeNull();
        await screen.pressByTestIdAsync('team-credential-limit-subject:team_member');

        const picker = screen.tree.root.findAll((node) => (
            node.props.testID === 'team-credential-limit-member-choose'
            && typeof node.props.onChoose === 'function'
        ))[0];
        expect(picker).toBeDefined();
        act(() => picker!.props.onChoose({
            kind: 'member', id: 'membership-maya', accountId: 'account-maya', name: 'Maya',
        }));
        act(() => screen.changeTextByTestId('team-credential-limit-maximum', '10'));
        await screen.pressByTestIdAsync('team-credential-limit-save');

        expect(draft().limits).toEqual([expect.objectContaining({
            subjectKind: 'team_member',
            subjectId: 'account-maya',
            metric: 'inference_requests',
            maximum: '10',
        })]);
    });
});
