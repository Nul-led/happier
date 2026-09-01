import { describe, expect, it } from 'vitest';

import type { PluginSettingFieldV2 } from '@happier-dev/protocol';

import { assertPluginSettingFieldValue } from './settings';

const endpointField: PluginSettingFieldV2 = {
    id: 'endpoint',
    title: 'Endpoint',
    schema: { type: 'string' },
    presentation: {
        binding: {
            kind: 'perActiveServer',
            fallbackSettingId: 'endpoint',
            byServerIdSettingId: 'endpointByServer',
        },
    },
};

const endpointByServerField: PluginSettingFieldV2 = {
    id: 'endpointByServer',
    title: 'Endpoint by server',
    schema: { type: 'object', additionalProperties: { type: 'string' } },
    presentation: { hidden: true },
};

describe('plugin setting field value validation', () => {
    it('applies the Protocol-owned perActiveServer bounds at the daemon Action boundary', () => {
        const oversized = Object.fromEntries(Array.from(
            { length: 257 },
            (_, index) => [`server-${index}`, 'https://example.test'],
        ));

        expect(() => assertPluginSettingFieldValue({
            pluginId: 'acme.plugin',
            field: endpointByServerField,
            fields: [endpointField, endpointByServerField],
            value: oversized,
        })).toThrow(expect.objectContaining({ code: 'PLUGIN_SETTINGS_VALIDATION_FAILED' }));
    });
});
