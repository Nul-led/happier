import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { useSessionListWorkspaceLabelMigration } from './useSessionListWorkspaceLabelMigration';

const migrateLegacyWorkspaceLabelInAccountSpy = vi.hoisted(() => vi.fn());

vi.mock('@/sync/ops/workspaceRefs', () => ({
    migrateLegacyWorkspaceLabelInAccount: (...args: unknown[]) => migrateLegacyWorkspaceLabelInAccountSpy(...args),
}));

function Harness() {
    useSessionListWorkspaceLabelMigration({
        workspaceLabels: { legacy_a: 'A', legacy_b: 'B' },
        scopeHintByLegacyWorkspaceKey: new Map([
            ['legacy_a', { serverId: 'server', machineId: 'm1', rootPath: '/a' }],
            ['legacy_b', { serverId: 'server', machineId: 'm2', rootPath: '/b' }],
        ]),
    });
    return null;
}

describe('useSessionListWorkspaceLabelMigration', () => {
    it('delegates each legacy key to the semantic Account Settings migration', async () => {
        standardCleanup();
        migrateLegacyWorkspaceLabelInAccountSpy
            .mockResolvedValueOnce({ ok: true, workspaceRefId: 'ref-a', migrated: true })
            .mockResolvedValueOnce({ ok: true, workspaceRefId: 'ref-b', migrated: false });
        await renderScreen(<Harness />);

        await vi.waitFor(() => expect(migrateLegacyWorkspaceLabelInAccountSpy).toHaveBeenCalledTimes(2));
        expect(migrateLegacyWorkspaceLabelInAccountSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({
            legacyKey: 'legacy_a',
        }));
        expect(migrateLegacyWorkspaceLabelInAccountSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({
            legacyKey: 'legacy_b',
        }));
    });
});
