import { describe, expect, it } from 'vitest';

import { ActionIdSchema } from './actionIds.js';
import { getActionSpec } from './actionSpecs.js';
import { actionSpecToActionDefinitionV1, listActionSpecsForCatalogSurface } from './actionCatalog.js';

describe('machine Agent inventory Action parity', () => {
  it('exposes the read-only machine inventory through UI, CLI, MCP and Session agents', () => {
    const id = ActionIdSchema.parse('machines.agents.list');
    const spec = getActionSpec(id);
    expect(spec).toMatchObject({
      safety: 'safe', sideEffectClass: 'read', executionPlacement: 'machine',
      surfaces: { ui: true, agent: true, mcp: true, cli: true },
      bindings: { mcpToolName: 'machines_agents_list' },
    });
    for (const surface of ['cli', 'mcp', 'agent'] as const) {
      expect(listActionSpecsForCatalogSurface({ surface }).map((item) => item.id)).toContain(id);
      expect(actionSpecToActionDefinitionV1(spec, { surface }).inputSchema).toMatchObject({
        required: ['machineId'],
        properties: { machineId: { type: 'string' }, refresh: { type: 'boolean' } },
      });
    }
    expect(spec.inputSchema.safeParse({ machineId: 'machine', refresh: true, agentId: 'acme/agent', serverId: 'home' }).success).toBe(true);
    expect(spec.inputSchema.safeParse({ machineId: 'machine', unexpected: true }).success).toBe(false);
    expect(spec.inputSchema.safeParse({ refresh: true }).success).toBe(false);
  });
});
