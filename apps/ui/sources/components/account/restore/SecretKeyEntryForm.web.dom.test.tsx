// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { SecretKeyEntryForm } from './SecretKeyEntryForm';
import { setPreferredLanguageFromSettings, t } from '@/text';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => await vi.importActual('react-native-web'));
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

it('keeps keyboard focus and the invalid draft after Enter submits the real web input', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSubmit = vi.fn(async () => ({ kind: 'completed' as const }));
    try {
        await act(async () => {
            root.render(<SecretKeyEntryForm description="Account key" submitTitle="Continue" onSubmit={onSubmit} />);
        });
        const input = container.querySelector<HTMLInputElement>('[data-testid="restore-manual-secret-input"]')!;
        const draft = 'malformed not-a-key';
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, draft);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        });
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            await vi.runOnlyPendingTimersAsync();
        });
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(t('connect.invalidSecretKey'));
        expect(input.value).toBe(draft);
        expect(onSubmit).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(input);
    } finally {
        await act(async () => { root.unmount(); });
        container.remove();
        vi.useRealTimers();
    }
});

it('uses the canonical Recovery key terminology in localized recovery flows', async () => {
    setPreferredLanguageFromSettings('pl');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
        await act(async () => {
            root.render(
                <SecretKeyEntryForm
                    description="Account key"
                    submitTitle="Continue"
                    onSubmit={async () => ({ kind: 'completed' })}
                />,
            );
        });

        const input = container.querySelector<HTMLInputElement>('[data-testid="restore-manual-secret-input"]')!;
        expect(input.getAttribute('aria-label')).toBe(t('settingsAccount.secretKey'));
        expect(input.getAttribute('aria-label')).not.toBe(t('connect.secretKeyInputLabel'));
    } finally {
        await act(async () => { root.unmount(); });
        container.remove();
        setPreferredLanguageFromSettings(null);
    }
});
