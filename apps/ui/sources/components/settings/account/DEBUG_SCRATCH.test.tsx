import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const endpointState = vi.hoisted(() => ({
    endpoint: {
        url: 'https://accounts.example.test',
        displayName: 'Company Account Service',
        source: 'user' as const,
    } as { url: string; serverIdentityId?: string; displayName?: string; source: 'user' },
    set: vi.fn(),
    listeners: new Set<() => void>(),
}));
const probeServerFeaturesAtUrlMock = vi.hoisted(() => vi.fn());
const credentialGetMock = vi.hoisted(() => vi.fn(async () => ({ token: 'directory-token' })));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
    return {
        ...actual,
        getAccountServiceEndpointSnapshot: () => endpointState.endpoint,
        subscribeAccountServiceEndpoint: (listener: () => void) => {
            endpointState.listeners.add(listener);
            return () => endpointState.listeners.delete(listener);
        },
        setAccountServiceEndpoint: (next: typeof endpointState.endpoint) => {
            endpointState.endpoint = next;
            endpointState.set(next);
            for (const listener of endpointState.listeners) listener();
        },
    };
});
vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    probeServerFeaturesAtUrl: probeServerFeaturesAtUrlMock,
}));
vi.mock('@/auth/accountDirectory/accountDirectoryCredentialStorage', () => ({
    accountDirectoryCredentialStorage: { get: credentialGetMock },
    normalizeAccountDirectoryEndpoint: (value: string) => value.trim().replace(/\/+$/, ''),
}));
vi.mock('@/sync/ops/accountDirectory/refreshAccountHomeDirectory', () => ({
    refreshAccountHomeDirectory: vi.fn(),
}));
vi.mock('@/sync/ops/accountDirectory/enrollPreferredDirectoryHome', () => ({
    enrollPreferredDirectoryHome: vi.fn(),
    cancelPendingPreferredHomeEnrollment: vi.fn(async () => {}),
    resumePendingPreferredHomeEnrollment: vi.fn(async () => null),
    getPendingPreferredHomeEnrollment: () => null,
    subscribePendingPreferredHomeEnrollment: () => () => {},
}));

import { AccountServiceSettingsSection } from './AccountServiceSettingsSection';
import { renderScreen as renderScreenBase } from '@/dev/testkit';

describe('debug', () => {
    it('expands advanced and lists test ids', async () => {
        probeServerFeaturesAtUrlMock.mockResolvedValue({
            status: 'ready',
            serverIdentityId: 'directory-1',
            features: { capabilities: { server: {}, accountDirectory: { version: 1, homeDirectory: true, homeEnrollment: true, homeLoginAssertion: { keyId: 'a'.repeat(64), publicKeyBase64Url: 'A'.repeat(43) } } } },
        });
        const screen = await renderScreenBase(<AccountServiceSettingsSection />);
        const advanced = screen.findAll((node) => node.props?.testID === 'settings-account-service-advanced')[0];
        console.log('ADVANCED FOUND:', Boolean(advanced), advanced?.type, advanced?.props?.expanded);
        if (advanced) act(() => advanced.props.onExpandedChange(true));
        console.log('AFTER EXPAND expanded prop:', screen.findAll((node) => node.props?.testID === 'settings-account-service-advanced')[0]?.props?.expanded);
        const ids = screen.findAllByTestId('settings-account-service-select');
        console.log('SELECT MATCHES:', ids.length, ids[0]?.props?.subtitle);
        const allTestIds = screen.findAll((node) => typeof node.props?.testID === 'string').map((n) => n.props.testID);
        console.log('ALL IDS:', JSON.stringify(allTestIds));
        expect(true).toBe(true);
    });
});
