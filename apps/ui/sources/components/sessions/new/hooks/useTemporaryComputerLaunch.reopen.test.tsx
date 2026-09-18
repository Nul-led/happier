import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import {
    RunnerActivationClientError,
    type RunnerActivationClient,
} from '@/sync/api/ephemeralRunner/runnerActivationClient';
import { useTemporaryComputerLaunch as useProductionTemporaryComputerLaunch } from './useTemporaryComputerLaunch';

// Production keeps one client for the selected Home. Stabilize inline boundary
// fixtures so a state update does not manufacture a transport replacement and
// a render-driven recovery loop.
function useTemporaryComputerLaunch(
    input: Parameters<typeof useProductionTemporaryComputerLaunch>[0],
): ReturnType<typeof useProductionTemporaryComputerLaunch> {
    const client = React.useRef(input.client).current;
    return useProductionTemporaryComputerLaunch({ ...input, client });
}

const pendingProjection = {
    activationId: '00000000-0000-4000-8000-000000000001',
    state: 'pending',
    review: null,
    materialization: null,
} as never;

const existingRef = {
    v: 1 as const,
    activationId: '00000000-0000-4000-8000-000000000001',
    createdOnDeviceLabel: 'This device',
};

describe('Reopening a waiting Temporary computer draft', () => {
    it('presents the frozen reconciling surface before the first projection read resolves', async () => {
        let resolveRead!: (value: unknown) => void;
        const read = vi.fn(() => new Promise((resolve) => { resolveRead = resolve; }));
        const hook = await renderHook(() => useTemporaryComputerLaunch({
            serverId: 'server-1',
            client: { read } as unknown as RunnerActivationClient,
            draftId: 'draft-reopened',
            existingPublicRef: existingRef,
            prepareActivation: vi.fn(),
            persistPublicRef: vi.fn(),
            onMaterialized: vi.fn(),
        }));

        // An editable composer here would let the user edit and resend a draft
        // whose package is already live on another computer.
        expect(hook.getCurrent().status).toBe('reconciling');

        await vi.waitFor(() => expect(read).toHaveBeenCalled());
        await act(async () => {
            resolveRead(pendingProjection);
        });
        await vi.waitFor(() => expect(hook.getCurrent().status).toBe('waiting_for_computer'));
        await hook.unmount();
    });

    it('surfaces a referenced activation the Home no longer knows instead of silently unfreezing', async () => {
        let rejectRead!: (reason: unknown) => void;
        const read = vi.fn(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
        const hook = await renderHook(() => useTemporaryComputerLaunch({
            serverId: 'server-1',
            client: { read } as unknown as RunnerActivationClient,
            draftId: 'draft-reopened-missing',
            existingPublicRef: existingRef,
            prepareActivation: vi.fn(),
            persistPublicRef: vi.fn(),
            onMaterialized: vi.fn(),
        }));

        expect(hook.getCurrent().status).toBe('reconciling');
        await act(async () => {
            rejectRead(new RunnerActivationClientError('not_found', 404, false));
        });
        await vi.waitFor(() => expect(hook.getCurrent().status).toBe('failed'));
        await hook.unmount();
    });

    it('freezes again when a hydrated draft reveals its activation reference after first render', async () => {
        const read = vi.fn(() => new Promise(() => undefined));
        const hook = await renderHook((props: { existingPublicRef: typeof existingRef | null }) => (
            useTemporaryComputerLaunch({
                serverId: 'server-1',
                client: { read, readByDraft: vi.fn(async () => { throw new RunnerActivationClientError('not_found', 404, false); }) } as unknown as RunnerActivationClient,
                draftId: 'draft-hydrating',
                existingPublicRef: props.existingPublicRef,
                prepareActivation: vi.fn(),
                persistPublicRef: vi.fn(),
                onMaterialized: vi.fn(),
            })
        ), { initialProps: { existingPublicRef: null as typeof existingRef | null } });

        await vi.waitFor(() => expect(hook.getCurrent().status).toBe('idle'));
        await hook.rerender({ existingPublicRef: existingRef });
        expect(hook.getCurrent().status).toBe('reconciling');
        await hook.unmount();
    });

    it('never reports reconciling for a draft that carries no activation reference', async () => {
        const readByDraft = vi.fn(async () => { throw new RunnerActivationClientError('not_found', 404, false); });
        const hook = await renderHook(() => useTemporaryComputerLaunch({
            serverId: 'server-1',
            client: { readByDraft } as unknown as RunnerActivationClient,
            draftId: 'draft-fresh',
            existingPublicRef: null,
            prepareActivation: vi.fn(),
            persistPublicRef: vi.fn(),
            onMaterialized: vi.fn(),
        }));

        expect(hook.getCurrent().status).toBe('idle');
        await vi.waitFor(() => expect(readByDraft).toHaveBeenCalled());
        expect(hook.getCurrent().status).toBe('idle');
        await hook.unmount();
    });
});
