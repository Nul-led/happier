import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { ScmStatusSnapshotResponseSchema } from '@happier-dev/protocol/scm';

import type { RpcHandler } from '@/api/rpc/types';
import { createScmBackendRegistry } from '@/scm/registry';
import { createRegisteredScmBackendAdapter } from '@/scm/pluginBackends/registeredScmBackendAdapter';
import { createGitScmBackendRuntimeRegistration } from '../../../../../packages/plugins/scm-git/src/backend';
import { createScmHostingProviderRuntimeServicesForTest } from '../../../../../packages/plugins/scm-git/src/testkit/scmRuntime.test-support';
import { registerScmHandlers } from './scm';

const execFile = promisify(execFileCallback);

describe('SCM status snapshot RPC payload', () => {
    const directories: string[] = [];
    afterEach(async () => {
        vi.unstubAllEnvs();
        await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
    });

    it('omits repeated neutral values at the real producer while retaining every changed path and current statistics', async () => {
        vi.stubEnv('HAPPIER_SCM_STATUS_SNAPSHOT_CACHE_TTL_MS', '0');
        const root = await mkdtemp(join(tmpdir(), 'scm-payload-'));
        directories.push(root);
        await execFile('git', ['init', '--quiet'], { cwd: root });
        await writeFile(join(root, 'new.txt'), 'first\nsecond\n');
        const registration = createGitScmBackendRuntimeRegistration();
        const registry = createScmBackendRegistry([createRegisteredScmBackendAdapter({
            definition: { id: 'git', kind: 'git' }, qualifiedId: 'happier.scm.backend.git/git',
            executableDefinition: registration.runtime!, registration,
            hostingProviderRuntimeServices: createScmHostingProviderRuntimeServicesForTest(),
        })]);
        const handlers = new Map<string, RpcHandler>();
        registerScmHandlers({ registerHandler: (method, handler) => { handlers.set(method, handler); } }, root, { registry });
        const status = handlers.get(RPC_METHODS.SCM_STATUS_SNAPSHOT);
        if (!status) throw new Error('Status handler was not registered');
        const wire = JSON.parse(JSON.stringify(await status({ cwd: root, outcomeVersion: 1 }))) as {
            snapshot: { entries: Record<string, unknown>[] };
        };
        expect(wire.snapshot.entries).toHaveLength(1);
        expect.soft(wire.snapshot.entries[0]).not.toHaveProperty('previousPath');
        expect.soft(wire.snapshot.entries[0]).not.toHaveProperty('hasIncludedDelta');
        expect.soft(wire.snapshot.entries[0]?.stats).toEqual({ pendingAdded: 2 });
        const decoded = ScmStatusSnapshotResponseSchema.parse(wire);
        expect(decoded.snapshot?.entries[0]).toMatchObject({
            path: 'new.txt', previousPath: null, kind: 'untracked', hasIncludedDelta: false, hasPendingDelta: true,
            stats: { includedAdded: 0, includedRemoved: 0, pendingAdded: 2, pendingRemoved: 0, isBinary: false },
        });
        await writeFile(join(root, 'new.txt'), 'changed\n');
        const refreshed = ScmStatusSnapshotResponseSchema.parse(await status({ cwd: root, outcomeVersion: 1 }));
        expect(refreshed.snapshot?.entries[0]?.stats.pendingAdded).toBe(1);
    });
});
