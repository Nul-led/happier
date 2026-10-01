import { describe, expect, it } from 'vitest';
import { ActionIdSchema } from './actionIds.js';
import { WORKSPACE_ACTION_INPUT_SCHEMAS, WORKSPACE_ACTION_SPECS } from './workspaceActionFamily.js';

describe('workspace client actions', () => {
  it('discovers tab and layout capabilities through the canonical Action vocabulary', () => {
    for (const id of [
      'workspace.tabs.list', 'workspace.tabs.open', 'workspace.tabs.activate', 'workspace.tabs.close',
      'workspace.tabs.pin', 'workspace.tabs.move', 'workspace.tabs.reorder', 'workspace.groups.focus', 'workspace.groups.maximize',
      'workspace.groups.restore', 'workspace.split', 'workspace.resize',
    ]) {
      expect(ActionIdSchema.parse(id)).toBe(id);
    }
  });
  it('publishes client execution on every requested surface without accepting caller-supplied geometry', () => {
    for (const spec of WORKSPACE_ACTION_SPECS) {
      expect(spec.executionPlacement).toBe('client');
      expect(spec.surfaces).toMatchObject({ ui: true, voice: true, agent: true, mcp: true, cli: true, rpc: false });
    }
    expect(WORKSPACE_ACTION_INPUT_SCHEMAS['workspace.split'].safeParse({ direction: 'right', availableSizePx: 1000 }).success).toBe(false);
    expect(WORKSPACE_ACTION_INPUT_SCHEMAS['workspace.resize'].safeParse({ splitId: 'split:1', ratio: 2 }).success).toBe(false);
  });
});
