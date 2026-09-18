import { describe, expect, it, vi } from 'vitest';

import { createMachineFixture } from '@/dev/testkit';
import { resolveServerScopedMachine } from './resolveServerScopedMachine';

vi.mock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: () => ({ serverId: 'server-owned' }) }));

describe('resolveServerScopedMachine', () => {
    it('does not fall back to a global machine excluded by a settled scoped list', () => {
        const globalMachine = createMachineFixture();

        expect(resolveServerScopedMachine({
            machines: { 'machine-1': globalMachine },
            machineListByServerId: { 'server-owned': [] },
            machineListStatusByServerId: { 'server-owned': 'idle' },
        }, 'server-owned', 'machine-1')).toBeNull();
    });

    it('does not borrow active Home capability while a foreign Home list is loading', () => {
        const globalMachine = createMachineFixture();
        expect(resolveServerScopedMachine({
            machines: { 'machine-1': globalMachine },
            machineListByServerId: { 'server-foreign': null },
            machineListStatusByServerId: { 'server-foreign': 'loading' },
        }, 'server-foreign', 'machine-1')).toBeNull();
    });

    it('preserves the global fallback while a scoped machine list is still loading', () => {
        const globalMachine = createMachineFixture();

        expect(resolveServerScopedMachine({
            machines: { 'machine-1': globalMachine },
            machineListByServerId: { 'server-owned': null },
            machineListStatusByServerId: { 'server-owned': 'loading' },
        }, 'server-owned', 'machine-1')).toBe(globalMachine);
    });
});
