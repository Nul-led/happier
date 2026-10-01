import { describe, expect, it } from 'vitest';
import { SCM_OPERATION_ERROR_CODES, type ScmHostingRepositoryDescribePublishTargetsResponse } from '@happier-dev/protocol/scm';

import { createAzureDevopsOperationsAdapter } from '../../../../../../../packages/plugins/scm-azure-devops/src/operations/azureDevopsAdapter';
import { resolveSourceControlPublishRepositoryRemediation } from './resolveSourceControlPublishRepositoryRemediation';

describe('publish repository remediation retry', () => {
    it('allows the existing loader to retry actual Azure auth discovery and stops after authentication', async () => {
        const describeTargets = async (authenticated: boolean) => ({
            success: true as const,
            defaultRepositoryName: 'repo',
            ...await createAzureDevopsOperationsAdapter().describePublishTargets({
                provider: {
                    id: 'happier.scm.forge.azure-devops/azure-devops', kind: 'azure-devops', displayName: 'Azure DevOps',
                    baseUrl: 'https://dev.azure.com/acme', nameWithOwner: 'acme/platform/repo',
                    urlSafety: { allowedSchemes: ['https:'] },
                },
                defaultRepositoryName: 'repo',
                // The provider's real detector runs through the OS command boundary.
                runtimeServices: { executeCommand: async () => authenticated
                    ? { ok: true, exitCode: 0, stdout: '{"user":{"name":"user@example.com"}}', stderr: '' }
                    : { ok: false, exitCode: 1, stdout: '', stderr: 'Please run az login' } },
            }),
        });
        const signedOut = await describeTargets(false);
        const input = {
            targetsResponse: signedOut,
            selectedTarget: signedOut.targets[0] ?? null,
            publishFailure: null,
            canRetryTargets: true,
        };
        expect(resolveSourceControlPublishRepositoryRemediation(input).retryTargets).toEqual({ disabled: false });
        expect(resolveSourceControlPublishRepositoryRemediation({ ...input, canRetryTargets: false }).retryTargets).toBeNull();
        expect(resolveSourceControlPublishRepositoryRemediation({ ...input, disabled: true }).retryTargets).toEqual({ disabled: true });
        expect(resolveSourceControlPublishRepositoryRemediation(input).action).toEqual({
            kind: 'authenticate-provider-cli', providerName: 'Azure DevOps', command: 'az login', disabled: false,
        });
        const authenticated = await describeTargets(true);
        expect(resolveSourceControlPublishRepositoryRemediation({
            ...input, targetsResponse: authenticated, selectedTarget: authenticated.targets[0] ?? null,
        }).retryTargets).toBeNull();
    });

    it('retains retry for unavailable discovery without claiming sign-in is required', () => {
        const targetsResponse: ScmHostingRepositoryDescribePublishTargetsResponse = {
            success: false, error: 'Probe did not complete', errorCode: SCM_OPERATION_ERROR_CODES.COMMAND_FAILED,
        };
        const remediation = resolveSourceControlPublishRepositoryRemediation({
            targetsResponse, selectedTarget: null, publishFailure: null, canRetryTargets: true,
        });
        expect(remediation.retryTargets).toEqual({ disabled: false });
        expect(remediation.action).toBeNull();
        expect(remediation.authState).toBeNull();
    });
});
