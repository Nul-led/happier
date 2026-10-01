import { describe, expect, it } from 'vitest';
import { getActionSpec } from './actionSpecs.js';
import { ActionIdSchema } from './actionIds.js';

describe('machine agent sign-in Action parity', () => {
  it('exposes the same validated native/connected operation on UI, CLI, MCP and agent surfaces', () => {
    for (const id of ['machines.agents.signIn.start', 'machines.agents.signIn.status']) {
      const spec = getActionSpec(ActionIdSchema.parse(id));
      expect(spec.surfaces).toMatchObject({ ui: true, cli: true, mcp: true, agent: true });
      expect(spec.inputSchema.safeParse({ machineId: 'machine', agentId: 'codex' }).success).toBe(true);
      expect(spec.inputSchema.safeParse({ machineId: '', agentId: 'codex' }).success).toBe(false);
    }
    const start = getActionSpec(ActionIdSchema.parse('machines.agents.signIn.start'));
    expect(start.inputSchema.safeParse({ machineId: 'machine', agentId: 'codex', method: 'connected' }).success).toBe(true);
    expect(start.inputSchema.safeParse({ machineId: 'machine', agentId: 'codex', method: 'made-up' }).success).toBe(false);
  });
});
