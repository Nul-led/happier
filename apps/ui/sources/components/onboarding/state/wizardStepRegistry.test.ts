import { describe, expect, it } from 'vitest';

import type { WizardContext } from './wizardTypes';
import { getWizardStepDefinition } from './wizardStepRegistry';

describe('wizardStepRegistry', () => {
    it('shows the background service handoff step on native for the local-handoff branch', () => {
        const context: WizardContext = {
            mode: 'onboarding',
            platform: 'native',
            canScanQr: false,
            scanStepEnabled: false,
            canRunSystemTasks: false,
            relaySelection: {
                choiceId: 'thisComputer',
                serverUrl: 'https://relay.local.test',
                relayProfileId: null,
                locked: false,
            },
            relayAccessProviderId: null,
            relayLockConfirmationPending: false,
            relaySwitchConfirmationPending: false,
            authIntent: 'standard',
        };

        const step = getWizardStepDefinition('background_service_handoff');
        expect(step.visibleWhen(context)).toBe(true);
    });

    it('keeps Home hosting, access and switch confirmation in pre-auth onboarding', () => {
        const context: WizardContext = {
            mode: 'onboarding', platform: 'desktop', canScanQr: false, scanStepEnabled: false,
            canRunSystemTasks: true,
            relaySelection: { choiceId: 'thisComputer', serverUrl: 'https://relay.local.test', locked: false },
            relayAccessProviderId: 'lan', relayLockConfirmationPending: false,
            relaySwitchConfirmationPending: true, authIntent: 'standard',
        };
        for (const step of ['host_relay_local', 'relay_access', 'relay_access_prereqs', 'confirm_switch_relay'] as const) {
            expect(getWizardStepDefinition(step).visibleWhen(context)).toBe(true);
        }
    });
});
