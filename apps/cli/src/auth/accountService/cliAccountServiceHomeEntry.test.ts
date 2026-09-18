import { describe, expect, it, vi } from 'vitest';

import {
  runCliAccountServiceHomeEntry,
  type CliAccountServiceDirectoryAttemptOutcome,
  type CliAccountServiceHomeEntryPorts,
  type CliAccountServiceRestrictedCredential,
} from './cliAccountServiceHomeEntry';

const credential: CliAccountServiceRestrictedCredential = {
  token: 'test-secret-that-must-never-be-returned',
};

function createPorts(
  overrides: Partial<CliAccountServiceHomeEntryPorts> = {},
): CliAccountServiceHomeEntryPorts {
  return {
    authenticateExactMethod: vi.fn(async () => ({
      kind: 'authenticated' as const,
      target: { endpoint: 'https://accounts.example', serverIdentityId: 'account-service-1' },
      credential,
    })),
    runDirectoryJourney: vi.fn(async () => ({
      kind: 'home_entered' as const,
      homeServerIdentityId: 'home-1',
      profileId: 'studio',
      selection: 'preferred' as const,
    })),
    openSelectedHome: vi.fn(async () => ({ kind: 'opened' as const })),
    continueMachineAndService: vi.fn(async () => ({ kind: 'continued' as const })),
    ...overrides,
  };
}

describe('runCliAccountServiceHomeEntry', () => {
  it('authenticates the exact advertised method once, then opens and continues the selected Home', async () => {
    const events: string[] = [];
    const ports = createPorts({
      authenticateExactMethod: vi.fn(async (input) => {
        events.push(`authenticate:${input.method.kind === 'provider' ? input.method.providerId : 'key'}`);
        return {
          kind: 'authenticated' as const,
          target: { endpoint: 'https://accounts.example', serverIdentityId: 'account-service-1' },
          credential,
        };
      }),
      runDirectoryJourney: vi.fn(async (input) => {
        events.push(`directory:${input.target.serverIdentityId}`);
        return {
          kind: 'home_entered' as const,
          homeServerIdentityId: 'home-1',
          profileId: 'studio',
          selection: 'preferred' as const,
        };
      }),
      openSelectedHome: vi.fn(async (input) => {
        events.push(`open:${input.profileId}`);
        return { kind: 'opened' as const };
      }),
      continueMachineAndService: vi.fn(async (input) => {
        events.push(`continue:${input.profileId}`);
        return { kind: 'continued' as const };
      }),
    });

    const result = await runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'provider', providerId: 'github', action: 'login', mode: 'keyless' },
    }, ports);

    expect(result).toEqual({
      kind: 'home_entered',
      homeServerIdentityId: 'home-1',
      profileId: 'studio',
      selection: 'preferred',
    });
    expect(events).toEqual([
      'authenticate:github',
      'directory:account-service-1',
      'open:studio',
      'continue:studio',
    ]);
    expect(ports.authenticateExactMethod).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(credential.token);
  });

  it('returns key_required without attempting authentication when the selected key method has no key', async () => {
    const ports = createPorts();

    await expect(runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
    }, ports)).resolves.toEqual({ kind: 'key_required' });

    expect(ports.authenticateExactMethod).not.toHaveBeenCalled();
    expect(ports.runDirectoryJourney).not.toHaveBeenCalled();
  });

  it.each([
    'account_connected_no_homes',
    'update_required',
    'account_service_unavailable',
    'home_unavailable',
    'cancelled',
    'timed_out',
    'identity_mismatch',
    'destination_mismatch',
  ] as const)('preserves the shared %s terminal outcome without opening or continuing a Home', async (kind) => {
    const ports = createPorts({
      runDirectoryJourney: vi.fn(async () => ({ kind })),
    });

    const result = await runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
      key: new Uint8Array(32),
    }, ports);

    expect(result).toEqual({ kind });
    expect(ports.openSelectedHome).not.toHaveBeenCalled();
    expect(ports.continueMachineAndService).not.toHaveBeenCalled();
  });

  it('backs off repeated pending approval polls without authenticating again before opening and continuing', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      let resumeCount = 0;
      const resume = vi.fn(async (): Promise<CliAccountServiceDirectoryAttemptOutcome> => {
        resumeCount += 1;
        if (resumeCount < 3) {
          return {
            kind: 'awaiting_approval',
            homeServerIdentityId: 'home-1',
            expiresAtMs: Date.now() + 10_000,
            resume,
          };
        }
        return {
          kind: 'home_entered',
          homeServerIdentityId: 'home-1',
          profileId: 'studio',
          selection: 'preferred',
        };
      });
      const ports = createPorts({
        runDirectoryJourney: vi.fn(async () => ({
          kind: 'awaiting_approval' as const,
          homeServerIdentityId: 'home-1',
          expiresAtMs: Date.now() + 10_000,
          resume,
        })),
      });

      const result = runCliAccountServiceHomeEntry({
        service: { endpoint: 'https://accounts.example' },
        method: { kind: 'key' },
        key: new Uint8Array(32),
        timeoutMs: 10_000,
      }, ports);
      await vi.advanceTimersByTimeAsync(2_999);
      expect(resume).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(resume).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(4_000);

      await expect(result).resolves.toMatchObject({
        kind: 'home_entered',
        homeServerIdentityId: 'home-1',
      });
      expect(resume).toHaveBeenCalledTimes(3);
      expect(ports.authenticateExactMethod).toHaveBeenCalledOnce();
      expect(ports.openSelectedHome).toHaveBeenCalledOnce();
      expect(ports.continueMachineAndService).toHaveBeenCalledOnce();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('aborts an approval observation already in flight when the overall entry timeout expires', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const observation = { signal: null as AbortSignal | null };
      const resume = vi.fn(async ({ signal }: Readonly<{ signal: AbortSignal }>): Promise<CliAccountServiceDirectoryAttemptOutcome> => {
        observation.signal = signal;
        return await new Promise<CliAccountServiceDirectoryAttemptOutcome>((resolve) => {
          signal.addEventListener('abort', () => resolve({ kind: 'cancelled' }), { once: true });
        });
      });
      const ports = createPorts({
        runDirectoryJourney: vi.fn(async () => ({
          kind: 'awaiting_approval' as const,
          homeServerIdentityId: 'home-1',
          expiresAtMs: Date.now() + 10_000,
          resume,
        })),
      });

      const result = runCliAccountServiceHomeEntry({
        service: { endpoint: 'https://accounts.example' },
        method: { kind: 'key' },
        key: new Uint8Array(32),
        timeoutMs: 1_001,
      }, ports);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(resume).toHaveBeenCalledOnce();
      expect(observation.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(observation.signal?.aborted).toBe(true);
      await expect(result).resolves.toEqual({ kind: 'timed_out' });
      expect(ports.openSelectedHome).not.toHaveBeenCalled();
      expect(ports.continueMachineAndService).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('maps selected-Home open and continuation failures without retrying authentication', async () => {
    const homeUnavailablePorts = createPorts({
      openSelectedHome: vi.fn(async () => ({ kind: 'home_unavailable' as const })),
    });
    await expect(runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
      key: new Uint8Array(32),
    }, homeUnavailablePorts)).resolves.toEqual({ kind: 'home_unavailable' });
    expect(homeUnavailablePorts.authenticateExactMethod).toHaveBeenCalledTimes(1);
    expect(homeUnavailablePorts.continueMachineAndService).not.toHaveBeenCalled();

    const continuationPorts = createPorts({
      continueMachineAndService: vi.fn(async () => ({ kind: 'timed_out' as const })),
    });
    await expect(runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
      key: new Uint8Array(32),
    }, continuationPorts)).resolves.toEqual({
      kind: 'failure',
      stage: 'enter',
      homeServerIdentityId: 'home-1',
      profileId: 'studio',
      homeCredentialCommitted: true,
      recovery: 'retry_stage',
    });
    expect(continuationPorts.authenticateExactMethod).toHaveBeenCalledTimes(1);
  });

  it.each(['home_unavailable', 'cancelled', 'timed_out', 'identity_mismatch', 'failed'] as const)(
    'maps post-focus %s continuation to a committed enter failure',
    async (kind) => {
      const ports = createPorts({
        continueMachineAndService: vi.fn(async () => ({ kind })),
      });

      await expect(runCliAccountServiceHomeEntry({
        service: { endpoint: 'https://accounts.example' },
        method: { kind: 'key' },
        key: new Uint8Array(32),
      }, ports)).resolves.toEqual({
        kind: 'failure',
        stage: 'enter',
        homeServerIdentityId: 'home-1',
        profileId: 'studio',
        homeCredentialCommitted: true,
        recovery: 'retry_stage',
      });
      expect(ports.openSelectedHome).toHaveBeenCalledOnce();
    },
  );

  it('preserves committed enter failure when caller cancellation races after focus', async () => {
    const controller = new AbortController();
    const ports = createPorts({
      continueMachineAndService: vi.fn(async () => {
        controller.abort();
        return { kind: 'cancelled' as const };
      }),
    });

    await expect(runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
      key: new Uint8Array(32),
      signal: controller.signal,
    }, ports)).resolves.toMatchObject({
      kind: 'failure',
      stage: 'enter',
      homeCredentialCommitted: true,
    });
  });

  it('maps a thrown post-focus continuation error to a committed enter failure', async () => {
    const ports = createPorts({
      continueMachineAndService: vi.fn(async () => {
        throw new Error('service continuation failed');
      }),
    });

    await expect(runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
      key: new Uint8Array(32),
    }, ports)).resolves.toMatchObject({
      kind: 'failure',
      stage: 'enter',
      homeCredentialCommitted: true,
    });
  });

  it('preserves successful completion when the timeout fires during non-cancellable continuation', async () => {
    vi.useFakeTimers();
    try {
      let finishContinuation!: () => void;
      const continuation = new Promise<void>((resolve) => { finishContinuation = resolve; });
      const ports = createPorts({
        continueMachineAndService: vi.fn(async () => await continuation.then(() => ({ kind: 'continued' as const }))),
      });
      const result = runCliAccountServiceHomeEntry({
        service: { endpoint: 'https://accounts.example' },
        method: { kind: 'key' },
        key: new Uint8Array(32),
        timeoutMs: 1_000,
      }, ports);

      await vi.advanceTimersByTimeAsync(1_000);
      finishContinuation();
      await expect(result).resolves.toEqual({
        kind: 'home_entered',
        homeServerIdentityId: 'home-1',
        profileId: 'studio',
        selection: 'preferred',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves successful completion when the caller aborts during non-cancellable continuation', async () => {
    const controller = new AbortController();
    let finishContinuation!: () => void;
    const continuation = new Promise<void>((resolve) => { finishContinuation = resolve; });
    const ports = createPorts({
      continueMachineAndService: vi.fn(async () => await continuation.then(() => ({ kind: 'continued' as const }))),
    });
    const result = runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
      key: new Uint8Array(32),
      signal: controller.signal,
    }, ports);

    await vi.waitFor(async () => expect(ports.continueMachineAndService).toHaveBeenCalledOnce());
    controller.abort();
    finishContinuation();
    await expect(result).resolves.toEqual({
      kind: 'home_entered',
      homeServerIdentityId: 'home-1',
      profileId: 'studio',
      selection: 'preferred',
    });
  });

  it('finishes terminal machine and service continuation after cancellation races with completed profile activation', async () => {
    const controller = new AbortController();
    const ports = createPorts({
      openSelectedHome: vi.fn(async () => {
        controller.abort();
        return { kind: 'opened' as const };
      }),
    });

    await expect(runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
      key: new Uint8Array(32),
      signal: controller.signal,
    }, ports)).resolves.toEqual({
      kind: 'home_entered',
      homeServerIdentityId: 'home-1',
      profileId: 'studio',
      selection: 'preferred',
    });

    expect(ports.openSelectedHome).toHaveBeenCalledOnce();
    expect(ports.continueMachineAndService).toHaveBeenCalledOnce();
  });

  it('does not focus or continue after cancellation wins the race with selected-Home enrollment', async () => {
    const controller = new AbortController();
    const ports = createPorts({
      runDirectoryJourney: vi.fn(async () => {
        controller.abort();
        return {
          kind: 'home_entered' as const,
          homeServerIdentityId: 'home-1',
          profileId: 'studio',
          selection: 'preferred' as const,
        };
      }),
    });

    await expect(runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
      key: new Uint8Array(32),
      signal: controller.signal,
    }, ports)).resolves.toEqual({ kind: 'cancelled' });

    expect(ports.openSelectedHome).not.toHaveBeenCalled();
    expect(ports.continueMachineAndService).not.toHaveBeenCalled();
  });

  it('finalizes a deferred material retry that later yields home_entered with exactly one open+continue', async () => {
    const entered = {
      kind: 'home_entered' as const,
      homeServerIdentityId: 'home-1',
      profileId: 'studio',
      selection: 'preferred' as const,
    };
    const retry = vi.fn(async () => entered);
    const ports = createPorts({
      runDirectoryJourney: vi.fn(async () => ({
        kind: 'failure' as const,
        stage: 'material' as const,
        homeServerIdentityId: 'home-1',
        profileId: 'studio',
        homeCredentialCommitted: true,
        recovery: 'retry_stage' as const,
        retry,
      })),
    });

    const initial = await runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
      key: new Uint8Array(32),
    }, ports);
    if (initial.kind !== 'failure' || !initial.retry) throw new Error('Expected deferred material retry');
    expect(ports.openSelectedHome).not.toHaveBeenCalled();
    expect(ports.continueMachineAndService).not.toHaveBeenCalled();

    await expect(initial.retry()).resolves.toEqual(entered);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(ports.openSelectedHome).toHaveBeenCalledTimes(1);
    expect(ports.continueMachineAndService).toHaveBeenCalledTimes(1);
  });

  it('returns deferred continuation failures rather than home_entered', async () => {
    const entered = {
      kind: 'home_entered' as const,
      homeServerIdentityId: 'home-1',
      profileId: 'studio',
      selection: 'preferred' as const,
    };
    const retry = vi.fn(async () => entered);
    const ports = createPorts({
      runDirectoryJourney: vi.fn(async () => ({
        kind: 'failure' as const,
        stage: 'material' as const,
        homeServerIdentityId: 'home-1',
        profileId: 'studio',
        homeCredentialCommitted: true,
        recovery: 'retry_stage' as const,
        retry,
      })),
      continueMachineAndService: vi.fn(async () => ({ kind: 'failed' as const })),
    });

    const initial = await runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
      key: new Uint8Array(32),
    }, ports);
    if (initial.kind !== 'failure' || !initial.retry) throw new Error('Expected deferred material retry');

    await expect(initial.retry()).resolves.toEqual({
      kind: 'failure',
      stage: 'enter',
      homeServerIdentityId: 'home-1',
      profileId: 'studio',
      homeCredentialCommitted: true,
      recovery: 'retry_stage',
    });
    expect(ports.openSelectedHome).toHaveBeenCalledTimes(1);
    expect(ports.continueMachineAndService).toHaveBeenCalledTimes(1);
  });

  it('respects caller abort before deferred retry completion', async () => {
    const controller = new AbortController();
    const entered = {
      kind: 'home_entered' as const,
      homeServerIdentityId: 'home-1',
      profileId: 'studio',
      selection: 'preferred' as const,
    };
    const retry = vi.fn(async () => entered);
    const ports = createPorts({
      runDirectoryJourney: vi.fn(async () => ({
        kind: 'failure' as const,
        stage: 'material' as const,
        homeServerIdentityId: 'home-1',
        profileId: 'studio',
        homeCredentialCommitted: true,
        recovery: 'retry_stage' as const,
        retry,
      })),
    });

    const initial = await runCliAccountServiceHomeEntry({
      service: { endpoint: 'https://accounts.example' },
      method: { kind: 'key' },
      key: new Uint8Array(32),
      signal: controller.signal,
    }, ports);
    if (initial.kind !== 'failure' || !initial.retry) throw new Error('Expected deferred material retry');
    controller.abort();

    await expect(initial.retry()).resolves.toEqual({ kind: 'cancelled' });
    expect(ports.openSelectedHome).not.toHaveBeenCalled();
    expect(ports.continueMachineAndService).not.toHaveBeenCalled();
  });
});
