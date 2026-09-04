import { describe, expect, it } from 'vitest';

import { formatPluginUiDiagnosticMessage } from './PluginDiagnosticsSection';

describe('formatPluginUiDiagnosticMessage', () => {
    it('presents targeted contribution admission identities and reason', () => {
        expect(formatPluginUiDiagnosticMessage({
            code: 'point_absent',
            message: 'Targeted contribution admission rejected.',
            details: {
                target: { pluginId: 'happier.channels', pointId: 'providers' },
                contributor: { pluginId: 'acme.discord', contributionId: 'discord' },
                protocol: { id: 'happier.channels/providers', version: 1 },
                reason: 'point_absent',
            },
        })).toBe(
            'Targeted contribution admission rejected.\n'
            + 'acme.discord/discord → happier.channels/providers · happier.channels/providers@1 · point_absent',
        );
    });
});
