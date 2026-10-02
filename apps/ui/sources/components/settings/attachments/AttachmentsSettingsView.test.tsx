import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturesResponseSchema } from '@happier-dev/protocol';
import { renderSettingsView } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';
import { settingsDefaults } from '@/sync/domains/settings/settings';

const setters = vi.hoisted(() => ({ directory: vi.fn(), bytes: vi.fn() }));
installSettingsViewCommonModuleMocks({
    storage: async () => {
        const { createStorageModuleStub, createStorageStoreMock, createUseSettingMutableMockFromReader } = await import('@/dev/testkit/mocks/storage');
        const store = createStorageStoreMock({ settings: { ...settingsDefaults, experiments: true, featureToggles: { 'attachments.uploads': true } } });
        return createStorageModuleStub({
            storage: store,
            getStorage: () => store,
            useSettingMutable: createUseSettingMutableMockFromReader((key) => {
                if (key === 'attachmentsUploadsWorkspaceRelativeDir') return ['.happier/uploads', setters.directory];
                if (key === 'attachmentsUploadsMaxFileBytes') return [26214400, setters.bytes];
                return [settingsDefaults[key], vi.fn()];
            }),
        });
    },
});

afterEach(() => vi.unstubAllGlobals());

describe('AttachmentsSettingsView inline fields', () => {
    it('retains invalid drafts without saving and commits normalized directory and byte values', async () => {
        setters.directory.mockClear();
        setters.bytes.mockClear();
        // The feature request is the real network boundary; retain feature policy and parsing.
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(FeaturesResponseSchema.parse({
            features: { attachments: { uploads: { enabled: true } } }, capabilities: {},
        })), { status: 200, headers: { 'content-type': 'application/json' } })));
        const { getServerFeaturesSnapshot } = await import('@/sync/api/capabilities/serverFeaturesClient');
        const features = await getServerFeaturesSnapshot();
        expect(features.status).toBe('ready');
        const { AttachmentsSettingsView } = await import('./AttachmentsSettingsView');
        const screen = await renderSettingsView(<AttachmentsSettingsView />);
        expect(screen.findByTestId('settings-attachments-uploads-directory')).toBeTruthy();
        expect(screen.findByTestId('settings-attachments-uploads-directory-input')).toBeTruthy();
        act(() => screen.changeTextByTestId('settings-attachments-uploads-directory-input', '../outside'));
        act(() => screen.findByTestId('settings-attachments-uploads-directory-input')!.props.onBlur());
        expect(setters.directory).not.toHaveBeenCalled();
        expect(screen.findByTestId('settings-attachments-uploads-directory-input.error')).toBeTruthy();
        act(() => screen.changeTextByTestId('settings-attachments-uploads-directory-input', ' folder\\uploads '));
        act(() => screen.findByTestId('settings-attachments-uploads-directory-input')!.props.onSubmitEditing());
        expect(setters.directory).toHaveBeenCalledWith('folder/uploads');
        act(() => screen.changeTextByTestId('settings-attachments-max-size-input', '1'));
        act(() => screen.findByTestId('settings-attachments-max-size-input')!.props.onBlur());
        expect(setters.bytes).not.toHaveBeenCalled();
        expect(screen.findByTestId('settings-attachments-max-size-input.error')).toBeTruthy();
        act(() => screen.changeTextByTestId('settings-attachments-max-size-input', ' 4096 '));
        act(() => screen.findByTestId('settings-attachments-max-size-input')!.props.onSubmitEditing());
        expect(setters.bytes).toHaveBeenCalledWith(4096);
    });
});
