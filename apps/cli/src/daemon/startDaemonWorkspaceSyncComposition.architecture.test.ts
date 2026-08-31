import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('daemon workspace-sync production composition', () => {
  it('constructs the registered-machine runtime through the production owner and stops that same instance', async () => {
    const source = await readFile(fileURLToPath(new URL('./startDaemon.ts', import.meta.url)), 'utf8');

    expect(source.includes("from './startup/createProductionDaemonWorkspaceSyncRuntime'")).toBe(true);
    expect(source.includes("from './peer/iroh/workspaceMachineCarrierTunnelOpen'")).toBe(true);
    expect(source).not.toContain('createWorkspaceMachineCarrierStreamOpen');
    expect(/createWorkspaceSyncRuntime:\s*async\s*\(\{\s*machineId(?::\s*registeredMachineId)?\s*\}\)\s*=>[\s\S]*createProductionDaemonWorkspaceSyncRuntime\(\{/u.test(source)).toBe(true);
    expect(source).toMatch(/createProductionDaemonWorkspaceSyncRuntime\(\{[\s\S]*openMachineCarrierTunnel/u);
    expect(/drainBackgroundServerWork:\s*async\s*\(\)\s*=>\s*\{\s*await\s+stopWorkspaceSyncRuntime\(\)/u.test(source)).toBe(true);
    expect(/const\s+stopWorkspaceSyncRuntime[\s\S]*await\s+runtime\?\.stop\(\)/u.test(source)).toBe(true);
  });
});
