import { describe, expect, it } from 'vitest';

import { readReleasedFlatPluginSettingValue } from './releasedFlatPluginSettings';
import { settingsDefaults } from './settings';

describe('readReleasedFlatPluginSettingValue', () => {
    it('supplies a released flat root carrier for a declared plugin field', () => {
        expect(readReleasedFlatPluginSettingValue({
            settings: { ...settingsDefaults, codexBackendMode: 'acp' },
            localId: 'codexBackendMode',
        })).toBe('acp');
    });

    it('never borrows a Settings root the host itself owns', () => {
        // A declared field named after a host setting must not become a reader
        // for unrelated Account state.
        expect(settingsDefaults).toHaveProperty('experiments');
        expect(readReleasedFlatPluginSettingValue({
            settings: { ...settingsDefaults, experiments: true },
            localId: 'experiments',
        })).toBeUndefined();
    });

    it('reports absence rather than a value when nothing was persisted', () => {
        expect(readReleasedFlatPluginSettingValue({
            settings: settingsDefaults,
            localId: 'codexBackendMode',
        })).toBeUndefined();
        expect(readReleasedFlatPluginSettingValue({
            settings: null,
            localId: 'codexBackendMode',
        })).toBeUndefined();
    });
});
