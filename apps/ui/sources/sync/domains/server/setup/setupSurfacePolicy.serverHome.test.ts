import { describe, expect, it, vi } from 'vitest';

import type { SetupSurfacePolicy } from './setupSurfacePolicy';

const host = vi.hoisted(() => ({ kind: 'tauri' as 'tauri' | null }));

vi.mock('@/utils/platform/desktopHost', () => ({ desktopHostKind: () => host.kind }));

const policy: SetupSurfacePolicy = {
    relay: {
        allowRelaySelection: true,
        allowHappierCloud: true,
        allowCustomRelayUrl: true,
        allowLocalRelayHost: false,
        allowRemoteSshRelayHost: true,
        enforcedServerUrl: null,
    },
    machine: { allowLocalMachineSetup: true, allowRemoteSshMachineSetup: true },
    providers: { allowProviderSetup: true },
    relayAccess: { allowTailscale: true, allowCloudflareTunnel: true },
};

describe('server Home setup availability', () => {
    it('offers desktop SSH relay-host setup even when local hosting is unavailable, but never on a phone or browser', async () => {
        const { canSetUpServerHomeHere } = await import('./setupSurfacePolicy');
        expect(canSetUpServerHomeHere(policy)).toBe(true);
        host.kind = null;
        expect(canSetUpServerHomeHere(policy)).toBe(false);
        host.kind = 'tauri';
        expect(canSetUpServerHomeHere({ ...policy, relay: { ...policy.relay, allowRelaySelection: false } })).toBe(false);
    });
});
