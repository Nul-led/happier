import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup, withPopoverWebGlobals } from '@/dev/testkit';
import type { SessionPublicLinkPublication } from '@/sync/domains/social/sessionPublicLinkPublication';
import { t } from '@/text';
import { PublicLinkDialog } from './PublicLinkDialog';

const modal = vi.hoisted(() => ({
    mock: null as ReturnType<typeof import('@/dev/testkit/mocks/modal').createModalModuleMock> | null,
}));

// `ItemGroup`/`Item` emit the web radio-group semantics this spec asserts only under
// `Platform.OS === 'web'`; the shared stub reports `node` unless the web runtime is installed.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    modal.mock = createModalModuleMock();
    return modal.mock.module;
});

// An enabled, non-busy row carries no `accessibilityState` at all (the canonical
// `resolveHappierItemBehavior` only emits the object when there is state to announce).
function expectUsable(state: Readonly<{ busy?: boolean; disabled?: boolean }> | undefined) {
    expect(state?.busy).not.toBe(true);
    expect(state?.disabled).not.toBe(true);
}

function publication(overrides: Partial<SessionPublicLinkPublication> = {}): SessionPublicLinkPublication {
    return {
        id: 'public-share-1',
        token: 'share-token-1',
        expiresAt: null,
        maxUses: null,
        useCount: 0,
        isConsentRequired: true,
        updatedAt: 1,
        ...overrides,
    };
}

describe('PublicLinkDialog', () => {
    // The dialog scrolls its freshly generated link into view through the frame
    // scheduler, which the node host lacks. This is the canonical testkit install
    // for that global pair.
    let restoreWebGlobals: (() => void) | null = null;
    beforeEach(() => {
        restoreWebGlobals = withPopoverWebGlobals();
        // The modal mock is module-scoped; `standardCleanup` unmounts but does not reset its spies.
        modal.mock?.spies.alert.mockClear();
    });
    afterEach(() => {
        standardCleanup();
        restoreWebGlobals?.();
        restoreWebGlobals = null;
    });

    it('exposes expiry and use-limit choices as named radio groups with one checked option', async () => {
        const screen = await renderScreen(
            <PublicLinkDialog
                publicShare={null}
                serverUrl="https://home.example.test"
                onCreate={vi.fn()}
                onDelete={vi.fn()}
                onClose={vi.fn()}
            />,
        );

        const groups = screen.findAllByType('View' as never)
            .filter((node) => node.props.role === 'radiogroup');
        expect(groups).toHaveLength(2);
        expect(groups.map((group) => group.props['aria-label'])).toEqual([
            'Expires in',
            'Maximum uses',
        ]);

        const expiryRows = ['public-link-expiry-7', 'public-link-expiry-30', 'public-link-expiry-never']
            .map((testID) => screen.findByTestId(testID)!);
        const useLimitRows = ['public-link-max-uses-unlimited', 'public-link-max-uses-10', 'public-link-max-uses-50']
            .map((testID) => screen.findByTestId(testID)!);

        for (const rows of [expiryRows, useLimitRows]) {
            expect(rows.map((row) => row.props.role)).toEqual(['radio', 'radio', 'radio']);
            expect(rows.filter((row) => row.props['aria-checked'] === true)).toHaveLength(1);
            expect(rows.filter((row) => row.props.tabIndex === 0)).toHaveLength(1);
        }
        expect(expiryRows.map((row) => row.props['aria-checked'])).toEqual([true, false, false]);
        expect(useLimitRows.map((row) => row.props['aria-checked'])).toEqual([true, false, false]);

        const event = {
            key: 'ArrowDown',
            nativeEvent: { key: 'ArrowDown' },
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        };
        await act(async () => { expiryRows[0]?.props.onKeyDown?.(event); });
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(screen.findByTestId('public-link-expiry-30')?.props['aria-checked']).toBe(true);
    });

    it('exposes the consent choice as the named canonical switch and toggles its checked value', async () => {
        const screen = await renderScreen(
            <PublicLinkDialog
                publicShare={null}
                serverUrl="https://home.example.test"
                onCreate={vi.fn()}
                onDelete={vi.fn()}
                onClose={vi.fn()}
            />,
        );

        const consentSwitch = () => screen.findAll((node) => String(node.type) === 'Switch')
            .find((node) => node.props.accessibilityLabel === t('session.sharing.requireConsent'));
        // The host switch mounts through the form `Deferred` wrapper one tick after render.
        await vi.waitFor(() => expect(consentSwitch()?.props.value).toBe(true));

        await act(async () => { consentSwitch()?.props.onValueChange?.(false); });
        expect(consentSwitch()?.props.value).toBe(false);
    });

    it('admits one publication request while the create is in flight', async () => {
        let settle: ((share: SessionPublicLinkPublication) => void) | null = null;
        const onCreate = vi.fn(() => new Promise<SessionPublicLinkPublication>((resolve) => { settle = resolve; }));
        const props = {
            serverUrl: 'https://home.example.test',
            onCreate,
            onDelete: vi.fn(),
            onClose: vi.fn(),
        };
        const screen = await renderScreen(<PublicLinkDialog publicShare={null} {...props} />);
        const createButton = () => screen.findHostByTestId('public-link-create');

        // A publication token is minted per request: a second activation while the
        // first is in flight would create a second link and orphan the first.
        await act(async () => { screen.pressByTestId('public-link-create'); });
        await act(async () => { screen.pressByTestId('public-link-create'); });
        expect(onCreate).toHaveBeenCalledTimes(1);

        // The control says it is working rather than silently swallowing presses.
        expect(createButton()?.props.accessibilityState).toMatchObject({ busy: true, disabled: true });

        const created = publication({ id: 'public-share-created', token: 'created-token' });
        await act(async () => { settle?.(created); });
        expectUsable(createButton()?.props.accessibilityState);

        // The publication owner hands the created share back to the open dialog:
        // one request settles into exactly one shareable link.
        await screen.update(<PublicLinkDialog publicShare={created} {...props} />);
        expect(screen.findAllHostsByTestId('public-link-url')).toHaveLength(1);
        expect(screen.getTextContent()).toContain('created-token');
        expect(onCreate).toHaveBeenCalledTimes(1);
        expect(modal.mock?.spies.alert).not.toHaveBeenCalled();
    });

    it('revokes once for rapid activations and closes exactly one time', async () => {
        let settle: (() => void) | null = null;
        const onDelete = vi.fn(() => new Promise<void>((resolve) => { settle = () => resolve(); }));
        const onClose = vi.fn();
        const screen = await renderScreen(
            <PublicLinkDialog
                publicShare={publication()}
                serverUrl="https://home.example.test"
                onCreate={vi.fn()}
                onDelete={onDelete}
                onClose={onClose}
            />,
        );

        // Revocation is one outward DELETE for the presented link. A second
        // activation would race the first and surface its 404 after the dialog
        // has already closed on the successful one.
        await act(async () => { screen.pressByTestId('public-link-delete'); });
        await act(async () => { screen.pressByTestId('public-link-delete'); });
        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(screen.findHostByTestId('public-link-delete')?.props.accessibilityState)
            .toMatchObject({ busy: true, disabled: true });

        await act(async () => { settle?.(); });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(modal.mock?.spies.alert).not.toHaveBeenCalled();
    });

    it('returns the revoke control to a usable state after a failed request', async () => {
        let reject: ((error: Error) => void) | null = null;
        const onDelete = vi.fn(() => new Promise<void>((_resolve, promiseReject) => { reject = promiseReject; }));
        const onClose = vi.fn();
        const screen = await renderScreen(
            <PublicLinkDialog
                publicShare={publication()}
                serverUrl="https://home.example.test"
                onCreate={vi.fn()}
                onDelete={onDelete}
                onClose={onClose}
            />,
        );

        await act(async () => { screen.pressByTestId('public-link-delete'); });
        await act(async () => { reject?.(new Error('revocation refused')); });

        expect(onClose).not.toHaveBeenCalled();
        expect(modal.mock?.spies.alert).toHaveBeenCalledTimes(1);
        expectUsable(screen.findHostByTestId('public-link-delete')?.props.accessibilityState);

        // The lifecycle settled, so the user may try again.
        await act(async () => { screen.pressByTestId('public-link-delete'); });
        expect(onDelete).toHaveBeenCalledTimes(2);
    });

    it('never mutates a surface that moved on before the revoke settled', async () => {
        let settle: (() => void) | null = null;
        const onDelete = vi.fn(() => new Promise<void>((resolve) => { settle = () => resolve(); }));
        const onClose = vi.fn();
        const props = {
            serverUrl: 'https://home.example.test',
            onCreate: vi.fn(),
            onDelete,
            onClose,
        };
        const screen = await renderScreen(
            <PublicLinkDialog publicShare={publication({ id: 'public-share-old' })} {...props} />,
        );

        await act(async () => { screen.pressByTestId('public-link-delete'); });
        // The publication owner pushed a different link into the open dialog;
        // the in-flight outcome belongs to a link this surface no longer shows.
        await screen.update(
            <PublicLinkDialog publicShare={publication({ id: 'public-share-new', token: 'new-token' })} {...props} />,
        );
        await act(async () => { settle?.(); });

        expect(onClose).not.toHaveBeenCalled();
        expect(modal.mock?.spies.alert).not.toHaveBeenCalled();
        expectUsable(screen.findHostByTestId('public-link-delete')?.props.accessibilityState);
    });

    it('settles a revoke that resolves after the dialog unmounted', async () => {
        let reject: ((error: Error) => void) | null = null;
        const onDelete = vi.fn(() => new Promise<void>((_resolve, promiseReject) => { reject = promiseReject; }));
        const onClose = vi.fn();
        const screen = await renderScreen(
            <PublicLinkDialog
                publicShare={publication()}
                serverUrl="https://home.example.test"
                onCreate={vi.fn()}
                onDelete={onDelete}
                onClose={onClose}
            />,
        );

        await act(async () => { screen.pressByTestId('public-link-delete'); });
        await screen.unmount();
        await act(async () => { reject?.(new Error('revocation refused')); });

        expect(onClose).not.toHaveBeenCalled();
        expect(modal.mock?.spies.alert).not.toHaveBeenCalled();
    });

    it('keeps regenerate on the same single-request lifecycle', async () => {
        let settle: ((share: SessionPublicLinkPublication) => void) | null = null;
        const onCreate = vi.fn(() => new Promise<SessionPublicLinkPublication>((resolve) => { settle = resolve; }));
        const active = publication({ token: 'first-token' });
        const screen = await renderScreen(
            <PublicLinkDialog publicShare={active} serverUrl="https://home.example.test" onCreate={onCreate} onDelete={vi.fn()} onClose={vi.fn()} />,
        );

        // Regenerating opens the same configuration body, so it shares the create control.
        await act(async () => { screen.pressByTestId('public-link-regenerate'); });
        await act(async () => { screen.pressByTestId('public-link-create'); });
        await act(async () => { screen.pressByTestId('public-link-create'); });
        expect(onCreate).toHaveBeenCalledTimes(1);

        await act(async () => { settle?.(publication({ token: 'second-token' })); });
        expect(screen.findHostByTestId('public-link-create')).toBeNull();
    });
});
