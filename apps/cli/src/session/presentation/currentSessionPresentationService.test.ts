import { describe, expect, it, vi } from 'vitest';

import type { AgentState } from '@/api/types';
import type { RpcHandler } from '@/api/rpc/types';
import type { SessionClientPort } from '@/api/session/sessionClientPort';
import type {
  HostRuntimeLimitMeasurementRecorder,
  HostRuntimeLimitMeasurementSample,
} from '@/agent/runtime/state/runtimeLimitMeasurement';
import {
  CURRENT_SESSION_PRESENTATION_ACK_RPC_METHOD,
  CURRENT_SESSION_PRESENTATION_AGENT_STATE_KEY,
  CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD,
  CURRENT_SESSION_PRESENTATION_UNBIND_RPC_METHOD,
  CurrentSessionPresentationStateV1Schema,
} from '@happier-dev/protocol/sessions';
import { SOCKET_RPC_AUTHORIZATION_CONTEXT_KINDS } from '@happier-dev/protocol/rpc';

import { createCurrentSessionPresentationService } from './currentSessionPresentationService';

function createHarness(options?: Readonly<{
  recordRuntimeLimitMeasurement?: HostRuntimeLimitMeasurementRecorder;
  ackTimeoutMs?: number;
}>) {
  let agentState: AgentState = {};
  const handlers = new Map<string, RpcHandler>();
  let failStateWrite: Error | null = null;
  let stateWriteAttemptCount = 0;
  let afterStateWrite: (() => void) | null = null;
  const session = {
    sessionId: 'session-1',
    rpcHandlerManager: {
      registerHandler: (method: string, handler: RpcHandler) => handlers.set(method, (data, context) => handler(
        data,
        context ?? {
          signal: new AbortController().signal,
          authorization: {
            kind: SOCKET_RPC_AUTHORIZATION_CONTEXT_KINDS.CURRENT_SESSION_PRESENTATION_ORIGIN,
            sessionId: 'session-1',
            accountId: 'owner-1',
            connectionId: 'connection-1',
          },
        },
      )),
      invokeLocal: async (method: string, params: unknown) => await handlers.get(method)?.(params),
    },
    updateAgentState: async (updater: (state: AgentState) => AgentState) => {
      stateWriteAttemptCount += 1;
      if (failStateWrite) throw failStateWrite;
      agentState = updater(agentState);
      afterStateWrite?.();
    },
  } as Pick<SessionClientPort, 'sessionId' | 'rpcHandlerManager' | 'updateAgentState'>;
  const createPresentation = (controller: AbortController) => createCurrentSessionPresentationService({
    session,
    signal: controller.signal,
    isCurrent: () => true,
    ackTimeoutMs: options?.ackTimeoutMs ?? 20,
    ...(options?.recordRuntimeLimitMeasurement
      ? { recordRuntimeLimitMeasurement: options.recordRuntimeLimitMeasurement }
      : {}),
  });
  const controller = new AbortController();
  const presentation = createPresentation(controller);
  return {
    presentation,
    controller,
    handlers,
    readState: () => CurrentSessionPresentationStateV1Schema.parse(
      (agentState as Record<string, unknown>)[CURRENT_SESSION_PRESENTATION_AGENT_STATE_KEY],
    ),
    readStateWriteAttemptCount: () => stateWriteAttemptCount,
    createSuccessor: () => {
      const successorController = new AbortController();
      return {
        controller: successorController,
        presentation: createPresentation(successorController),
      };
    },
    setFailStateWrite: (error: Error | null) => { failStateWrite = error; },
    setAfterStateWrite: (callback: (() => void) | null) => { afterStateWrite = callback; },
  };
}

function presentationContext(connectionId: string, accountId = 'owner-1') {
  return {
    signal: new AbortController().signal,
    authorization: {
      kind: SOCKET_RPC_AUTHORIZATION_CONTEXT_KINDS.CURRENT_SESSION_PRESENTATION_ORIGIN,
      sessionId: 'session-1',
      accountId,
      connectionId,
    },
  } as const;
}

const defaultOwner = {
  pluginId: 'acme.default',
  contributionId: 'presentation',
  generationId: 'immutable-generation-default',
  invocationId: 'invocation-default',
} as const;

describe('current-session presentation service', () => {
  it('refuses local or forwarded custody calls without the private authenticated origin', async () => {
    const harness = createHarness();
    const contextWithoutOrigin = { signal: new AbortController().signal };
    await expect(harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'asserted-client', focused: true, draftRevision: 0,
    }, contextWithoutOrigin)).resolves.toEqual({ status: 'rejected', reason: 'unavailable' });
    await expect(harness.handlers.get(CURRENT_SESSION_PRESENTATION_ACK_RPC_METHOD)?.({
      hostNonce: 'asserted-host',
      clientId: 'asserted-client',
      commandId: 'asserted-command',
      result: { status: 'applied' },
    }, contextWithoutOrigin)).resolves.toEqual({ status: 'ignored' });
    expect(harness.readStateWriteAttemptCount()).toBe(0);
  });

  it('records the exact UTF-8 aggregate only after the canonical snapshot accepts it', async () => {
    const samples: HostRuntimeLimitMeasurementSample[] = [];
    const harness = createHarness({
      recordRuntimeLimitMeasurement: (sample) => samples.push(sample),
    });

    await expect(harness.presentation.setStatus({
      operationId: 's-exact',
      key: 'build',
      text: 'ready 💡',
      owner: defaultOwner,
    })).resolves.toMatchObject({ status: 'applied' });
    const accepted = harness.readState();
    expect(samples.at(-1)).toEqual({
      family: 'current-session-presentation',
      decodedBytes: Buffer.byteLength(JSON.stringify(accepted), 'utf8'),
      itemCount: 1,
    });

    const sampleCount = samples.length;
    await expect(harness.presentation.setStatus({
      operationId: 's-oversize',
      key: 'build',
      text: 'x'.repeat(16_385),
      owner: defaultOwner,
    })).resolves.toMatchObject({ status: 'unavailable' });
    expect(harness.readState()).toEqual(accepted);
    expect(samples).toHaveLength(sampleCount);
  });

  it('owns reconnectable status/widget snapshots without mutating durable Session titles', async () => {
    const harness = createHarness();

    await expect(harness.presentation.setStatus({ operationId: 's1', key: 'build', text: 'Running', owner: defaultOwner }))
      .resolves.toMatchObject({ status: 'applied' });
    await expect(harness.presentation.setWidget({
      operationId: 'w1', key: 'checks', placement: 'beforeComposer', lines: ['Tests: 4/5'], owner: defaultOwner,
    })).resolves.toMatchObject({ status: 'applied' });
    expect(harness.readState()).toMatchObject({
      statuses: [{ localKey: 'build', text: 'Running' }],
      widgets: [{ localKey: 'checks', placement: 'beforeComposer', lines: ['Tests: 4/5'] }],
    });
  });

  it('keeps colliding local status/widget keys isolated and removes only the exact owner rows', async () => {
    const harness = createHarness();
    const alphaOwner = {
      pluginId: 'acme.alpha',
      contributionId: 'progress-action',
      generationId: 'immutable-generation-alpha',
      invocationId: 'invocation-alpha',
    } as const;
    const betaOwner = {
      pluginId: 'acme.beta',
      contributionId: 'progress-action',
      generationId: 'immutable-generation-beta',
      invocationId: 'invocation-beta',
    } as const;
    const nextAlphaInvocationOwner = {
      pluginId: 'acme.alpha',
      contributionId: 'progress-action',
      generationId: 'immutable-generation-alpha',
      invocationId: 'invocation-alpha-next',
    } as const;

    const setStatus = async (
      owner: typeof alphaOwner | typeof betaOwner | typeof nextAlphaInvocationOwner,
      text: string | null,
    ) => await harness.presentation.setStatus({
      operationId: `status:${owner.pluginId}:${text ?? 'remove'}`,
      key: 'progress',
      text,
      owner,
    });
    const setWidget = async (
      owner: typeof alphaOwner | typeof betaOwner | typeof nextAlphaInvocationOwner,
      lines: readonly string[] | null,
    ) => await harness.presentation.setWidget({
      operationId: `widget:${owner.pluginId}:${lines === null ? 'remove' : 'set'}`,
      key: 'progress',
      placement: 'beforeComposer',
      lines,
      owner,
    });

    await setStatus(alphaOwner, 'Alpha is running');
    await setStatus(betaOwner, 'Beta is running');
    await setStatus(nextAlphaInvocationOwner, 'Alpha restarted');
    await setWidget(alphaOwner, ['Alpha: 1/2']);
    await setWidget(betaOwner, ['Beta: 1/2']);
    await setWidget(nextAlphaInvocationOwner, ['Alpha restart: 1/2']);

    expect(harness.readState()).toMatchObject({
      statuses: [
        { localKey: 'progress', text: 'Alpha is running', owner: { ...alphaOwner, sessionId: 'session-1' } },
        { localKey: 'progress', text: 'Beta is running', owner: { ...betaOwner, sessionId: 'session-1' } },
        { localKey: 'progress', text: 'Alpha restarted', owner: { ...nextAlphaInvocationOwner, sessionId: 'session-1' } },
      ],
      widgets: [
        { localKey: 'progress', lines: ['Alpha: 1/2'], owner: { ...alphaOwner, sessionId: 'session-1' } },
        { localKey: 'progress', lines: ['Beta: 1/2'], owner: { ...betaOwner, sessionId: 'session-1' } },
        { localKey: 'progress', lines: ['Alpha restart: 1/2'], owner: { ...nextAlphaInvocationOwner, sessionId: 'session-1' } },
      ],
    });

    await harness.presentation.purgeOwner({
      operationId: 'purge:alpha',
      owner: alphaOwner,
    });

    expect(harness.readState()).toMatchObject({
      statuses: [
        { localKey: 'progress', text: 'Beta is running', owner: { ...betaOwner, sessionId: 'session-1' } },
        { localKey: 'progress', text: 'Alpha restarted', owner: { ...nextAlphaInvocationOwner, sessionId: 'session-1' } },
      ],
      widgets: [
        { localKey: 'progress', lines: ['Beta: 1/2'], owner: { ...betaOwner, sessionId: 'session-1' } },
        { localKey: 'progress', lines: ['Alpha restart: 1/2'], owner: { ...nextAlphaInvocationOwner, sessionId: 'session-1' } },
      ],
    });
  });

  it('purges only the exact invocation rows after its runtime has retired', async () => {
    const harness = createHarness();
    const retiredOwner = {
      pluginId: 'acme.alpha',
      contributionId: 'progress-action',
      generationId: 'immutable-generation-alpha',
      invocationId: 'invocation-alpha',
    } as const;
    const survivingOwner = {
      pluginId: 'acme.beta',
      contributionId: 'progress-action',
      generationId: 'immutable-generation-beta',
      invocationId: 'invocation-beta',
    } as const;

    await harness.presentation.setStatus({
      operationId: 'retired-status', key: 'progress', text: 'Retiring', owner: retiredOwner,
    });
    await harness.presentation.setWidget({
      operationId: 'retired-widget', key: 'progress', placement: 'beforeComposer', lines: ['Retiring'], owner: retiredOwner,
    });
    await harness.presentation.setStatus({
      operationId: 'surviving-status', key: 'progress', text: 'Still running', owner: survivingOwner,
    });
    await harness.presentation.setWidget({
      operationId: 'surviving-widget', key: 'progress', placement: 'beforeComposer', lines: ['Still running'], owner: survivingOwner,
    });

    harness.controller.abort(new Error('retired'));

    await expect(harness.presentation.purgeOwner({
      operationId: 'retire:alpha',
      owner: retiredOwner,
    })).resolves.toMatchObject({ status: 'applied' });
    expect(harness.readState()).toMatchObject({
      statuses: [{ owner: { ...survivingOwner, sessionId: 'session-1' } }],
      widgets: [{ owner: { ...survivingOwner, sessionId: 'session-1' } }],
    });
  });

  it('retries an exact owner purge after its first same-host persistence failure', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const owner = {
        pluginId: 'acme.alpha',
        contributionId: 'progress-action',
        generationId: 'immutable-generation-alpha',
        invocationId: 'invocation-alpha',
      } as const;

      await harness.presentation.setStatus({
        operationId: 'status:alpha', key: 'progress', text: 'Running', owner,
      });
      await harness.presentation.setWidget({
        operationId: 'widget:alpha', key: 'progress', placement: 'beforeComposer', lines: ['Running'], owner,
      });

      harness.setFailStateWrite(new Error('presentation transport offline'));
      await expect(harness.presentation.purgeOwner({
        operationId: 'retire:alpha', owner,
      })).resolves.toMatchObject({ status: 'unavailable' });
      expect(harness.readState()).toMatchObject({
        statuses: [{ owner: { ...owner, sessionId: 'session-1' } }],
        widgets: [{ owner: { ...owner, sessionId: 'session-1' } }],
      });

      harness.setFailStateWrite(null);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(harness.readState()).toMatchObject({ statuses: [], widgets: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps retrying an exact owner purge after three failed recovery writes', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const owner = {
        pluginId: 'acme.alpha',
        contributionId: 'progress-action',
        generationId: 'immutable-generation-alpha',
        invocationId: 'invocation-alpha',
      } as const;

      await harness.presentation.setStatus({
        operationId: 'status:alpha', key: 'progress', text: 'Running', owner,
      });
      const attemptsBeforeRetirement = harness.readStateWriteAttemptCount();
      harness.setFailStateWrite(new Error('presentation transport offline'));
      await harness.presentation.purgeOwner({ operationId: 'retire:alpha', owner });

      for (let retry = 0; retry < 3; retry += 1) {
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(harness.readStateWriteAttemptCount()).toBeGreaterThanOrEqual(attemptsBeforeRetirement + 4);
      expect(harness.readState().statuses).toHaveLength(1);

      harness.setFailStateWrite(null);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(harness.readState()).toMatchObject({ statuses: [], widgets: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces failed exact-owner purges into one recovered snapshot write', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const alphaOwner = {
        pluginId: 'acme.alpha',
        contributionId: 'progress-action',
        generationId: 'immutable-generation-alpha',
        invocationId: 'invocation-alpha',
      } as const;
      const betaOwner = {
        pluginId: 'acme.beta',
        contributionId: 'progress-action',
        generationId: 'immutable-generation-beta',
        invocationId: 'invocation-beta',
      } as const;

      await harness.presentation.setStatus({
        operationId: 'status:alpha', key: 'progress', text: 'Alpha', owner: alphaOwner,
      });
      await harness.presentation.setStatus({
        operationId: 'status:beta', key: 'progress', text: 'Beta', owner: betaOwner,
      });
      const attemptsBeforeFailure = harness.readStateWriteAttemptCount();

      harness.setFailStateWrite(new Error('presentation transport offline'));
      await harness.presentation.purgeOwner({ operationId: 'retire:alpha', owner: alphaOwner });
      await harness.presentation.purgeOwner({ operationId: 'retire:beta', owner: betaOwner });
      expect(harness.readStateWriteAttemptCount()).toBe(attemptsBeforeFailure + 2);

      harness.setFailStateWrite(null);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(harness.readState()).toMatchObject({ statuses: [], widgets: [] });
      expect(harness.readStateWriteAttemptCount()).toBe(attemptsBeforeFailure + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a pending retired generation revive its exact presentation rows', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const retiredOwner = {
        pluginId: 'acme.alpha',
        contributionId: 'progress-action',
        generationId: 'generation-retired',
        invocationId: 'invocation-retired',
      } as const;

      await harness.presentation.setStatus({
        operationId: 'status:retired', key: 'progress', text: 'Before retirement', owner: retiredOwner,
      });
      harness.setFailStateWrite(new Error('presentation transport offline'));
      await harness.presentation.purgeOwner({ operationId: 'retire:alpha', owner: retiredOwner });

      harness.setFailStateWrite(null);
      await expect(harness.presentation.setStatus({
        operationId: 'status:stale-revival', key: 'progress', text: 'Must not revive', owner: retiredOwner,
      })).resolves.toMatchObject({ status: 'unavailable' });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(harness.readState()).toMatchObject({ statuses: [], widgets: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels an old host retry and clears its disk residue when a successor binds', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const owner = {
        pluginId: 'acme.alpha',
        contributionId: 'progress-action',
        generationId: 'immutable-generation-alpha',
        invocationId: 'invocation-alpha',
      } as const;

      await harness.presentation.setStatus({
        operationId: 'status:alpha', key: 'progress', text: 'Running', owner,
      });
      harness.setFailStateWrite(new Error('presentation transport offline'));
      await harness.presentation.purgeOwner({ operationId: 'retire:alpha', owner });
      expect(harness.readState().statuses).toHaveLength(1);

      harness.controller.abort(new Error('host retired'));
      harness.setFailStateWrite(null);
      const successor = harness.createSuccessor();
      await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
        clientId: 'client-2', focused: true, draftRevision: 0,
      });
      expect(harness.readState()).toMatchObject({ statuses: [], widgets: [] });
      const attemptsAfterSuccessorBind = harness.readStateWriteAttemptCount();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(harness.readStateWriteAttemptCount()).toBe(attemptsAfterSuccessorBind);
      successor.controller.abort();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not expose a producerless actionable presentation writer', () => {
    const harness = createHarness();
    expect('setActionable' in harness.presentation).toBe(false);
  });

  it('publishes a notification to the bound client without a generic acknowledgement', async () => {
    const harness = createHarness();
    await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-1', focused: true, draftRevision: 2,
    });
    let published = 0;
    harness.setAfterStateWrite(() => {
      const command = harness.readState().command;
      if (command?.kind !== 'notify') return;
      published += 1;
      expect(command).toMatchObject({
        clientId: 'client-1',
        message: 'Done',
        severity: 'info',
      });
    });

    await expect(harness.presentation.notify({
      operationId: 'notify-1', message: 'Done', severity: 'info',
    })).resolves.toMatchObject({ status: 'applied' });
    expect(published).toBe(1);
    expect(harness.readState().command).toBeUndefined();
  });

  it('delegates composer replacement through one canonical text transaction and result acknowledgement', async () => {
    const harness = createHarness();
    const firstBind = await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-1', focused: false, draftRevision: 4,
    });
    expect(firstBind).toBeTruthy();
    await expect(harness.presentation.replaceComposerText({ operationId: 'c1', text: 'new' }))
      .resolves.toMatchObject({ status: 'conflict' });

    const bound = await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-1', focused: true, draftRevision: 7,
    }) as { hostNonce: string };
    harness.setAfterStateWrite(() => {
      const command = harness.readState().command;
      if (!command) return;
      expect(command).toMatchObject({
        kind: 'composer.replace',
        transaction: {
          expectedRevision: 7,
          operations: [{ kind: 'text.set', text: 'new' }],
        },
      });
      expect(command).not.toHaveProperty('text');
      expect(command).not.toHaveProperty('expectedDraftRevision');
      void harness.handlers.get(CURRENT_SESSION_PRESENTATION_ACK_RPC_METHOD)?.({
        hostNonce: bound.hostNonce,
        clientId: 'client-1',
        commandId: command.id,
        result: { status: 'conflict', currentRevision: 8 },
      });
    });
    await expect(harness.presentation.replaceComposerText({ operationId: 'c2', text: 'new' }))
      .resolves.toMatchObject({ status: 'conflict' });
  });

  it('publishes one focused Board intent and settles only its matching typed acknowledgement', async () => {
    const harness = createHarness();
    const bound = await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-1', focused: true, draftRevision: 7,
    }) as { hostNonce: string };
    harness.setAfterStateWrite(() => {
      const command = harness.readState().command;
      if (command?.kind !== 'presentation.apply') return;
      expect(command.intent).toEqual({ kind: 'board.item.reveal', widgetId: 'note-1' });
      void harness.handlers.get(CURRENT_SESSION_PRESENTATION_ACK_RPC_METHOD)?.({
        hostNonce: bound.hostNonce,
        clientId: 'client-1',
        commandId: command.id,
        result: { status: 'applied' },
      });
    });
    await expect(harness.presentation.present({
      operationId: 'present-1',
      intent: { kind: 'board.item.reveal', widgetId: 'note-1' },
    })).resolves.toMatchObject({ status: 'applied' });
    expect(harness.readState().command).toBeUndefined();
  });

  it('does not let an unfocused client steal composer authority from the focused bound client', async () => {
    const harness = createHarness();
    const bound = await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'focused-client', focused: true, draftRevision: 9,
    }) as { hostNonce: string };
    expect(bound).toMatchObject({ status: 'bound' });
    await expect(harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'background-client', focused: false, draftRevision: 2,
    })).resolves.toEqual({ status: 'rejected', reason: 'notCurrent' });
    harness.setAfterStateWrite(() => {
      const command = harness.readState().command;
      if (!command) return;
      expect(command).toMatchObject({
        clientId: 'focused-client',
        kind: 'composer.replace',
        transaction: {
          expectedRevision: 9,
          operations: [{ kind: 'text.set', text: 'new' }],
        },
      });
      void harness.handlers.get(CURRENT_SESSION_PRESENTATION_ACK_RPC_METHOD)?.({
        hostNonce: bound.hostNonce,
        clientId: 'focused-client', commandId: command.id,
        result: { status: 'applied', revision: 10 },
      });
    });

    await expect(harness.presentation.replaceComposerText({ operationId: 'c-focused', text: 'new' }))
      .resolves.toMatchObject({ status: 'applied' });
  });

  it('keeps an in-flight command with focused A when unfocused B is rejected, then accepts only A acknowledgement', async () => {
    const harness = createHarness({ ackTimeoutMs: 1_000 });
    const bound = await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-a', focused: true, draftRevision: 9,
    }, presentationContext('connection-a')) as { hostNonce: string };
    const pending = harness.presentation.present({
      operationId: 'present-a',
      intent: { kind: 'board.open', mode: 'beside_chat' },
    });
    await vi.waitFor(() => expect(harness.readState().command?.id).toBe('present-a'));

    await expect(harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-b', focused: false, draftRevision: 1,
    }, presentationContext('connection-b'))).resolves.toEqual({
      status: 'rejected',
      reason: 'notCurrent',
    });
    expect(harness.readState().command?.id).toBe('present-a');

    await expect(harness.handlers.get(CURRENT_SESSION_PRESENTATION_ACK_RPC_METHOD)?.({
      hostNonce: bound.hostNonce,
      clientId: 'client-a',
      commandId: 'present-a',
      result: { status: 'applied' },
    }, presentationContext('connection-a'))).resolves.toEqual({ status: 'accepted' });
    await expect(pending).resolves.toMatchObject({ status: 'applied' });
  });

  it('keeps the incumbent origin and in-flight command when a replacement bind cannot publish its snapshot', async () => {
    const harness = createHarness({ ackTimeoutMs: 1_000 });
    const bound = await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-a', focused: true, draftRevision: 9,
    }, presentationContext('connection-a')) as { hostNonce: string };
    const pending = harness.presentation.present({
      operationId: 'present-before-failed-bind',
      intent: { kind: 'board.open', mode: 'beside_chat' },
    });
    await vi.waitFor(() => expect(harness.readState().command?.id).toBe('present-before-failed-bind'));

    harness.setFailStateWrite(new Error('replacement bind snapshot unavailable'));
    await expect(harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-b', focused: true, draftRevision: 1,
    }, presentationContext('connection-b'))).rejects.toThrow('replacement bind snapshot unavailable');
    harness.setFailStateWrite(null);
    expect(harness.readState().command?.id).toBe('present-before-failed-bind');

    await expect(harness.handlers.get(CURRENT_SESSION_PRESENTATION_ACK_RPC_METHOD)?.({
      hostNonce: bound.hostNonce,
      clientId: 'client-a',
      commandId: 'present-before-failed-bind',
      result: { status: 'applied' },
    }, presentationContext('connection-a'))).resolves.toEqual({ status: 'accepted' });
    await expect(pending).resolves.toMatchObject({ status: 'applied' });
  });

  it('does not erase an in-flight command when the same origin refreshes its binding', async () => {
    const harness = createHarness({ ackTimeoutMs: 1_000 });
    const bound = await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-a', focused: true, draftRevision: 3,
    }, presentationContext('connection-a')) as { hostNonce: string };
    const pending = harness.presentation.present({
      operationId: 'same-origin-refresh',
      intent: { kind: 'companion.show' },
    });
    await vi.waitFor(() => expect(harness.readState().command?.id).toBe('same-origin-refresh'));

    await expect(harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-a', focused: true, draftRevision: 4,
    }, presentationContext('connection-a'))).resolves.toMatchObject({ status: 'bound' });
    expect(harness.readState().command?.id).toBe('same-origin-refresh');

    await harness.handlers.get(CURRENT_SESSION_PRESENTATION_ACK_RPC_METHOD)?.({
      hostNonce: bound.hostNonce,
      clientId: 'client-a',
      commandId: 'same-origin-refresh',
      result: { status: 'applied' },
    }, presentationContext('connection-a'));
    await expect(pending).resolves.toMatchObject({ status: 'applied' });
  });

  it('refuses acknowledgement from every different connection or principal', async () => {
    const harness = createHarness({ ackTimeoutMs: 1_000 });
    const bound = await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-a', focused: true, draftRevision: 3,
    }, presentationContext('connection-a')) as { hostNonce: string };
    const pending = harness.presentation.present({
      operationId: 'origin-fenced-ack',
      intent: { kind: 'chat.return' },
    });
    await vi.waitFor(() => expect(harness.readState().command?.id).toBe('origin-fenced-ack'));
    const ack = {
      hostNonce: bound.hostNonce,
      clientId: 'client-a',
      commandId: 'origin-fenced-ack',
      result: { status: 'applied' },
    } as const;

    await expect(harness.handlers.get(CURRENT_SESSION_PRESENTATION_ACK_RPC_METHOD)?.(
      ack,
      presentationContext('connection-b'),
    )).resolves.toEqual({ status: 'ignored' });
    await expect(harness.handlers.get(CURRENT_SESSION_PRESENTATION_ACK_RPC_METHOD)?.(
      ack,
      presentationContext('connection-a', 'other-owner'),
    )).resolves.toEqual({ status: 'ignored' });
    expect(harness.readState().command?.id).toBe('origin-fenced-ack');

    await harness.handlers.get(CURRENT_SESSION_PRESENTATION_ACK_RPC_METHOD)?.(
      ack,
      presentationContext('connection-a'),
    );
    await expect(pending).resolves.toMatchObject({ status: 'applied' });
  });

  it('retires the exact mounted origin and makes subsequent presentation unavailable before publication', async () => {
    const harness = createHarness();
    await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-a', focused: true, draftRevision: 3,
    }, presentationContext('connection-a'));
    const writesBeforeRetirement = harness.readStateWriteAttemptCount();

    await expect(harness.handlers.get(CURRENT_SESSION_PRESENTATION_UNBIND_RPC_METHOD)?.({
      clientId: 'client-a',
    }, presentationContext('connection-a'))).resolves.toEqual({ status: 'retired' });
    const writesAfterRetirement = harness.readStateWriteAttemptCount();
    expect(writesAfterRetirement).toBeGreaterThanOrEqual(writesBeforeRetirement);
    await expect(harness.presentation.present({
      operationId: 'after-unmount',
      intent: { kind: 'companion.show' },
    })).resolves.toMatchObject({
      status: 'unavailable',
      diagnostic: { code: 'current_session_presentation_not_current' },
    });
    expect(harness.readStateWriteAttemptCount()).toBe(writesAfterRetirement);
  });

  it('distinguishes known pre-publication loss from a successful notification publication', async () => {
    const harness = createHarness();
    await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
      clientId: 'client-1', focused: true, draftRevision: 0,
    });
    const preIssueError = Object.assign(new Error('socket is not connected'), { code: 'socket_not_connected' });
    harness.setFailStateWrite(preIssueError);
    await expect(harness.presentation.notify({ operationId: 'n1', message: 'first', severity: 'warning' }))
      .resolves.toMatchObject({ status: 'unavailable' });

    harness.setFailStateWrite(null);
    harness.setAfterStateWrite(null);
    await expect(harness.presentation.notify({ operationId: 'n2', message: 'second', severity: 'error' }))
      .resolves.toMatchObject({ status: 'applied' });
  });

  it('retires a pending composer transaction when its runtime generation aborts', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      await harness.handlers.get(CURRENT_SESSION_PRESENTATION_BIND_RPC_METHOD)?.({
        clientId: 'client-1', focused: true, draftRevision: 0,
      });
      const result = harness.presentation.replaceComposerText({ operationId: 'c1', text: 'pending' });
      await vi.waitFor(() => expect(harness.readState().command).toBeTruthy());
      harness.controller.abort(new Error('generation retired'));
      await expect(result).resolves.toMatchObject({ status: 'outcomeUnknown' });
    } finally {
      vi.useRealTimers();
    }
  });
});
