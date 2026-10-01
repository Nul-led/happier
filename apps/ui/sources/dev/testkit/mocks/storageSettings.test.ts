import { describe, expect, it } from 'vitest';

import { createStorageModuleMock, createStorageModuleStub, createUseSettingMock } from './storage';

describe('storage fixture setting readers', () => {
    it('reads the injected setting through both read-only and mutable hooks as the fixture changes', () => {
        const values: { scmGitPaneLayout: 'tabs' | 'unified' } = { scmGitPaneLayout: 'tabs' };
        const module = createStorageModuleStub({ useSetting: createUseSettingMock({ values }) });

        expect(module.useSetting('scmGitPaneLayout')).toBe('tabs');
        expect(module.useSettingMutable('scmGitPaneLayout')[0]).toBe('tabs');
        values.scmGitPaneLayout = 'unified';
        expect(module.useSettingMutable('scmGitPaneLayout')[0]).toBe('unified');
    });

    it('uses the injected reader for a partial module without replacing an explicit mutable fixture', async () => {
        const original = createStorageModuleStub({});
        // Module-loader boundary: return a deterministic original namespace, not an app singleton.
        const importOriginal = async <T,>() => original as T;
        const reader = createUseSettingMock({ values: { scmGitPaneLayout: 'tabs' } });
        const partial = await createStorageModuleMock({ importOriginal, overrides: { useSetting: reader } });
        expect(partial.useSettingMutable('scmGitPaneLayout')[0]).toBe('tabs');

        const explicit = createStorageModuleStub({ useSettingMutable: partial.useSettingMutable });
        const preserved = await createStorageModuleMock({ importOriginal, overrides: {
            useSetting: createUseSettingMock({ values: { scmGitPaneLayout: 'unified' } }),
            useSettingMutable: explicit.useSettingMutable,
        } });
        expect(preserved.useSettingMutable('scmGitPaneLayout')[0]).toBe('tabs');
    });
});
