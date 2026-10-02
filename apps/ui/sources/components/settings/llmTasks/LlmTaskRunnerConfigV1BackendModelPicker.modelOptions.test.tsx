import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';

installSettingsViewCommonModuleMocks({
  storage: async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    const { settingsDefaults } = await import('@/sync/domains/settings/settings');
    const settings = {
      ...settingsDefaults,
      backendEnabledByTargetKey: {
        'agent:happier.agent.claude/claude': false,
        'backend:claude': false,
      },
    };
    return createStorageModuleStub({
      useSetting: <K extends keyof typeof settings>(key: K) => settings[key],
    });
  },
});

const { DropdownMenu } = await import('@/components/ui/forms/dropdown/DropdownMenu');
const { LlmTaskRunnerConfigV1BackendModelPicker } = await import('./LlmTaskRunnerConfigV1BackendModelPicker');

describe('task runner model options', () => {
  it('keeps the selected Agent model choices when its backend is absent from the selectable catalog', async () => {
    const screen = await renderScreen(
      <LlmTaskRunnerConfigV1BackendModelPicker
        value={{
          v: 1, backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
          modelId: 'default', permissionMode: 'no_tools',
        }}
        onChange={() => {}}
      />,
    );
    const [backendMenu, modelMenu] = screen.findAllByType(DropdownMenu);
    expect(backendMenu?.props.selectedId).toBe('');
    expect(modelMenu?.props.items).toContainEqual(expect.objectContaining({ id: 'default' }));
  });
});
