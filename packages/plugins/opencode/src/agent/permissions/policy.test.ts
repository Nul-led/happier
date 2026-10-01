import { describe, expect, it } from 'vitest';

import {
  buildOpenCodePermissionEnv,
  buildOpenCodeSessionPermissionRuleset,
  buildOpenCodeSessionScopedPermissionRuleset,
  resolveOpenCodePermissionConfig,
} from './policy.js';

describe('OpenCode permission policy', () => {
  it('keeps read-only intent fail-closed while preserving safe aliases', () => {
    const config = resolveOpenCodePermissionConfig('read-only');

    expect(config['*']).toBe('deny');
    expect(config.read).toBe('allow');
    expect(config.edit).toBe('deny');
    expect(config.write).toBe('deny');
    expect(config.change_title).toBe('allow');
    expect(config.session_title_set).toBe('allow');
    expect(config.happier_action_execute).toBe('allow');
  });

  it('promotes safe-yolo intent to allow edit aliases in the emitted session ruleset', () => {
    const ruleset = buildOpenCodeSessionPermissionRuleset('safe-yolo');
    const byPermission = new Map(ruleset.map((entry) => [entry.permission, entry.action] as const));

    expect(byPermission.get('*')).toBe('ask');
    expect(byPermission.get('read')).toBe('allow');
    expect(byPermission.get('edit')).toBe('allow');
    expect(byPermission.get('write')).toBe('allow');
    expect(byPermission.get('mcp__happier__action_execute')).toBe('allow');
  });

  it('serializes OpenCode permission env from the canonical policy', () => {
    expect(JSON.parse(buildOpenCodePermissionEnv('plan').OPENCODE_PERMISSION)).toMatchObject({
      '*': 'deny',
      read: 'allow',
      write: 'deny',
    });
  });

  it('denies other session namespaces and then restores the current mode plus exact built-in safe tools', () => {
    const rules = buildOpenCodeSessionScopedPermissionRuleset('default', {
      registrations: [
        { projectedName: 'happier-session-session-a--happier' },
        { projectedName: 'happier-session-session-a--custom' },
      ],
      requiredHappierServerName: 'happier-session-session-a--happier',
    });

    expect(rules.slice(-9)).toEqual([
      { permission: 'happier-session-*', pattern: '*', action: 'deny' },
      { permission: 'happier-session-session-a--happier_*', pattern: '*', action: 'ask' },
      { permission: 'happier-session-session-a--custom_*', pattern: '*', action: 'ask' },
      { permission: 'happier-session-session-a--happier_change_title', pattern: '*', action: 'allow' },
      { permission: 'happier-session-session-a--happier_session_title_set', pattern: '*', action: 'allow' },
      { permission: 'happier-session-session-a--happier_action_execute', pattern: '*', action: 'allow' },
      { permission: 'happier-session-session-a--happier_action_spec_search', pattern: '*', action: 'allow' },
      { permission: 'happier-session-session-a--happier_action_spec_get', pattern: '*', action: 'allow' },
      { permission: 'happier-session-session-a--happier_action_options_resolve', pattern: '*', action: 'allow' },
    ]);
  });
});
