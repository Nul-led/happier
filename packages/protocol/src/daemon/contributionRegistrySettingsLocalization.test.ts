import { describe, expect, it } from 'vitest';

import { projectPluginSettingsContributionV2 } from './contributionRegistryProjection.js';

describe('plugin Settings registry localization', () => {
  it('preserves localized declarations for the UI translation owner', () => {
    const projected = projectPluginSettingsContributionV2({
      pluginId: 'acme.localized',
      definition: {
        id: 'settings',
        version: 1,
        title: { key: 'plugins.acme.settings.title', fallback: 'Acme settings' },
        description: { key: 'plugins.acme.settings.description', fallback: 'Configure Acme' },
        scope: 'account',
        presentation: { sections: [], subagentSections: [] },
        target: { kind: 'plugin' },
        fields: [{
          id: 'enabled',
          schema: { type: 'boolean' },
          title: { key: 'plugins.acme.settings.enabled', fallback: 'Enabled' },
          description: { key: 'plugins.acme.settings.enabled.description', fallback: 'Use Acme' },
        }],
      },
    });

    expect(projected).toMatchObject({
      title: { key: 'plugins.acme.settings.title', fallback: 'Acme settings' },
      description: { key: 'plugins.acme.settings.description', fallback: 'Configure Acme' },
      fields: [{
        displayKey: { key: 'plugins.acme.settings.enabled', fallback: 'Enabled' },
        descriptionKey: { key: 'plugins.acme.settings.enabled.description', fallback: 'Use Acme' },
      }],
    });
  });
});
