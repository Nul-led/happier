import { describe, expect, it } from 'vitest';
import { hasPluginSessionAccess, projectPluginSessionAccessIdentity } from './pluginAccess.js';

describe('plugin Session read identity', () => {
  it('uses authenticated row scope facts before conflicting metadata for inventory and image admission', () => {
    const scopes = [{ access: ['read' as const], machineIds: ['allowed'], projectIds: ['project-1'] }];
    const foreign = projectPluginSessionAccessIdentity({ id: 'session-1', machineId: ' foreign ', projectId: 'project-1' },
      { machineId: 'allowed', projectId: 'project-1' });
    expect(hasPluginSessionAccess({ scopes, session: foreign, access: 'read' })).toBe(false);
    const allowed = projectPluginSessionAccessIdentity({ id: 'session-1', machineId: ' allowed ' },
      { machineId: 'foreign', projectId: 'project-1' });
    expect(hasPluginSessionAccess({ scopes, session: allowed, access: 'read' })).toBe(true);
    expect(hasPluginSessionAccess({ scopes, session: allowed, access: 'control' })).toBe(false);
  });
});
