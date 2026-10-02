import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { MachineAgent } from '@/agents/machineAgents/machineAgentTypes';
import { renderScreen } from '@/dev/testkit';

import { AgentSessionStartBlocker } from './AgentSessionStartBlocker';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

const signedOutAgent = {
    agentId: 'claude', title: 'Claude', state: 'needsSignIn', installed: true,
    version: '1', latestVersion: '1', update: null,
    signIn: { status: 'signedOut', via: null, nativeLogin: 'terminal', connectedServices: [] },
    platform: { supported: true },
    install: { available: false, mode: 'manual', sizeBytes: null, guideUrl: null, requiresVendorConsent: false },
    dependencies: [], job: null, stale: false,
} satisfies MachineAgent;

describe('AgentSessionStartBlocker', () => {
    it('retains the sign-in blocker but disables setup when its consumer has no resolved destination', async () => {
        const screen = await renderScreen(<AgentSessionStartBlocker agent={signedOutAgent} machineName="Devbox" onSetUp={undefined} />);
        expect(screen.findByTestId('new-session-agent-blocker')).not.toBeNull();
        expect(screen.findByTestId('new-session-agent-blocker.action')?.props.disabled).toBe(true);
        await screen.pressByTestIdAsync('new-session-agent-blocker.action');
        await screen.unmount();
    });

    it('allows setup once its consumer has a resolved destination', async () => {
        const openSetup = vi.fn();
        const screen = await renderScreen(<AgentSessionStartBlocker agent={signedOutAgent} machineName="Devbox" onSetUp={openSetup} />);
        expect(screen.findByTestId('new-session-agent-blocker.action')?.props.disabled).not.toBe(true);
        await screen.pressByTestIdAsync('new-session-agent-blocker.action');
        expect(openSetup).toHaveBeenCalledWith(signedOutAgent);
        await screen.unmount();
    });
});
