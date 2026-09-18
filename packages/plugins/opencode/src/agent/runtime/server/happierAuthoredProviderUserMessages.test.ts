import { describe, expect, it } from 'vitest';

import { createOpenCodeHappierAuthoredProviderUserMessageIds } from './happierAuthoredProviderUserMessages.js';
import type { OpenCodeRuntimeContext } from './runtimeContext.js';

function createContextFixture(): OpenCodeRuntimeContext {
  const storage = new Map<string, unknown>();
  const abortController = new AbortController();
  return {
    exec: {
      systemTools: {
        resolve: async () => {
          throw new Error('executable resolution is outside this storage test');
        },
      },
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    abort: {
      signal: abortController.signal,
      compose: (signals) => AbortSignal.any(signals),
    },
    config: { values: {} },
    env: { list: () => ({}) },
    managedServices: {
      dependencies: {} as OpenCodeRuntimeContext['managedServices']['dependencies'],
      supervise: async () => {
        throw new Error('managed server is outside this storage test');
      },
    },
    ui: {
      askQuestions: async () => ({
        requestId: 'question-cancelled',
        kind: 'questions',
        status: 'userCancelled',
      }),
    },
    sessions: {
      current: {
        permissions: {
          requestDecision: async () => ({ status: 'cancelled' }),
        },
      },
      writeStateField: async () => undefined,
    },
    storage: {
      daemonSession: {
        get: async (key) => storage.get(key),
        set: async (key, value) => {
          storage.set(key, value);
        },
      },
    },
    experimental: { telemetry: { emit() {} } },
  };
}

describe('createOpenCodeHappierAuthoredProviderUserMessageIds', () => {
  it('resolves delayed provider user rows from pending Happier-authored prompt anchors', async () => {
    const ctx = createContextFixture();
    const tracker = createOpenCodeHappierAuthoredProviderUserMessageIds({
      ctx,
      readProviderSessionId: () => 'provider-session-1',
    });

    tracker.recordPendingPromptAnchor({
      text: 'Happier-authored prompt',
      submittedAtMs: 1_000,
    });

    expect(await tracker.markIfHappierAuthoredProviderUserMessage({
      messageId: 'provider-user-1',
      text: 'Happier-authored prompt',
      createdAtMs: 1_001,
    })).toBe(true);
    expect(tracker.has('provider-user-1')).toBe(true);

    const hydrated = createOpenCodeHappierAuthoredProviderUserMessageIds({
      ctx,
      readProviderSessionId: () => 'provider-session-1',
    });
    await hydrated.hydrate();

    expect(hydrated.has('provider-user-1')).toBe(true);
  });

  it('resolves delayed prompt-stack rows that wrap the pending Happier-authored prompt', async () => {
    const ctx = createContextFixture();
    const tracker = createOpenCodeHappierAuthoredProviderUserMessageIds({
      ctx,
      readProviderSessionId: () => 'provider-session-1',
    });

    tracker.recordPendingPromptAnchor({
      text: 'Reply exactly: RUQA_PROMPT_STACK_WRAPPED',
      submittedAtMs: 1_000,
    });

    expect(await tracker.markIfHappierAuthoredProviderUserMessage({
      messageId: 'provider-user-wrapper',
      text: [
        '[analyze-mode]',
        'ANALYSIS MODE. Gather context before diving deep.',
        'Options',
        'User request: Reply exactly: RUQA_PROMPT_STACK_WRAPPED',
      ].join('\n'),
      createdAtMs: 1_001,
    })).toBe(true);
    expect(tracker.has('provider-user-wrapper')).toBe(true);
  });

  it('does not classify arbitrary external text that quotes a recent prompt as Happier-authored', async () => {
    const ctx = createContextFixture();
    const tracker = createOpenCodeHappierAuthoredProviderUserMessageIds({
      ctx,
      readProviderSessionId: () => 'provider-session-1',
    });

    tracker.recordPendingPromptAnchor({
      text: 'Reply exactly: RUQA_PROMPT_STACK_WRAPPED',
      submittedAtMs: 1_000,
    });

    expect(await tracker.markIfHappierAuthoredProviderUserMessage({
      messageId: 'provider-user-external-quote',
      text: 'I typed this in the OpenCode TUI and it quotes: Reply exactly: RUQA_PROMPT_STACK_WRAPPED',
      createdAtMs: 1_001,
    })).toBe(false);
    expect(tracker.has('provider-user-external-quote')).toBe(false);
  });

  it('keeps pending prompt anchors scoped and timestamp fail-closed', async () => {
    const ctx = createContextFixture();
    let providerSessionId = 'provider-session-1';
    const tracker = createOpenCodeHappierAuthoredProviderUserMessageIds({
      ctx,
      readProviderSessionId: () => providerSessionId,
    });

    tracker.recordPendingPromptAnchor({
      text: 'Happier-authored prompt',
      submittedAtMs: 2_000,
    });

    expect(await tracker.markIfHappierAuthoredProviderUserMessage({
      messageId: 'provider-user-before-submit',
      text: 'Happier-authored prompt',
      createdAtMs: 1_999,
    })).toBe(false);

    providerSessionId = 'provider-session-2';
    expect(await tracker.markIfHappierAuthoredProviderUserMessage({
      messageId: 'provider-user-other-session',
      text: 'Happier-authored prompt',
      createdAtMs: 2_001,
    })).toBe(false);
  });

  /**
   * Bytes OpenCode minted. The anchor store hands these ids straight back to
   * transcript projection, so presence is the only decision allowed here.
   */
  const PROVIDER_MINTED_SESSION_ID = '  provider\nses/AB+cd==  ';
  const PROVIDER_MINTED_MESSAGE_ID = '  provider\nmsg/AB+cd==  ';

  it('keeps an authored provider message id byte-exact through mark, has and hydrate', async () => {
    const ctx = createContextFixture();
    const tracker = createOpenCodeHappierAuthoredProviderUserMessageIds({
      ctx,
      readProviderSessionId: () => PROVIDER_MINTED_SESSION_ID,
    });

    tracker.recordPendingPromptAnchor({
      text: 'Happier-authored prompt',
      submittedAtMs: 1_000,
    });
    expect(await tracker.markIfHappierAuthoredProviderUserMessage({
      messageId: PROVIDER_MINTED_MESSAGE_ID,
      text: 'Happier-authored prompt',
      createdAtMs: 1_500,
    })).toBe(true);

    expect(tracker.has(PROVIDER_MINTED_MESSAGE_ID)).toBe(true);

    tracker.clearMemory();
    await tracker.hydrate();
    expect(tracker.has(PROVIDER_MINTED_MESSAGE_ID)).toBe(true);
  });

  it('does not share authored-message state between sessions differing only in whitespace', async () => {
    const ctx = createContextFixture();
    let providerSessionId = PROVIDER_MINTED_SESSION_ID;
    const tracker = createOpenCodeHappierAuthoredProviderUserMessageIds({
      ctx,
      readProviderSessionId: () => providerSessionId,
    });

    await tracker.add(PROVIDER_MINTED_MESSAGE_ID);
    expect(tracker.has(PROVIDER_MINTED_MESSAGE_ID)).toBe(true);

    providerSessionId = PROVIDER_MINTED_SESSION_ID.trim();
    await tracker.hydrate();

    expect(tracker.has(PROVIDER_MINTED_MESSAGE_ID)).toBe(false);
  });
});
