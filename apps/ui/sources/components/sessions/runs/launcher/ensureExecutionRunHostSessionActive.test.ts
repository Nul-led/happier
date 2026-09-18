import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureExecutionRunHostSessionActive } from './ensureExecutionRunHostSessionActive';

const resumeSpy = vi.hoisted(() => vi.fn());
const baseSpy = vi.hoisted(() => vi.fn());
const readMachineControlTargetSpy = vi.hoisted(() => vi.fn());

vi.mock('@/sync/ops/sessions', () => ({ resumeSession: (...args: unknown[]) => resumeSpy(...args) }));
vi.mock('@/sync/domains/session/resume/resumeSessionBase', () => ({
    buildResumeSessionBaseOptionsFromSession: (...args: unknown[]) => baseSpy(...args),
}));
vi.mock('@/sync/domains/permissions/permissionModeOverride', () => ({ getPermissionModeOverrideForSpawn: () => null }));
vi.mock('@/sync/domains/models/modelOverride', () => ({ getModelOverrideForSpawn: () => null }));
vi.mock('@/agents/catalog/catalog', () => ({ buildResumeSessionExtrasFromUiState: () => ({}) }));
vi.mock('@/sync/ops/sessionMachineTarget', () => ({
    readMachineControlTargetForSession: (...args: unknown[]) => readMachineControlTargetSpy(...args),
}));

const common = {
    sessionId: 'session_1',
    machineReachable: true,
    resumeCapabilityOptions: {},
    sessionActionDefaultBackend: null,
    agentId: 'claude',
    settings: {} as any,
    serverId: 'server_1',
} as const;

describe('ensureExecutionRunHostSessionActive', () => {
    beforeEach(() => {
        resumeSpy.mockReset();
        baseSpy.mockReset();
        baseSpy.mockReturnValue({ sessionId: 'session_1', machineId: 'machine_1', directory: '/repo' });
        resumeSpy.mockResolvedValue({ type: 'success' });
        readMachineControlTargetSpy.mockReturnValue({ machineId: 'machine_1' });
    });

    it('does not invent a second wake when the ordinary Session is already active', async () => {
        await expect(ensureExecutionRunHostSessionActive({
            ...common,
            session: { id: 'session_1', active: true, metadata: {} } as any,
        })).resolves.toEqual({ ok: true });
        expect(resumeSpy).not.toHaveBeenCalled();
    });

    it('reuses ordinary exact-Home Session resume before a Run start', async () => {
        await expect(ensureExecutionRunHostSessionActive({
            ...common,
            session: { id: 'session_1', active: false, metadata: {} } as any,
        })).resolves.toEqual({ ok: true });
        expect(resumeSpy).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session_1',
            serverId: 'server_1',
        }));
    });

    it('waits for real runtime readiness under the rowless first-send operation identity', async () => {
        await expect(ensureExecutionRunHostSessionActive({
            ...common,
            readinessOperationId: 'draft-correlation-1',
            session: { id: 'session_1', active: false, metadata: {} } as any,
        })).resolves.toEqual({ ok: true });
        expect(resumeSpy).toHaveBeenCalledWith(expect.objectContaining({
            spawnNonce: 'execution-run-host-draft-correlation-1',
            waitForReady: true,
        }));
    });

    it('fails before resume when the owning Machine is offline', async () => {
        await expect(ensureExecutionRunHostSessionActive({
            ...common,
            machineReachable: false,
            session: { id: 'session_1', active: false, metadata: {} } as any,
        })).resolves.toEqual({ ok: false, reason: 'machine_offline' });
        expect(resumeSpy).not.toHaveBeenCalled();
    });

    it('fails before resume when the exact preflight Machine is no longer the Session target', async () => {
        readMachineControlTargetSpy.mockReturnValue({ machineId: 'machine_2' });

        await expect(ensureExecutionRunHostSessionActive({
            ...common,
            expectedMachineId: 'machine_1',
            session: { id: 'session_1', active: false, metadata: {} } as any,
        })).resolves.toEqual({
            ok: false,
            reason: 'resume_failed',
            error: 'execution_run_target_changed',
        });
        expect(resumeSpy).not.toHaveBeenCalled();
    });
});
