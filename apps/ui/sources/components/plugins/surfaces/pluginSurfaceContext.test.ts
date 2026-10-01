import type { PluginUiTargetedContributionsV1 } from '@happier-dev/protocol/plugins/ui';
import { describe, expect, it } from 'vitest';

import { createPluginSurfaceContextFixture } from '@/dev/testkit/fixtures/pluginSurfaceContextFixture';

import { createPluginSurfaceContext } from './pluginSurfaceContext';

const targetedContributions: PluginUiTargetedContributionsV1 = {
    target: {
        pluginId: 'acme.preview',
        occurrenceId: 'target-generation-a',
        sourceCustody: { kind: 'development', registeredRootId: 'preview-root' },
    },
    points: [],
};

describe('createPluginSurfaceContext', () => {
    it('projects the shell column visibility only for an app page', () => {
        const fixture = createPluginSurfaceContextFixture();
        const environment = {
            platform: fixture.platform,
            locale: fixture.locale,
            direction: fixture.direction,
            colorScheme: fixture.colorScheme,
            contrast: fixture.contrast,
            textScale: fixture.textScale,
            reducedMotion: fixture.reducedMotion,
            screenReaderEnabled: fixture.screenReaderEnabled,
            safeAreaInsets: fixture.safeAreaInsets,
            theme: fixture.theme,
            columnVisible: true,
        };
        const input = {
            target: { kind: 'app' as const },
            accountEncryptionMode: fixture.accountEncryptionMode,
            environment,
            translations: fixture.translations,
            targetedContributions,
        };
        const appPageMount = {
            kind: 'destination' as const,
            destination: { pluginId: 'acme.preview', localId: 'inbox' },
            container: 'appPage' as const,
        };
        expect(createPluginSurfaceContext({ ...input, mount: appPageMount }).page).toEqual({ columnVisible: true });
        expect(createPluginSurfaceContext({ ...input, mount: appPageMount, environment: { ...environment, columnVisible: false } }).page).toEqual({ columnVisible: false });
        expect(createPluginSurfaceContext({ ...input, mount: fixture.mount }).page).toBeUndefined();
    });

    it('projects the host-stamped mount and exact admitted target snapshot', () => {
        const fixture = createPluginSurfaceContextFixture();
        const targeted = createPluginSurfaceContext({
            mount: fixture.mount,
            target: fixture.target,
            accountEncryptionMode: fixture.accountEncryptionMode,
            environment: {
                platform: fixture.platform,
                locale: fixture.locale,
                direction: fixture.direction,
                colorScheme: fixture.colorScheme,
                contrast: fixture.contrast,
                textScale: fixture.textScale,
                reducedMotion: fixture.reducedMotion,
                screenReaderEnabled: fixture.screenReaderEnabled,
                safeAreaInsets: fixture.safeAreaInsets,
                theme: fixture.theme,
                columnVisible: false,
            },
            translations: fixture.translations,
            targetedContributions,
        });

        expect(targeted.mount).toBe(fixture.mount);
        expect(targeted.accountEncryptionMode).toBe(fixture.accountEncryptionMode);
        expect(targeted.targetedContributions).toBe(targetedContributions);
    });

});
