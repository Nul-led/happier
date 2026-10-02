import { describe, expect, it } from 'vitest';

import { settingsDefaults, applySettings } from '@/sync/domains/settings/settings';
import { localSettingsDefaults, applyLocalSettings } from '@/sync/domains/settings/localSettings';
import { createSettingsDeclarationAction } from './settingsDeclarationAction';
import { UI_FONT_SCALE_PRESETS } from '@/components/ui/text/uiFontScale';
import { readSettingsPageGate } from '@/components/settings/catalog/pageCatalog';

function createOwner(host: { os: 'web' | 'ios'; desktop: boolean } = { os: 'web', desktop: false }, featuresEnabled = false) {
    let account = { ...settingsDefaults };
    let local = { ...localSettingsDefaults };
    // These ports substitute only the persisted Account and device storage boundaries.
    const action = createSettingsDeclarationAction({
        host,
        tauriDesktop: host.desktop,
        readPageGate: readSettingsPageGate,
        isFeatureEnabled: async () => featuresEnabled,
        readAccountSettings: async () => account,
        writeAccountSettings: async (delta) => { account = applySettings(account, delta); },
        readLocalSettings: () => local,
        writeLocalSettings: (delta) => { local = applyLocalSettings(local, delta); },
    });
    return { action, account: () => account, local: () => local };
}

describe('declared settings owner', () => {
    it('discovers stored, read-only and navigation rows without values or invented write support', async () => {
        const owner = createOwner();
        const result = await owner.action({ actionId: 'settings.list', input: { pageId: 'appearance' } });
        expect(result).toMatchObject({ items: expect.arrayContaining([
            expect.objectContaining({ anchor: 'appearance.density', storageScope: 'local', readable: true, writable: true }),
            expect.objectContaining({ anchor: 'appearance.textSize', readable: true, writable: true, allowedValues: Object.values(UI_FONT_SCALE_PRESETS) }),
            expect.objectContaining({ anchor: 'appearance.themes', readable: false, writable: false, unavailableReason: 'not_bound' }),
        ]) });
        expect(JSON.stringify(result)).not.toContain('"value":');
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'appearance.themes', value: 'dark' } }))
            .toMatchObject({ ok: false, errorCode: 'setting_not_bound' });
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'language.appLanguage', value: 'fr' } }))
            .toMatchObject({ ok: false, errorCode: 'setting_read_only' });
        expect(await owner.action({ actionId: 'settings.get', input: { anchor: 'accountSecurity.recoveryKey' } }))
            .toMatchObject({ ok: false, errorCode: 'setting_sensitive' });
        expect(await owner.action({ actionId: 'settings.list', input: { pageId: 'accountSecurity' } }))
            .toMatchObject({ items: expect.arrayContaining([
                expect.objectContaining({ anchor: 'accountSecurity.recoveryKey', sensitive: true, readable: false, writable: false }),
            ]) });
    });

    it('uses the Appearance slider presets as the admitted text-size choices', async () => {
        const owner = createOwner();
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'appearance.textSize', value: UI_FONT_SCALE_PRESETS.large } }))
            .toEqual({ anchor: 'appearance.textSize', value: UI_FONT_SCALE_PRESETS.large });
        expect(owner.local().uiFontScale).toBe(UI_FONT_SCALE_PRESETS.large);
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'appearance.textSize', value: 99 } }))
            .toMatchObject({ ok: false, errorCode: 'invalid_setting_value' });
        expect(owner.local().uiFontScale).toBe(UI_FONT_SCALE_PRESETS.large);
    });

    it('changes and reads scalar local and Account settings through their schema and persistence owners', async () => {
        const owner = createOwner();
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'appearance.density', value: 'compact' } }))
            .toEqual({ anchor: 'appearance.density', value: 'compact' });
        expect(owner.local().uiItemDensity).toBe('compact');
        expect(await owner.action({ actionId: 'settings.get', input: { anchor: 'appearance.density' } }))
            .toEqual({ anchor: 'appearance.density', value: 'compact' });
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'appearance.avatarStyle', value: 'gradient' } }))
            .toEqual({ anchor: 'appearance.avatarStyle', value: 'gradient' });
        expect(owner.account().avatarStyle).toBe('gradient');
        expect(await owner.action({ actionId: 'settings.get', input: { anchor: 'appearance.avatarStyle' } }))
            .toEqual({ anchor: 'appearance.avatarStyle', value: 'gradient' });
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'appearance.avatarStyle', value: 'not-a-style' } }))
            .toMatchObject({ ok: false, errorCode: 'invalid_setting_value' });
        expect(owner.account().avatarStyle).toBe('gradient');
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'appearance.density', value: 'not-a-density' } }))
            .toMatchObject({ ok: false, errorCode: 'invalid_setting_value' });
        expect(owner.local().uiItemDensity).toBe('compact');
        expect(await owner.action({ actionId: 'settings.get', input: { anchor: 'unknown.key' } }))
            .toMatchObject({ ok: false, errorCode: 'setting_not_found' });
    });

    it('does not write a local preference after the invoking operation is cancelled', async () => {
        const owner = createOwner();
        const before = owner.local().uiItemDensity;
        const controller = new AbortController();
        controller.abort();
        await expect(owner.action({ actionId: 'settings.set', input: { anchor: 'appearance.density', value: 'compact' }, context: { signal: controller.signal } }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(owner.local().uiItemDensity).toBe(before);
    });

    it('discovers and changes both Delegation defaults through Account settings', async () => {
        const owner = createOwner();
        expect(await owner.action({ actionId: 'settings.list', input: { pageId: 'delegation' } }))
            .toMatchObject({ items: expect.arrayContaining([
                expect.objectContaining({ anchor: 'delegation.workDepthLimit', storageScope: 'account', readable: true, writable: true }),
                expect.objectContaining({ anchor: 'delegation.approvalReviewerEnabled', storageScope: 'account', readable: true, writable: true }),
            ]) });
        expect(await owner.action({ actionId: 'settings.get', input: { anchor: 'delegation.workDepthLimit' } }))
            .toEqual({ anchor: 'delegation.workDepthLimit', value: 4 });
        expect(await owner.action({ actionId: 'settings.get', input: { anchor: 'delegation.approvalReviewerEnabled' } }))
            .toEqual({ anchor: 'delegation.approvalReviewerEnabled', value: false });

        for (const value of [0, 8]) {
            expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'delegation.workDepthLimit', value } }))
                .toEqual({ anchor: 'delegation.workDepthLimit', value });
            expect(owner.account().workDepthLimit).toBe(value);
            expect(await owner.action({ actionId: 'settings.get', input: { anchor: 'delegation.workDepthLimit' } }))
                .toEqual({ anchor: 'delegation.workDepthLimit', value });
        }
        for (const value of [true, false]) {
            expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'delegation.approvalReviewerEnabled', value } }))
                .toEqual({ anchor: 'delegation.approvalReviewerEnabled', value });
            expect(owner.account().approvalReviewerEnabled).toBe(value);
            expect(await owner.action({ actionId: 'settings.get', input: { anchor: 'delegation.approvalReviewerEnabled' } }))
                .toEqual({ anchor: 'delegation.approvalReviewerEnabled', value });
        }
        for (const value of [-1, 1.5, '4']) {
            expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'delegation.workDepthLimit', value } }))
                .toMatchObject({ ok: false, errorCode: 'invalid_setting_value' });
        }
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'delegation.approvalReviewerEnabled', value: 'true' } }))
            .toMatchObject({ ok: false, errorCode: 'invalid_setting_value' });
        expect(owner.account().workDepthLimit).toBe(8);
        expect(owner.account().approvalReviewerEnabled).toBe(false);
    });

    it('admits direct scalar preferences across the remaining declared settings pages', async () => {
        const owner = createOwner(undefined, true);
        const writes = [
            ['session.composer.nonSteerablePrompt', 'off', 'sessionNonSteerableSendPrompt'],
            ['transcript.selectionEnabled', true, 'transcriptMessageSelectionEnabled'],
            ['transcript.advanced.autoFollow', false, 'transcriptScrollAutoFollowWhenPinned'],
            ['sourceControl.showLineNumbersInDiffs', true, 'showLineNumbers'],
            ['attachments.writeIgnoreRules', false, 'attachmentsUploadsVcsIgnoreWritesEnabled'],
        ] as const;
        for (const [anchor, value, key] of writes) {
            expect(await owner.action({ actionId: 'settings.set', input: { anchor, value } })).toEqual({ anchor, value });
            expect(owner.account()[key]).toBe(value);
        }
    });

    it('round-trips every admitted scalar declaration through the canonical schemas', async () => {
        for (const host of [{ os: 'web', desktop: true }, { os: 'ios', desktop: false }] as const) {
            const owner = createOwner(host, true);
            const discovered = await owner.action({ actionId: 'settings.list', input: {} });
            if (!('items' in discovered) || !discovered.items) throw new Error('Discovery failed');
            for (const item of discovered.items.filter((item) => item.writable)) {
                const current = await owner.action({ actionId: 'settings.get', input: { anchor: item.anchor } });
                if ('unset' in current) {
                    expect(current).toEqual({ anchor: item.anchor, unset: true });
                    continue;
                }
                if (!('value' in current)) throw new Error(`${item.anchor}: ${'errorCode' in current ? current.errorCode : 'Missing value'}`);
                expect(await owner.action({ actionId: 'settings.set', input: current })).toEqual(current);
            }
        }
    });

    it('preserves the logical meaning of Account privacy switches and denies unavailable hosts', async () => {
        const owner = createOwner();
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'account.analytics', value: false } }))
            .toEqual({ anchor: 'account.analytics', value: false });
        expect(owner.account().analyticsOptOut).toBe(true);
        expect(await owner.action({ actionId: 'settings.get', input: { anchor: 'account.analytics' } }))
            .toEqual({ anchor: 'account.analytics', value: false });
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'desktop.enabled', value: true } }))
            .toMatchObject({ ok: false, errorCode: 'setting_unsupported_host' });
    });

    it('preserves the canonical page-level feature admission before reading or writing a declared preference', async () => {
        const owner = createOwner();
        const before = owner.account().showLineNumbers;
        expect(await owner.action({ actionId: 'settings.list', input: { pageId: 'sourceControl' } }))
            .toMatchObject({ items: expect.arrayContaining([
                expect.objectContaining({ anchor: 'sourceControl.showLineNumbersInDiffs', readable: false, writable: false, unavailableReason: 'feature_disabled' }),
            ]) });
        expect(await owner.action({ actionId: 'settings.get', input: { anchor: 'sourceControl.showLineNumbersInDiffs' } }))
            .toMatchObject({ ok: false, errorCode: 'setting_feature_disabled' });
        expect(await owner.action({ actionId: 'settings.set', input: { anchor: 'sourceControl.showLineNumbersInDiffs', value: !before } }))
            .toMatchObject({ ok: false, errorCode: 'setting_feature_disabled' });
        expect(owner.account().showLineNumbers).toBe(before);
    });
});
