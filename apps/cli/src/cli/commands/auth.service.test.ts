import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleAuthServiceCommand } from './auth/service';

function captureLog() {
  return vi.spyOn(console, 'log').mockImplementation(() => {});
}

function sessionOwner(overrides: Record<string, unknown> = {}) {
  return {
    readSelection: vi.fn(async () => null),
    readCredential: vi.fn(async () => null),
    selectService: vi.fn(),
    replaceCredential: vi.fn(),
    rejectCredential: vi.fn(),
    authenticate: vi.fn(),
    logout: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    ...overrides,
  } as never;
}

const SELECTION = {
  endpoint: 'https://service.example',
  serverIdentityId: 'srv_service',
  canonicalServerUrl: 'https://service.example',
};

describe('happier auth service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('reports the selected service only after its current identity and role verify', async () => {
    const output = captureLog();
    const resolvePresentation = vi.fn(async () => ({
      displayName: 'Acme Identity',
      endpoint: SELECTION.endpoint,
      serverIdentityId: SELECTION.serverIdentityId,
    }));

    await handleAuthServiceCommand(['status'], undefined, {
      createSession: () => sessionOwner({ readSelection: vi.fn(async () => SELECTION) }),
      resolvePresentation,
    });

    const text = output.mock.calls.flat().join('\n');
    expect(text).toContain('Acme Identity');
    expect(text).toContain('https://service.example');
    expect(text).toContain('srv_service');
    expect(process.exitCode).toBeUndefined();
  });

  it('does not present a stored pointer whose service no longer verifies as one', async () => {
    const output = captureLog();

    await handleAuthServiceCommand(['status'], undefined, {
      createSession: () => sessionOwner({ readSelection: vi.fn(async () => SELECTION) }),
      resolvePresentation: vi.fn(async () => null),
    });

    const text = output.mock.calls.flat().join('\n');
    expect(text).toContain('did not confirm its identity or Account Service role');
    expect(process.exitCode).toBe(1);
  });

  it('says nothing is selected instead of probing a service that was never chosen', async () => {
    const output = captureLog();
    const resolvePresentation = vi.fn(async () => null);

    await handleAuthServiceCommand(['status'], undefined, {
      createSession: () => sessionOwner(),
      resolvePresentation,
    });

    expect(output.mock.calls.flat().join('\n')).toContain('No Account Service is selected.');
    expect(resolvePresentation).not.toHaveBeenCalled();
  });

  it('signs in through the one setup-entry owner and reports the Home it entered', async () => {
    const output = captureLog();
    const runSetupEntry = vi.fn(async () => ({
      kind: 'home_entered' as const,
      homeServerIdentityId: 'srv_home',
      profileId: 'profile-1',
      selection: 'sole' as const,
    }));

    await handleAuthServiceCommand(['use', 'https://service.example'], undefined, {
      createSession: () => sessionOwner(),
      runSetupEntry: runSetupEntry as never,
    });

    expect(runSetupEntry).toHaveBeenCalledWith({
      endpoint: 'https://service.example',
      context: { kind: 'none' },
    });
    expect(output.mock.calls.flat().join('\n')).toContain('entered Home srv_home');
    expect(process.exitCode).toBeUndefined();
  });

  it('hands an unfinished choice back to the interactive journey instead of re-asking it here', async () => {
    const output = captureLog();

    await handleAuthServiceCommand(['use', 'https://service.example'], undefined, {
      createSession: () => sessionOwner(),
      runSetupEntry: (async () => ({ kind: 'choose_home', homes: [] })) as never,
    });

    const text = output.mock.calls.flat().join('\n');
    expect(text).toContain('choose_home');
    expect(text).toContain('happier setup');
    expect(process.exitCode).toBe(1);
  });

  it('drops only this CLI\'s service credential on logout', async () => {
    const output = captureLog();
    const logout = vi.fn(async () => {});

    await handleAuthServiceCommand(['logout'], undefined, {
      createSession: () => sessionOwner({ logout }),
    });

    expect(logout).toHaveBeenCalledOnce();
    expect(output.mock.calls.flat().join('\n'))
      .toContain('Homes you already entered keep their own credentials.');
  });

  it('refuses an unknown or malformed service subcommand', async () => {
    await expect(handleAuthServiceCommand(['nope'], undefined, { createSession: () => sessionOwner() }))
      .rejects.toMatchObject({ code: 'invalid_params' });
    await expect(handleAuthServiceCommand(['use'], undefined, { createSession: () => sessionOwner() }))
      .rejects.toMatchObject({ code: 'invalid_params' });
    await expect(handleAuthServiceCommand(['status', 'extra'], undefined, { createSession: () => sessionOwner() }))
      .rejects.toMatchObject({ code: 'invalid_params' });
  });
});
