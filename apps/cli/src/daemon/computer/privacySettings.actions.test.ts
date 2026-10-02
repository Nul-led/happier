import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComputerRoutes } from './routes';
import { createMachineLiveStreamCaptureRegistry } from '../peer/mediation/stream/captureRegistry';

// OS dispatch is the boundary; Action admission and native routes remain real.
vi.mock('@happier-dev/cli-common/process', async importOriginal => ({
  ...await importOriginal<typeof import('@happier-dev/cli-common/process')>(),
  execFileWithDeadline: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));

const originalPlatform = process.platform;
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.restoreAllMocks();
});

describe('computer privacy settings Action execution', () => {
  it('requires approval, dispatches an approved agent request on this Mac, and refuses a different machine', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const routes = createComputerRoutes({ machineId: 'machine', registry: createMachineLiveStreamCaptureRegistry() });
    const input = { machineId: 'machine', permission: 'capture' };
    const context = { authority: 'account_automation' as const, defaultSessionId: 'session' };
    expect(await routes.dispatch('computer.permissions.openSettings', input, context))
      .toMatchObject({ ok: false, errorCode: 'approval_required' });
    expect(await routes.dispatch('computer.permissions.openSettings', input, { ...context, bypassApprovals: true }))
      .toEqual({ status: 'dispatched' });
    expect(await routes.dispatch('computer.permissions.openSettings', { ...input, machineId: 'other' },
      { ...context, bypassApprovals: true })).toMatchObject({ ok: false, errorCode: 'computer_machine_mismatch' });
    await routes.dispose();
  });
});
