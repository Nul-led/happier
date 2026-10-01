import { describe, expect, it, vi } from 'vitest';

import { resolveOpenCodeManagedServerDialect } from './managedServerDialect.js';
import { buildOpenCodeManagedServerSpawnSpec } from './spawnSpec.js';

describe('resolveOpenCodeManagedServerDialect', () => {
  it('recognizes released OpenCode 2 from the resolved opencode executable without guessing from its name', async () => {
    const run = vi.fn(async () => ({
      termination: { observed: { kind: 'exit', exitCode: 0 } },
      stdout: new TextEncoder().encode('v2.0.15\n'),
    }));
    const result = await resolveOpenCodeManagedServerDialect({
      exec: {
        systemTools: { resolve: async () => ({ executablePath: '/usr/local/bin/opencode', executable: { kind: 'systemTool', id: 'opencode-cli' } }) },
        run,
      },
      systemToolId: 'opencode-cli',
    });
    expect(result).toMatchObject({ dialect: 'v2', healthPath: '/api/info' });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ args: ['--version'] }), undefined);
    const spec = buildOpenCodeManagedServerSpawnSpec({
      id: 'opencode-server',
      systemToolId: 'opencode-cli',
      ...result,
    });
    expect(spec.healthCheck).toMatchObject({ target: { kind: 'servicePath', path: '/api/info' } });
  });

  it('uses the installed opencode version even when Stable selected that command', async () => {
    const result = await resolveOpenCodeManagedServerDialect({
      exec: {
        systemTools: { resolve: async () => ({ executablePath: '/usr/local/bin/opencode', executable: { kind: 'systemTool', id: 'opencode-cli-stable' } }) },
        run: async () => ({
          termination: { observed: { kind: 'exit', exitCode: 0 } },
          stdout: new TextEncoder().encode('2.0.15\n'),
        }),
      },
      systemToolId: 'opencode-cli-stable',
    });
    expect(result).toMatchObject({ dialect: 'v2', healthPath: '/api/info' });
  });

  it('keeps the opencode2 preview on its own health route', async () => {
    const result = await resolveOpenCodeManagedServerDialect({
      exec: { systemTools: { resolve: async () => ({ executablePath: '/usr/local/bin/opencode2' }) } },
      systemToolId: 'opencode-cli-v2',
    });
    expect(result).toMatchObject({ dialect: 'v2', healthPath: '/api/health' });
  });
});
