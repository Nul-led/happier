import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { TeamCredentialRequestPolicySupportOutputV1 } from '@happier-dev/protocol/teams';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';
import { EMPTY_TEAM_CREDENTIAL_POLICY_DRAFT, type TeamCredentialPolicyDraft } from './teamCredentialEditorDraft';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installSettingsViewCommonModuleMocks();

afterEach(() => standardCleanup());

const AVAILABLE_SUPPORT: TeamCredentialRequestPolicySupportOutputV1 = {
    status: 'available',
    models: [{
        descriptor: { id: 'model-1', name: 'Model One', description: 'Canonical model' },
        application: {
            agentTargetKey: 'agent:happier.agent.codex/codex',
            implementationIdentity: { pluginId: 'happier.provider.test', localId: 'test' },
            endpointTemplateId: 'responses',
            protocol: 'openai-responses',
        },
        sourceRevision: 'source-1',
        allowedProtocolKinds: ['openai_responses'],
        reasoningEffort: { allowedValues: ['low', 'high'], defaultValue: 'low' },
        maxOutputTokens: { maximum: 32_000 },
        maxThinkingBudgetTokens: null,
    }],
};

async function mount(support: TeamCredentialRequestPolicySupportOutputV1) {
    const { TeamCredentialRequestPolicyEditorSection } = await import('./TeamCredentialRequestPolicyEditorSection');
    let latestDraft: TeamCredentialPolicyDraft = EMPTY_TEAM_CREDENTIAL_POLICY_DRAFT;
    function ControlledEditor() {
        const [draft, setDraft] = React.useState(EMPTY_TEAM_CREDENTIAL_POLICY_DRAFT);
        latestDraft = draft;
        return <TeamCredentialRequestPolicyEditorSection draft={draft} setDraft={setDraft} support={support} busy={false} />;
    }
    return { screen: await renderScreen(<ControlledEditor />), draft: () => latestDraft };
}

describe('TeamCredentialRequestPolicyEditorSection', () => {
    it('renders only fields explicitly advertised by the canonical support projection', async () => {
        const { screen } = await mount(AVAILABLE_SUPPORT);

        expect(screen.findByTestId('team-credential-request-policy-model:model-1')).not.toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-protocol:openai_responses')).not.toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-protocol:anthropic_messages')).toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-effort:low')).not.toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-max-output')).not.toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-max-thinking')).toBeNull();
    });

    it('deduplicates model ids and intersects support across every allowed model path', async () => {
        const base = AVAILABLE_SUPPORT.status === 'available' ? AVAILABLE_SUPPORT.models[0]! : null;
        if (!base) throw new Error('available support fixture missing');
        const support = {
            status: 'available',
            models: [
                {
                    ...base,
                    allowedProtocolKinds: ['openai_responses', 'anthropic_messages'],
                    reasoningEffort: { allowedValues: ['low', 'high'], defaultValue: 'low' },
                    maxOutputTokens: { maximum: 32_000 },
                },
                {
                    ...base,
                    application: { ...base.application, endpointTemplateId: 'chat', protocol: 'openai-chat' },
                    allowedProtocolKinds: ['openai_responses'],
                    reasoningEffort: { allowedValues: ['high'], defaultValue: 'high' },
                    maxOutputTokens: { maximum: 16_000 },
                },
                {
                    ...base,
                    descriptor: { id: 'model-2', name: 'Model Two' },
                    // Anthropic is available for model-2, but must still stay
                    // hidden because one exact application for model-1 cannot
                    // enforce it.
                    allowedProtocolKinds: ['openai_responses', 'anthropic_messages'],
                    reasoningEffort: { allowedValues: ['high'], defaultValue: 'high' },
                    maxOutputTokens: null,
                },
            ],
        } as const;
        const { projectTeamCredentialRequestPolicyEditorSupport } = await import('./TeamCredentialRequestPolicyEditorSection');
        const projection = projectTeamCredentialRequestPolicyEditorSupport({
            models: support.models,
            draft: EMPTY_TEAM_CREDENTIAL_POLICY_DRAFT,
        });
        expect(projection.models.map((model) => model.descriptor.id)).toEqual(['model-1', 'model-2']);

        const { screen } = await mount(support);
        expect(screen.findByTestId('team-credential-request-policy-model:model-2')).not.toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-protocol:openai_responses')).not.toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-protocol:anthropic_messages')).toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-effort:high')).not.toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-effort:low')).toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-max-output')).toBeNull();
    });

    it('preserves an invalid numeric string in the controlled draft', async () => {
        const { screen, draft } = await mount(AVAILABLE_SUPPORT);

        act(() => screen.changeTextByTestId('team-credential-request-policy-max-output', '12oops'));

        expect(draft().maxOutputTokens).toBe('12oops');
        expect(screen.findByTestId('team-credential-request-policy-max-output')?.props.value).toBe('12oops');
    });

    it('renders an explicit unavailable state without inferring controls', async () => {
        const { screen } = await mount({ status: 'unavailable', reason: 'source_unavailable' });

        expect(screen.findByTestId('team-credential-request-policy-support-unavailable')).not.toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-max-output')).toBeNull();
        expect(screen.findByTestId('team-credential-request-policy-protocol:openai_responses')).toBeNull();
    });

    it('keeps an existing policy visible and explicitly repairable while support is unavailable', async () => {
        const { TeamCredentialRequestPolicyEditorSection } = await import('./TeamCredentialRequestPolicyEditorSection');
        let latestDraft: TeamCredentialPolicyDraft = {
            ...EMPTY_TEAM_CREDENTIAL_POLICY_DRAFT,
            allowedModelIds: ['stored-model'],
        };
        function ControlledEditor() {
            const [draft, setDraft] = React.useState(latestDraft);
            latestDraft = draft;
            return <TeamCredentialRequestPolicyEditorSection
                draft={draft}
                setDraft={setDraft}
                support={{ status: 'unavailable', reason: 'source_unavailable' }}
                busy={false}
            />;
        }
        const screen = await renderScreen(<ControlledEditor />);

        expect(screen.findByTestId('team-credential-request-policy-stored-unsupported')).not.toBeNull();
        await screen.pressByTestIdAsync('team-credential-request-policy-clear');
        expect(latestDraft.allowedModelIds).toBeNull();
    });
});
