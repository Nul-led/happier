import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

describe('resolveSystemTaskFailureMessage', () => {
    it('names the failed acquisition phase without exposing its raw diagnostics', async () => {
        const { resolveSystemTaskFailureMessage } = await import('./resolveSystemTaskFailureMessage');
        expect(resolveSystemTaskFailureMessage({ code: 'cli_acquisition_verifying_failed', message: 'secret URL' }))
            .toBe('cliAcquisitionProgress.acquisitionVerificationFailed');
    });

    it('shows app copy for setup decisions the user declined instead of the daemon sentence', async () => {
        const { resolveSystemTaskFailureMessage } = await import('./resolveSystemTaskFailureMessage');

        expect(resolveSystemTaskFailureMessage({
            code: 'service_reconciliation_declined',
            message: 'Existing background services on the remote host were left unchanged, so setup stopped.',
        })).toBe('machine.backgroundServicePrompt.replaceDeclined');
        expect(resolveSystemTaskFailureMessage({
            code: 'release_channel_switch_declined',
            message: 'The remote default release channel stayed stable.',
        })).toBe('machine.backgroundServicePrompt.channelSwitchDeclined');
    });

    it('keeps the task message for other failures and returns undefined when there is nothing to show', async () => {
        const { resolveSystemTaskFailureMessage } = await import('./resolveSystemTaskFailureMessage');

        expect(resolveSystemTaskFailureMessage({ code: 'ssh_failed', message: ' Connection refused ' })).toBe('Connection refused');
        expect(resolveSystemTaskFailureMessage({ code: 'ssh_failed', message: '' })).toBeUndefined();
    });
});
