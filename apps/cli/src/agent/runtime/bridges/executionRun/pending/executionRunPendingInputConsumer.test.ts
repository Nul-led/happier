import { describe, expect, it, vi } from 'vitest';

import type { ExecutionRunAdmittedPendingInputV1 } from '@/api/session/client/transport/sessionClientInteractionApi';
import type {
    DurableProviderInputAcceptanceV1,
    SessionProviderInputOutcome,
} from '@/agent/runtime/session/input/providerInputOutcome';

import {
    createExecutionRunPendingInputConsumer,
    type ExecutionRunPendingInputPortLike,
    type ExecutionRunPendingInputDelivery,
} from './executionRunPendingInputConsumer';

type QueuedRow = Readonly<{
    localId: string;
    text: string;
    providerAction?: ExecutionRunAdmittedPendingInputV1['pendingProviderAction'];
    requestedAction?: ExecutionRunAdmittedPendingInputV1['pendingRequestedAction'];
}>;

/**
 * A fake of the SessionClient custody boundary only. Claim ordering, one-in-flight
 * custody, and durable acceptance are the real contract this consumer depends on.
 */
function createPortFake(rows: QueuedRow[], options: { commitDurableAnchorOnSettlement?: boolean } = {}) {
    const commitDurableAnchorOnSettlement = options.commitDurableAnchorOnSettlement ?? true;
    const settlements: SessionProviderInputOutcome[] = [];
    let consume: ((input: ExecutionRunAdmittedPendingInputV1) => boolean) | null = null;
    const custody = new Set<string>();
    const durable = new Map<string, DurableProviderInputAcceptanceV1>();
    let metadataWaiters: (() => void)[] = [];
    let disposed = false;

    const port: ExecutionRunPendingInputPortLike = {
        getMetadataSnapshot: () => null,
        waitForMetadataUpdate: async () => await new Promise<boolean>((resolve) => {
            metadataWaiters.push(() => resolve(true));
        }),
        shouldAttemptPendingMaterialization: () => !disposed,
        reconcilePendingProviderInputCustodyBeforeMaterialization: async () => custody.size === 0,
        materializeNextPendingMessageSafely: async () => {
            if (disposed || custody.size > 0) return { type: 'no_pending' };
            const row = rows.shift();
            if (!row) return { type: 'no_pending' };
            custody.add(row.localId);
            durable.set(row.localId, 'unknown');
            consume?.({
                role: 'user',
                content: { type: 'text', text: row.text },
                localId: row.localId,
                authorAccountId: 'author-a',
                inputAdmissionReceipt: null,
                pendingProviderAction: row.providerAction ?? 'send',
                ...(row.requestedAction ? { pendingRequestedAction: row.requestedAction } : {}),
            } as ExecutionRunAdmittedPendingInputV1);
            return { type: 'materialized', localId: row.localId, seq: null, content: null };
        },
        observeProviderInputSettlement: async (outcome) => {
            settlements.push(outcome);
            if (outcome.kind === 'accepted') {
                custody.delete(outcome.localId);
                if (commitDurableAnchorOnSettlement) durable.set(outcome.localId, 'accepted');
            }
            if (outcome.kind === 'rejected_before_effect') {
                custody.delete(outcome.localId);
                durable.set(outcome.localId, 'not_accepted');
            }
            return true;
        },
        readDurableProviderInputAcceptanceV1: async (localId) => durable.get(localId) ?? 'unknown',
        dispose: () => {
            disposed = true;
        },
    };

    return {
        port,
        settlements,
        bind(binding: { consume: (input: ExecutionRunAdmittedPendingInputV1) => boolean }) {
            consume = binding.consume;
            return port;
        },
        wakePendingChange() {
            const waiters = metadataWaiters;
            metadataWaiters = [];
            for (const waiter of waiters) waiter();
        },
        get inFlightCustody() {
            return [...custody];
        },
        forceDurable(localId: string, value: DurableProviderInputAcceptanceV1) {
            durable.set(localId, value);
        },
    };
}

function createDeliveryFake(
    behavior: (input: ExecutionRunAdmittedPendingInputV1) => Awaited<ReturnType<ExecutionRunPendingInputDelivery['deliver']>>
        | { status: 'accepted'; userMessageSeq: number | null },
) {
    const delivered: ExecutionRunAdmittedPendingInputV1[] = [];
    let onOutcome: ((outcome: SessionProviderInputOutcome) => void) | null = null;
    return {
        delivered,
        delivery: {
            subscribeProviderInputOutcomes(handler) {
                onOutcome = handler;
                return () => { onOutcome = null; };
            },
            deliver: vi.fn(async (input: ExecutionRunAdmittedPendingInputV1) => {
                delivered.push(input);
                const result = behavior(input);
                if (result.status === 'accepted') {
                    onOutcome?.({ kind: 'accepted', localId: input.localId!, userMessageSeq: result.userMessageSeq });
                    return { status: 'admitted' as const };
                }
                return result;
            }),
        } satisfies ExecutionRunPendingInputDelivery,
    };
}

async function settleMicrotasks(): Promise<void> {
    for (let index = 0; index < 40; index += 1) await Promise.resolve();
}

describe('createExecutionRunPendingInputConsumer', () => {
    it('waits event-first when admission is observed before delayed Pending materialization', async () => {
        const rows: QueuedRow[] = [];
        const fake = createPortFake(rows);
        const delivery = createDeliveryFake(() => ({ status: 'accepted', userMessageSeq: 12 }));
        const consumer = createExecutionRunPendingInputConsumer({
            recipient: { kind: 'execution_run', runId: 'run-a' },
            sidechainId: 'chain-a',
            bindPendingInput: (binding) => fake.bind(binding),
            readRuntimeActivity: () => ({ turnInFlight: false, supportsSteer: true }),
            isCurrent: () => true,
            delivery: delivery.delivery,
        });

        let settled = false;
        const admission = consumer.awaitAcceptedUserAnchor('input-late').then((value) => {
            settled = true;
            return value;
        });
        await settleMicrotasks();
        expect(settled).toBe(false);

        rows.push({ localId: 'input-late', text: 'initial' });
        fake.wakePendingChange();
        consumer.wake();

        await expect(admission).resolves.toBe('accepted');
        expect(delivery.delivered.map((input) => input.localId)).toEqual(['input-late']);
        await consumer.dispose();
    });

    it('claims, delivers and settles exactly one admitted input for this run target', async () => {
        const fake = createPortFake([{ localId: 'input-1', text: 'first' }]);
        const delivery = createDeliveryFake(() => ({ status: 'accepted', userMessageSeq: 12 }));
        const consumer = createExecutionRunPendingInputConsumer({
            recipient: { kind: 'execution_run', runId: 'run-a' },
            sidechainId: 'chain-a',
            bindPendingInput: (binding) => fake.bind(binding),
            readRuntimeActivity: () => ({ turnInFlight: false, supportsSteer: true }),
            isCurrent: () => true,
            delivery: delivery.delivery,
        });

        await settleMicrotasks();

        expect(delivery.delivered.map((input) => input.localId)).toEqual(['input-1']);
        expect(fake.settlements).toEqual([
            { kind: 'accepted', localId: 'input-1', userMessageSeq: 12 },
        ]);
        await expect(consumer.awaitAcceptedUserAnchor('input-1')).resolves.toBe('accepted');
        await consumer.dispose();
    });

    it('holds Agent output until the durable accepted user anchor is readable, not merely settled', async () => {
        // The settlement promise resolves, but the durable reader still cannot prove the
        // committed anchor. Output must not be released on the settlement promise alone.
        const fake = createPortFake(
            [{ localId: 'input-1', text: 'first' }],
            { commitDurableAnchorOnSettlement: false },
        );
        const delivery = createDeliveryFake(() => ({ status: 'accepted', userMessageSeq: null }));
        const consumer = createExecutionRunPendingInputConsumer({
            recipient: { kind: 'execution_run', runId: 'run-a' },
            sidechainId: 'chain-a',
            bindPendingInput: (binding) => fake.bind(binding),
            readRuntimeActivity: () => ({ turnInFlight: true, supportsSteer: false }),
            isCurrent: () => true,
            delivery: delivery.delivery,
        });
        await settleMicrotasks();
        expect(fake.settlements).toMatchObject([{ kind: 'accepted', localId: 'input-1' }]);
        const pendingAnchor = consumer.awaitAcceptedUserAnchor('input-1');
        await consumer.dispose();
        await expect(pendingAnchor).resolves.toBe('unknown');
    });

    it('does not claim a second input for this target while the first is unclassified', async () => {
        const fake = createPortFake([
            { localId: 'input-1', text: 'first' },
            { localId: 'input-2', text: 'second' },
        ]);
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const delivery = createDeliveryFake(() => ({ status: 'accepted', userMessageSeq: 1 }));
        const slow: ExecutionRunPendingInputDelivery = {
            subscribeProviderInputOutcomes: delivery.delivery.subscribeProviderInputOutcomes,
            deliver: async (input) => {
                await held;
                return await delivery.delivery.deliver(input);
            },
        };
        const consumer = createExecutionRunPendingInputConsumer({
            recipient: { kind: 'execution_run', runId: 'run-a' },
            sidechainId: 'chain-a',
            bindPendingInput: (binding) => fake.bind(binding),
            readRuntimeActivity: () => ({ turnInFlight: false, supportsSteer: true }),
            isCurrent: () => true,
            delivery: slow,
        });

        await settleMicrotasks();
        expect(fake.inFlightCustody).toEqual(['input-1']);
        expect(delivery.delivered).toHaveLength(0);

        release();
        await settleMicrotasks();
        expect(delivery.delivered.map((input) => input.localId)).toEqual(['input-1', 'input-2']);
        await consumer.dispose();
    });

    it('revokes the target immediately without waiting for an in-flight provider delivery', async () => {
        const fake = createPortFake([{ localId: 'input-1', text: 'first' }]);
        const deliveryStarted = vi.fn();
        const consumer = createExecutionRunPendingInputConsumer({
            recipient: { kind: 'execution_run', runId: 'run-a' },
            sidechainId: 'chain-a',
            bindPendingInput: (binding) => fake.bind(binding),
            readRuntimeActivity: () => ({ turnInFlight: false, supportsSteer: true }),
            isCurrent: () => true,
            delivery: {
                deliver: async (): Promise<never> => {
                    deliveryStarted();
                    return await new Promise<never>(() => undefined);
                },
            },
        });

        await settleMicrotasks();
        expect(deliveryStarted).toHaveBeenCalledOnce();

        let disposed = false;
        const disposal = consumer.dispose().then(() => { disposed = true; });
        await settleMicrotasks();

        expect(disposed).toBe(true);
        await disposal;
    });

    it('leaves an outcome-unknown delivery unsettled so the row stays delivering', async () => {
        const fake = createPortFake([{ localId: 'input-1', text: 'first' }]);
        const delivery = createDeliveryFake(() => ({
            status: 'outcome_unknown',
            issue: 'provider_acknowledgement_missing',
        }));
        const consumer = createExecutionRunPendingInputConsumer({
            recipient: { kind: 'execution_run', runId: 'run-a' },
            sidechainId: 'chain-a',
            bindPendingInput: (binding) => fake.bind(binding),
            readRuntimeActivity: () => ({ turnInFlight: false, supportsSteer: true }),
            isCurrent: () => true,
            delivery: delivery.delivery,
        });

        await settleMicrotasks();
        expect(fake.settlements).toEqual([]);
        expect(fake.inFlightCustody).toEqual(['input-1']);
        const pendingAnchor = consumer.awaitAcceptedUserAnchor('input-1');
        await consumer.dispose();
        await expect(pendingAnchor).resolves.toBe('unknown');
    });

    it('settles a refused delivery before any provider effect', async () => {
        const fake = createPortFake([{ localId: 'input-1', text: 'first' }]);
        const delivery = createDeliveryFake(() => ({
            status: 'rejected_before_effect',
            reason: 'steering_unavailable',
            diagnostic: { code: 'steering_unavailable', message: 'This run cannot steer.', severity: 'error' },
            retryable: false,
        }));
        const consumer = createExecutionRunPendingInputConsumer({
            recipient: { kind: 'execution_run', runId: 'run-a' },
            sidechainId: 'chain-a',
            bindPendingInput: (binding) => fake.bind(binding),
            readRuntimeActivity: () => ({ turnInFlight: true, supportsSteer: false }),
            isCurrent: () => true,
            delivery: delivery.delivery,
        });

        await settleMicrotasks();
        expect(fake.settlements).toMatchObject([
            { kind: 'rejected_before_effect', localId: 'input-1', reason: 'steering_unavailable' },
        ]);
        await expect(consumer.awaitAcceptedUserAnchor('input-1')).resolves.toBe('not_accepted');
        await consumer.dispose();
    });

    it('reports target-local foreground state from this run, never the parent Session', () => {
        const fake = createPortFake([]);
        let turnInFlight = false;
        let supportsSteer = true;
        const bindings: { foregroundState: () => string }[] = [];
        const consumer = createExecutionRunPendingInputConsumer({
            recipient: { kind: 'execution_run', runId: 'run-a' },
            sidechainId: 'chain-a',
            bindPendingInput: (binding) => {
                bindings.push(binding);
                return fake.bind(binding);
            },
            readRuntimeActivity: () => ({ turnInFlight, supportsSteer }),
            isCurrent: () => true,
            delivery: { deliver: async () => ({ status: 'admitted' }) },
        });

        const foregroundState = bindings[0]!.foregroundState;
        expect(foregroundState()).toBe('ready');
        turnInFlight = true;
        expect(foregroundState()).toBe('active_steerable');
        supportsSteer = false;
        expect(foregroundState()).toBe('active_unsteerable');
        void consumer.dispose();
    });

    it('stops claiming once the controller occurrence is superseded', async () => {
        const rows = [{ localId: 'input-1', text: 'first' }];
        const fake = createPortFake(rows);
        const delivery = createDeliveryFake(() => ({ status: 'accepted', userMessageSeq: 1 }));
        let current = true;
        const consumer = createExecutionRunPendingInputConsumer({
            recipient: { kind: 'execution_run', runId: 'run-a' },
            sidechainId: 'chain-a',
            bindPendingInput: (binding) => fake.bind(binding),
            readRuntimeActivity: () => ({ turnInFlight: false, supportsSteer: true }),
            isCurrent: () => current,
            delivery: delivery.delivery,
        });

        await settleMicrotasks();
        expect(delivery.delivered.map((input) => input.localId)).toEqual(['input-1']);

        current = false;
        rows.push({ localId: 'input-2', text: 'second' });
        consumer.wake();
        await settleMicrotasks();
        expect(delivery.delivered.map((input) => input.localId)).toEqual(['input-1']);
        await consumer.dispose();
    });
});
