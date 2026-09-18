import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

const boundary = vi.hoisted(() => ({ accountId: 'account-a', machineRPC: vi.fn() }));

// Credential persistence and the active socket are external boundaries. Terminal
// operations, peer routing, and scoped Account validation remain real.
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/auth/storage/tokenStorage')>(),
    TokenStorage: {
        getCredentialsForServerUrl: async () => ({ token: `hdr.${btoa(JSON.stringify({ sub: boundary.accountId }))}.sig` }),
    },
}));
vi.mock('@/sync/api/session/apiSocket', () => ({ apiSocket: { machineRPC: boundary.machineRPC } }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'home-a', serverUrl: 'https://home-a.test', generation: 1 }),
}));
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const { createPartialServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
    return createPartialServerProfilesModuleMock(importOriginal, {
        profiles: [{ id: 'home-a', serverUrl: 'https://home-a.test' }],
    });
});

describe('terminal captured Account scope', () => {
    beforeEach(() => {
        boundary.accountId = 'account-a';
        boundary.machineRPC.mockReset();
        boundary.machineRPC.mockImplementation(async (_machine: string, method: string) => (
            method === RPC_METHODS.DAEMON_TERMINAL_CLOSE
                ? { ok: true }
                : { ok: true, terminalId: 'terminal-a', reused: false }
        ));
    });

    it('rejects retained lifecycle operations after credentials switch within the same Home', async () => {
        const { machineTerminalEnsure, machineTerminalRestart, machineTerminalClose } = await import('./machineTerminal');
        const target = { serverId: 'home-a', accountId: 'account-a' };
        const launch = { terminalKey: 'terminal-key', cwd: '/tmp', cols: 80, rows: 24 };
        boundary.accountId = 'account-b';
        for (const operation of [
            () => machineTerminalEnsure('machine-1', launch, target),
            () => machineTerminalRestart('machine-1', launch, target),
            () => machineTerminalClose('machine-1', { terminalId: 'terminal-a' }, target),
        ]) {
            await expect(operation()).rejects.toThrow('Scoped credentials do not match requested Account');
        }
        expect(boundary.machineRPC).not.toHaveBeenCalled();
    });
});
