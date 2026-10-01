/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as RadixDialog from '@radix-ui/react-dialog';
import { describe, expect, it, vi } from 'vitest';

import { installModalComponentCommonModuleMocks } from './modalComponentTestHelpers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installModalComponentCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
                select: <T,>(values: { web?: T; default?: T }) => values.web ?? values.default,
            },
            View: (props: React.HTMLAttributes<HTMLDivElement>) => React.createElement('div', props, props.children),
        });
    },
});

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub, createUseLocalSettingMock } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useLocalSetting: createUseLocalSettingMock(),
    });
});

// The route modal below stands in for Expo Router's web modal (a Radix dialog); the app dialog gets the
// same Radix modules, because both must share Radix's layer and focus-scope stacks.
vi.mock('@/utils/web/radixCjs', async () => {
    const { createRadixCjsRealModule } = await import('@/dev/testkit/mocks/radixCjs');
    return await createRadixCjsRealModule();
});

vi.mock('react-native-keyboard-controller', () => ({
    KeyboardAvoidingView: (props: React.PropsWithChildren<Record<string, unknown>>) => (
        React.createElement('div', props, props.children)
    ),
}));

function pressEscape(): void {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
    }));
}

describe('BaseModal over a route modal (web)', () => {
    it('owns focus and Escape while it is on top, then hands focus back to the route modal', async () => {
        const { BaseModal } = await import('./BaseModal');
        const onSettingsOpenChange = vi.fn();
        const onDialogClose = vi.fn();
        const settingsContainer = document.createElement('div');
        const dialogContainer = document.createElement('div');
        document.body.append(settingsContainer, dialogContainer);
        const settingsRoot = createRoot(settingsContainer);
        const dialogRoot = createRoot(dialogContainer);
        const triggerRef: { current: HTMLButtonElement | null } = { current: null };

        const renderDialog = (visible: boolean) => (
            <BaseModal visible={visible} onClose={onDialogClose} focusReturnRef={triggerRef}>
                <button data-testid="dialog-first">First</button>
                <button data-testid="dialog-last">Last</button>
            </BaseModal>
        );

        try {
            // The Settings route modal: a modal Radix dialog that traps focus and closes on Escape.
            await act(async () => {
                settingsRoot.render(
                    <RadixDialog.Root open onOpenChange={onSettingsOpenChange}>
                        <RadixDialog.Portal>
                            <RadixDialog.Content aria-describedby={undefined}>
                                <RadixDialog.Title>Settings</RadixDialog.Title>
                                <button ref={triggerRef} data-testid="settings-trigger">Add a Home</button>
                            </RadixDialog.Content>
                        </RadixDialog.Portal>
                    </RadixDialog.Root>,
                );
            });
            triggerRef.current!.focus();
            expect(document.activeElement).toBe(triggerRef.current);

            await act(async () => {
                dialogRoot.render(renderDialog(true));
            });
            const first = document.querySelector<HTMLButtonElement>('[data-testid="dialog-first"]')!;
            const last = document.querySelector<HTMLButtonElement>('[data-testid="dialog-last"]')!;
            const dialogShell = first.closest<HTMLElement>('[aria-modal="true"]')!;

            // The dialog on top owns keyboard focus: the route modal beneath does not pull it back.
            expect(dialogShell.contains(document.activeElement)).toBe(true);
            await act(async () => {
                last.focus();
            });
            expect(document.activeElement).toBe(last);

            // Escape closes only the topmost overlay.
            await act(async () => {
                pressEscape();
            });
            expect(onDialogClose).toHaveBeenCalledTimes(1);
            expect(onSettingsOpenChange).not.toHaveBeenCalled();

            // Closing hands focus back to the control inside Settings that opened the dialog.
            await act(async () => {
                dialogRoot.render(renderDialog(false));
            });
            await act(async () => {
                dialogRoot.unmount();
            });
            await act(async () => {
                await Promise.resolve();
            });
            expect(document.activeElement).toBe(triggerRef.current);

            // And Settings is on top again: Escape now closes it.
            await act(async () => {
                pressEscape();
            });
            expect(onSettingsOpenChange).toHaveBeenCalledWith(false);
        } finally {
            await act(async () => {
                settingsRoot.unmount();
            });
            settingsContainer.remove();
            dialogContainer.remove();
        }
    });
});
