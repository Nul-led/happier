import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', async () => {
    const { createServerScopedMachineRpcBoundaryMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return createServerScopedMachineRpcBoundaryMock(vi.fn());
});

import { AgentInstallJobRpcError } from './api';
import { presentAgentInstallJobFailure, presentAgentInstallJobRpcFailure } from './presentAgentInstallJobFailure';

describe('agent install failure presentation', () => {
    it('distinguishes unavailable job operations from an unreachable machine without inventing an install outcome', () => {
        expect(presentAgentInstallJobRpcFailure(new AgentInstallJobRpcError('unavailable'))).toMatchObject({
            title: 'agentInstallJob.jobUnavailable', body: 'agentInstallJob.jobUnavailableBody',
        });
        expect(presentAgentInstallJobRpcFailure(new AgentInstallJobRpcError('request_failed'))).toMatchObject({
            title: 'agentInstallJob.machineUnreachable', body: 'agentInstallJob.unreachableBody',
        });
        expect(presentAgentInstallJobRpcFailure(new AgentInstallJobRpcError('invalid_response'))).toMatchObject({
            title: 'agentInstallJob.failed', body: 'agentInstallJob.failedBody',
        });
        expect(presentAgentInstallJobRpcFailure(new AgentInstallJobRpcError('job_not_found'))).toMatchObject({
            title: 'agentInstallJob.jobMissing', body: 'agentInstallJob.jobMissingBody',
        });
    });

    it('keeps raw vendor diagnostics out of primary copy and offers only an available recovery', () => {
        const failure = { kind: 'failed', code: 'update_not_available', stepId: 'cli', message: 'raw vendor output', guideUrl: 'https://example.com/install' } as const;
        expect(presentAgentInstallJobFailure(failure)).toMatchObject({
            body: 'agentInstallJob.updateBody', recovery: { kind: 'guide', guideUrl: failure.guideUrl },
        });
        expect(presentAgentInstallJobFailure({ ...failure, guideUrl: undefined }).recovery.kind).toBe('chooseAgent');
    });
});
