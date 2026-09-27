import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installAccountCommonModuleMocks } from './accountTestHelpers';

const runtime = vi.hoisted(() => ({
    focus: vi.fn(),
    recover: vi.fn(),
}));

installAccountCommonModuleMocks();

vi.mock('@/auth/password/recoverPasswordEnvelopeSecret', () => ({
    recoverPasswordEnvelopeSecret: (...args: unknown[]) => runtime.recover(...args),
}));

vi.mock('@/components/account/auth/emailPassword/PasswordField', async () => {
    const React = await import('react');
    const { View } = await import('react-native');
    return {
        PasswordField: (props: Readonly<{
            inputRef?: React.RefObject<{ focus(): void } | null>;
            testID?: string;
            onChangeText(value: string): void;
            error?: string | null;
        }>) => {
            React.useEffect(() => {
                if (props.inputRef) props.inputRef.current = { focus: runtime.focus };
                return () => { if (props.inputRef) props.inputRef.current = null; };
            }, [props.inputRef]);
            return <View {...props} />;
        },
    };
});

afterEach(() => {
    standardCleanup();
    runtime.focus.mockClear();
    runtime.recover.mockReset();
});

describe('RecoveryKeyUnlockModal', () => {
    it('focuses the password field after a failed local unlock', async () => {
        runtime.recover.mockRejectedValueOnce(new Error('password_authentication_failed'));
        const { RecoveryKeyUnlockModal } = await import('./RecoveryKeyUnlockModal');
        const screen = await renderScreen(<RecoveryKeyUnlockModal
            email="person@example.test"
            request={vi.fn()}
            onUnlocked={vi.fn()}
            onClose={vi.fn()}
        />);

        await act(async () => screen.findByTestId('recovery-key-unlock-password')?.props.onChangeText('wrong password'));
        await screen.pressByTestIdAsync('recovery-key-unlock-submit');

        expect(runtime.focus).toHaveBeenCalled();
        expect(screen.findByTestId('recovery-key-unlock-password')?.props.error).toBeTruthy();
    });

    it('clears the recovered bytes after handing a usable view to the disclosure owner', async () => {
        const recovered = new Uint8Array(32).fill(29);
        runtime.recover.mockResolvedValueOnce(recovered);
        const observed: number[][] = [];
        const { RecoveryKeyUnlockModal } = await import('./RecoveryKeyUnlockModal');
        const screen = await renderScreen(<RecoveryKeyUnlockModal
            email="person@example.test"
            request={vi.fn()}
            onUnlocked={(value) => { observed.push(Array.from(value)); }}
            onClose={vi.fn()}
        />);

        await act(async () => screen.findByTestId('recovery-key-unlock-password')?.props.onChangeText('right password'));
        await screen.pressByTestIdAsync('recovery-key-unlock-submit');

        expect(observed[0]).toEqual(new Array(32).fill(29));
        expect(recovered).toEqual(new Uint8Array(32));
        expect(screen.findByTestId('recovery-key-unlock-password')?.props.value).toBe('');
    });

    it('asks for the sign-in email too when the caller does not know it, and unlocks with what was typed', async () => {
        runtime.recover.mockRejectedValueOnce(new Error('password_authentication_failed'));
        runtime.recover.mockResolvedValueOnce(new Uint8Array(32).fill(5));
        const onUnlocked = vi.fn();
        const { RecoveryKeyUnlockModal } = await import('./RecoveryKeyUnlockModal');
        const screen = await renderScreen(<RecoveryKeyUnlockModal
            email={null}
            request={vi.fn()}
            onUnlocked={onUnlocked}
            onClose={vi.fn()}
        />);

        await act(async () => screen.findByTestId('recovery-key-unlock-email')?.props.onChangeText('person@example.test'));
        await act(async () => screen.findByTestId('recovery-key-unlock-password')?.props.onChangeText('wrong password'));
        await screen.pressByTestIdAsync('recovery-key-unlock-submit');
        // A wrong pair is a typed error under the field; the key is not disclosed.
        expect(screen.findByTestId('recovery-key-unlock-password')?.props.error).toBeTruthy();
        expect(onUnlocked).not.toHaveBeenCalled();
        expect(runtime.recover).toHaveBeenLastCalledWith(expect.objectContaining({ email: 'person@example.test' }));

        await act(async () => screen.findByTestId('recovery-key-unlock-password')?.props.onChangeText('right password'));
        await screen.pressByTestIdAsync('recovery-key-unlock-submit');
        expect(onUnlocked).toHaveBeenCalledTimes(1);
    });
});
