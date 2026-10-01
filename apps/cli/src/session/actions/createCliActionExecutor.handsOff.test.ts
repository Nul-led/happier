import { describe, expect, it } from 'vitest';
import { createCliActionExecutor } from './createCliActionExecutor';

describe('live Session role workspace ceiling', () => {
  it('stamps the current owner policy over a caller hint at both prepare and execute', async () => {
    const executor = createCliActionExecutor({ token: 'test-token', sessionId: 'session-1',
      mode: 'plain', ctx: null,
      pluginActionExecutionOwner: 'current_process',
      getCurrentSessionMetadata: () => ({ work: { sessionRolesV1: { roleId: 'orchestrator', overrides: {}, sessionRoles: {}, notes: '' } } }),
    });
    const context = { surface: 'rpc' as const, workspaceWrites: 'allow' as const, bypassApprovals: true };
    await expect(executor.prepare('scm.repository.init', { cwd: '/repo' }, context)).resolves.toMatchObject({
      kind: 'settled', result: { ok: false, errorCode: 'workspace_write_denied' },
    });
    await expect(executor.execute('scm.repository.init', { cwd: '/repo' }, context)).resolves.toMatchObject({
      ok: false, errorCode: 'workspace_write_denied',
    });
  });
});
