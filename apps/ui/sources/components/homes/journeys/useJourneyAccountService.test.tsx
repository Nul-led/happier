import { describe, expect, it } from 'vitest';

import type { AccountDirectoryAuthMethodDiscovery } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { renderHook } from '@/dev/testkit';

import { useJourneySignInRequest } from './useJourneyAccountService';

const discovery = {
    endpointUrl: 'https://accounts.example.test',
    serverIdentityId: 'srv_accounts',
} as AccountDirectoryAuthMethodDiscovery;

describe('Home journey sign-in request', () => {
    it('enters a found Home when this device started without a usable Home', async () => {
        const hook = await renderHook(() => useJourneySignInRequest(discovery, true));
        expect(hook.getCurrent()?.intent).toEqual({ kind: 'enter', target: { kind: 'automatic' } });
        await hook.unmount();
    });

    it('adds found Homes without changing focus when this device already had a usable Home', async () => {
        const hook = await renderHook(() => useJourneySignInRequest(discovery, false));
        expect(hook.getCurrent()?.intent).toEqual({ kind: 'refresh' });
        await hook.unmount();
    });

    it('enrolls the explicitly chosen service Home without focus when usable Homes already existed', async () => {
        const hook = await renderHook(() => useJourneySignInRequest(discovery, false, 'use_service_as_home'));
        expect(hook.getCurrent()?.intent).toEqual({ kind: 'enroll', homeServerIdentityId: 'srv_accounts' });
        await hook.unmount();
    });

    it('enters the explicitly chosen service Home even if the directory prefers another Home', async () => {
        const hook = await renderHook(() => useJourneySignInRequest(discovery, true, 'use_service_as_home'));
        expect(hook.getCurrent()?.intent).toEqual({ kind: 'enter', target: { kind: 'explicit', homeServerIdentityId: 'srv_accounts' } });
        await hook.unmount();
    });
});
