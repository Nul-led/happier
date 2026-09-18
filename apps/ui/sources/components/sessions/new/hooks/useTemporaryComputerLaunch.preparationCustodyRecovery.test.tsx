import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, renderHook } from '@/dev/testkit';
import { RunnerActivationClientError, type RunnerActivationClient } from '@/sync/api/ephemeralRunner/runnerActivationClient';
import type { RunnerActivationProjectionV1 } from '@happier-dev/protocol/ephemeralRunner/projection';

const boundary = vi.hoisted(() => ({
    values: new Map<string, string>(),
    events: [] as string[],
    activationIds: [
        '00000000-0000-4000-8000-0000000000a1',
        '00000000-0000-4000-8000-0000000000b2',
        '00000000-0000-4000-8000-0000000000c3',
    ],
    nextActivationId: 0,
    failedExactRemovalCount: 0,
}));

vi.mock('@/auth/storage/deviceLocalStorage', () => ({
    readDeviceLocalStorageString: async (key: string) => boundary.values.get(key) ?? null,
    writeDeviceLocalStorageString: async (key: string, value: string) => { boundary.values.set(key, value); },
    removeDeviceLocalStorageString: async (key: string) => { boundary.values.delete(key); },
}));

vi.mock('@/platform/randomUUID', () => ({
    randomUUID: () => {
        const activationId = boundary.activationIds[boundary.nextActivationId++]!;
        boundary.events.push(`allocate:${activationId}`);
        return activationId;
    },
}));

vi.mock('@/sync/domains/ephemeralRunner/package/runnerArtifactAcquisitionSink', () => ({
    isRunnerArtifactAcquisitionCustodyHandle: (value: unknown) => Boolean(
        value && typeof value === 'object' && 'kind' in value,
    ),
    removeRunnerArtifactAcquisitionCustody: async (value: Readonly<{ fileUri?: string }>) => {
        boundary.events.push(`remove:${value.fileUri ?? 'unknown'}`);
        if (value.fileUri === 'file:///runner-stage/exact.txt' && boundary.failedExactRemovalCount < 3) {
            boundary.failedExactRemovalCount += 1;
            throw new Error('file busy');
        }
    },
}));

import { createRunnerActivationKeyCustody, openRunnerActivationKeyCustody } from '@/sync/domains/ephemeralRunner/runnerActivationKeyCustody';
import {
    beginRunnerCreatorAttachmentStagingCustody,
    listRunnerCreatorCustodyActivationIds,
    recordRunnerCreatorStagingCustodyHandle,
} from '@/sync/domains/ephemeralRunner/runnerCreatorLaunchCustody';
import {
    recoverAndCreateRunnerActivationKeyCustodyForDraft,
    removeRunnerCreatorCustodyForActivation,
} from '@/sync/domains/ephemeralRunner/runnerCreatorDraftRemoval';
import { useTemporaryComputerLaunch as useProductionTemporaryComputerLaunch } from './useTemporaryComputerLaunch';

const scope = { serverId: 'home-a', accountId: 'account-a' } as const;
const exactDraftId = '10000000-0000-4000-8000-000000000001';
const otherDraftId = '20000000-0000-4000-8000-000000000002';

function useTemporaryComputerLaunch(
    input: Parameters<typeof useProductionTemporaryComputerLaunch>[0],
): ReturnType<typeof useProductionTemporaryComputerLaunch> {
    const client = React.useRef(input.client).current;
    return useProductionTemporaryComputerLaunch({ ...input, client });
}

async function invokeAndCapture(action: () => Promise<void>): Promise<unknown> {
    let caught: unknown;
    await act(async () => {
        try {
            await action();
        } catch (error) {
            caught = error;
        }
    });
    return caught;
}

async function stageOneHandle(activationId: string, fileUri: string): Promise<void> {
    await beginRunnerCreatorAttachmentStagingCustody({
        scope,
        activationId,
        attachmentMessageLocalId: `attachment-${activationId}`,
        firstTurnLocalId: `turn-${activationId}`,
        maxFileBytes: 1024,
    });
    await recordRunnerCreatorStagingCustodyHandle({
        scope,
        activationId,
        custodyFile: {
            id: 'file-a',
            name: 'notes.txt',
            mimeType: 'text/plain',
            sizeBytes: 8,
            custody: { kind: 'native_cache_file', fileUri },
        },
    });
}

describe('temporary-computer failed preparation custody recovery', () => {
    beforeEach(() => {
        boundary.values.clear();
        boundary.events.length = 0;
        boundary.nextActivationId = 0;
        boundary.failedExactRemovalCount = 0;
    });

    it('lets an overlapping remount adopt the incumbent draft launch without deleting active custody', async () => {
        const preparationStarted = createDeferred<void>();
        const finishPreparation = createDeferred<void>();
        let serverProjection: RunnerActivationProjectionV1 | null = null;
        const persistedReferences: string[] = [];
        const client = {
            readByDraft: vi.fn(async () => {
                if (serverProjection) return serverProjection;
                throw new RunnerActivationClientError('not_found', 404, false);
            }),
            create: vi.fn(async (request: Readonly<{ activationId: string }>) => {
                serverProjection = {
                    activationId: request.activationId,
                    state: 'pending',
                    claim: null,
                    review: null,
                    readiness: null,
                    materialization: null,
                    closeReason: null,
                    progressPhase: null,
                } as RunnerActivationProjectionV1;
                return serverProjection;
            }),
        } as unknown as RunnerActivationClient;
        const prepareActivation = vi.fn(async () => {
            const custody = await recoverAndCreateRunnerActivationKeyCustodyForDraft(scope, exactDraftId);
            await stageOneHandle(custody.activationId, 'file:///runner-stage/active.txt');
            preparationStarted.resolve();
            await finishPreparation.promise;
            return {
                request: { activationId: custody.activationId } as never,
                createdOnDeviceLabel: 'This device',
            };
        });
        const launchInput = {
            serverId: scope.serverId,
            draftId: exactDraftId,
            draftLaunchOperationKey: `${scope.serverId}:${scope.accountId}:${exactDraftId}`,
            existingPublicRef: null,
            prepareActivation,
            persistPublicRef: (reference: Readonly<{ activationId: string }>) => {
                persistedReferences.push(reference.activationId);
            },
            onMaterialized: vi.fn(),
        } as const;

        const firstMount = await renderHook(() => useTemporaryComputerLaunch({ ...launchInput, client }));
        let firstStart!: Promise<void>;
        await act(async () => {
            firstStart = firstMount.getCurrent().start();
            await preparationStarted.promise;
        });
        const activeActivationId = boundary.activationIds[0]!;
        await firstMount.unmount();

        const remount = await renderHook(() => useTemporaryComputerLaunch({ ...launchInput, client }));
        let remountedStart!: Promise<void>;
        await act(async () => {
            remountedStart = remount.getCurrent().start();
            await Promise.resolve();
        });

        expect(prepareActivation).toHaveBeenCalledOnce();
        expect(boundary.events).not.toContain('remove:file:///runner-stage/active.txt');
        finishPreparation.resolve();
        await act(async () => {
            await Promise.all([firstStart, remountedStart]);
        });

        expect(prepareActivation).toHaveBeenCalledOnce();
        expect(client.create).toHaveBeenCalledOnce();
        expect(boundary.events.filter((event) => event.startsWith('allocate:'))).toEqual([
            `allocate:${activeActivationId}`,
        ]);
        expect(persistedReferences).toEqual([activeActivationId]);
        expect(remount.getCurrent()).toMatchObject({
            status: 'waiting_for_computer',
            projection: { activationId: activeActivationId },
            error: null,
        });
        await expect(openRunnerActivationKeyCustody(scope, activeActivationId)).resolves.toMatchObject({
            activationId: activeActivationId,
        });
        expect(boundary.events).not.toContain('remove:file:///runner-stage/active.txt');
    });

    it('recovers the exact draft after remount before allocating a replacement and keeps cleanup failure retryable', async () => {
        const originalPreparationError = new RunnerActivationClientError('unavailable', 503, true);
        const client = {
            readByDraft: vi.fn(async () => { throw new RunnerActivationClientError('not_found', 404, false); }),
            create: vi.fn(async () => { throw new RunnerActivationClientError('unavailable', 503, true); }),
        } as unknown as RunnerActivationClient;

        const prepareFailedAttempt = async () => {
            const custody = await recoverAndCreateRunnerActivationKeyCustodyForDraft(scope, exactDraftId);
            await stageOneHandle(custody.activationId, 'file:///runner-stage/exact.txt');
            try {
                throw originalPreparationError;
            } catch (error) {
                await removeRunnerCreatorCustodyForActivation(scope, custody.activationId).catch(() => undefined);
                throw error;
            }
        };

        const firstMount = await renderHook(() => useTemporaryComputerLaunch({
            serverId: scope.serverId,
            client,
            draftId: exactDraftId,
            existingPublicRef: null,
            prepareActivation: prepareFailedAttempt,
            persistPublicRef: vi.fn(),
            onMaterialized: vi.fn(),
        }));

        await expect(invokeAndCapture(() => firstMount.getCurrent().start())).resolves.toBe(originalPreparationError);
        const failedActivationId = boundary.activationIds[0]!;
        expect(firstMount.getCurrent()).toMatchObject({ status: 'failed', error: originalPreparationError });

        const unrelated = await createRunnerActivationKeyCustody(scope, otherDraftId);
        await stageOneHandle(unrelated.activationId, 'file:///runner-stage/unrelated.txt');
        await firstMount.unmount();

        const prepareReplacement = vi.fn(async () => {
            const custody = await recoverAndCreateRunnerActivationKeyCustodyForDraft(scope, exactDraftId);
            return { request: {} as never, createdOnDeviceLabel: 'This device', custody };
        });
        const remount = await renderHook(() => useTemporaryComputerLaunch({
            serverId: scope.serverId,
            client,
            draftId: exactDraftId,
            existingPublicRef: null,
            prepareActivation: prepareReplacement,
            persistPublicRef: vi.fn(),
            onMaterialized: vi.fn(),
        }));

        const cleanupError = await invokeAndCapture(() => remount.getCurrent().start());
        expect(cleanupError).toEqual(new Error('file busy'));
        expect(remount.getCurrent()).toMatchObject({ status: 'failed', error: cleanupError });
        expect(boundary.events.filter((event) => event.startsWith('allocate:'))).toEqual([
            `allocate:${failedActivationId}`,
            `allocate:${unrelated.activationId}`,
        ]);
        expect(prepareReplacement).toHaveBeenCalledOnce();

        const repeatedCleanupError = await invokeAndCapture(() => remount.getCurrent().retry());
        expect(repeatedCleanupError).toEqual(new Error('file busy'));
        expect(remount.getCurrent()).toMatchObject({ status: 'failed', error: repeatedCleanupError });
        expect(boundary.events.filter((event) => event.startsWith('allocate:'))).toEqual([
            `allocate:${failedActivationId}`,
            `allocate:${unrelated.activationId}`,
        ]);

        await invokeAndCapture(() => remount.getCurrent().retry());

        const replacementActivationId = boundary.activationIds[2]!;
        expect(boundary.events.filter((event) => event === 'remove:file:///runner-stage/exact.txt')).toHaveLength(4);
        expect(boundary.events.lastIndexOf('remove:file:///runner-stage/exact.txt'))
            .toBeLessThan(boundary.events.indexOf(`allocate:${replacementActivationId}`));
        await expect(openRunnerActivationKeyCustody(scope, failedActivationId))
            .rejects.toMatchObject({ code: 'runner_activation_key_unavailable' });
        await expect(openRunnerActivationKeyCustody(scope, unrelated.activationId)).resolves.toEqual(unrelated);
        await expect(listRunnerCreatorCustodyActivationIds(scope)).resolves.toEqual([
            unrelated.activationId,
            replacementActivationId,
        ]);
        expect(boundary.events).not.toContain('remove:file:///runner-stage/unrelated.txt');
    });
});
