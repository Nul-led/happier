import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    SCM_OPERATION_ERROR_CODES,
    type ScmRepositoryCloneInput,
    type ScmRepositoryCloneOutput,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { describe, expect, it } from 'vitest';

import { createTestRpcManager } from './testRpcHarness';
import { executeScmActionOperation } from '@/scm/actions/executeScmActionOperation';
import { createScmBackendRegistry } from '@/scm/registry';
import { createRegisteredScmBackendAdapter } from '@/scm/pluginBackends/registeredScmBackendAdapter';
import { createGitScmBackendRuntimeRegistration } from '../../../../../../packages/plugins/scm-git/src/backend';
import { createScmHostingProviderRuntimeServicesForTest } from '../../../../../../packages/plugins/scm-git/src/testkit/scmRuntime.test-support';

function makeCloneRequest(parent: string): ScmRepositoryCloneInput {
    return {
        provider: {
            id: 'github:github.com',
            kind: 'github',
            displayName: 'GitHub',
            baseUrl: 'https://github.com',
            urlSafety: { allowedSchemes: ['https:'] },
        },
        repository: {
            nameWithOwner: 'happier-dev/happier',
            webUrl: 'https://github.com/happier-dev/happier',
            cloneUrl: 'https://github.com/happier-dev/happier.git',
            visibility: 'public',
            defaultBranch: 'main',
        },
        destinationParentPath: parent,
        destinationDirectoryName: 'happier',
        protocol: 'https',
        confirmed: true,
        authorizationToken: 'clone-repository',
    };
}

describe('git RPC handlers (repository clone)', () => {
    const registration = createGitScmBackendRuntimeRegistration();
    const registry = createScmBackendRegistry([createRegisteredScmBackendAdapter({
        definition: { id: 'git', kind: 'git' }, qualifiedId: 'happier.scm.backend.git/git',
        executableDefinition: registration.runtime!, registration,
        hostingProviderRuntimeServices: createScmHostingProviderRuntimeServicesForTest(),
    })]);
    it('registers repository clone and rejects conflicting destination contents before cloning', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'happier-git-clone-rpc-'));
        const destination = join(workspace, 'happier');
        mkdirSync(destination);
        writeFileSync(join(destination, 'existing.txt'), 'keep\n');
        const { call } = createTestRpcManager({ workingDirectory: workspace, registry });

        const domainRequest = makeCloneRequest(workspace);
        const negotiatedRequest = { ...domainRequest, cwd: workspace, backendPreference: { kind: 'prefer' as const, backendId: 'git' }, outcomeVersion: 1 as const };
        for (const request of [domainRequest, negotiatedRequest]) {
            const response = await call<ScmRepositoryCloneOutput, typeof request>(RPC_METHODS.SCM_REPOSITORY_CLONE, request);
            // Both ingress shapes must reach the real no-overwrite guard, not
            // fail clone's strict domain schema on known transport metadata.
            expect(response).toMatchObject({ success: false, errorCode: SCM_OPERATION_ERROR_CODES.INVALID_PATH });
        }
        for (const metadata of [{ cwd: 1 }, { outcomeVersion: 2 }, { backendPreference: { kind: 'prefer', backendId: '' } }, { unknownField: true }]) {
            const request = { ...domainRequest, ...metadata };
            expect(await call<ScmRepositoryCloneOutput, typeof request>(RPC_METHODS.SCM_REPOSITORY_CLONE, request))
                .toMatchObject({ success: false, errorCode: SCM_OPERATION_ERROR_CODES.INVALID_REQUEST });
        }
        // Transport metadata is not part of the public Action mutation input.
        await expect(executeScmActionOperation({ actionId: 'scm.repository.clone', input: negotiatedRequest, workingDirectory: workspace }))
            .rejects.toMatchObject({ issues: [expect.objectContaining({ code: 'unrecognized_keys' })] });
        expect(existsSync(join(destination, 'existing.txt'))).toBe(true);
        expect(existsSync(join(destination, '.git'))).toBe(false);
    });

    it('rejects home-expanded destination parents before filesystem authorization', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'happier-git-clone-rpc-'));
        const { call } = createTestRpcManager({ workingDirectory: workspace, registry });

        const response = await call<ScmRepositoryCloneOutput, ScmRepositoryCloneInput>(
            RPC_METHODS.SCM_REPOSITORY_CLONE,
            {
                ...makeCloneRequest(workspace),
                destinationParentPath: '~/Code',
            },
        );

        expect(response).toMatchObject({
            success: false,
            errorCode: SCM_OPERATION_ERROR_CODES.INVALID_REQUEST,
        });
        expect(existsSync(join(workspace, '~'))).toBe(false);
    });
});
