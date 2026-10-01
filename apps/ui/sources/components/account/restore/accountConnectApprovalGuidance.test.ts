import { describe, expect, it, vi } from 'vitest';

const alertAsyncSpy = vi.hoisted(() => vi.fn());

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alertAsync: alertAsyncSpy } }).module;
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

describe('account-connect approval guidance', () => {
    it('returns the show-QR recovery action selected through the canonical modal', async () => {
        alertAsyncSpy.mockImplementationOnce(async (_title, _message, buttons) => {
            buttons?.find((button: { text?: string }) => button.text === 'connect.showQrInstead')?.onPress?.();
        });

        const { promptAccountConnectApprovalRequired } = await import('./accountConnectApprovalGuidance');

        await expect(promptAccountConnectApprovalRequired({ showQr: true })).resolves.toBe('showQr');
        expect(alertAsyncSpy).toHaveBeenCalledWith(
            'connect.restoreAccount',
            'connect.legacyAccountQrUnavailable',
            expect.any(Array),
        );
    });

    it('offers "Show QR instead" only when the caller can act on it', async () => {
        const { promptAccountConnectApprovalRequired } = await import('./accountConnectApprovalGuidance');

        await expect(promptAccountConnectApprovalRequired({ showQr: false })).resolves.toBe('dismiss');
        const buttons = alertAsyncSpy.mock.calls.at(-1)?.[2] as Array<{ text?: string }> | undefined;
        expect(buttons?.map((button) => button.text)).toEqual(['common.ok']);
    });
});
