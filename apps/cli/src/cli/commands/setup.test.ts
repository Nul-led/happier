import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { BackgroundServiceSetupGuidance } from '@happier-dev/cli-common/systemTasks';
import type { SyncInstalledFirstPartyShimsResult } from '@happier-dev/cli-common/firstPartyRuntime';
import type { ActiveServerStoredTokenValidationResult } from '@/auth/validateStoredAuthTokenAgainstActiveServer';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import { captureConsoleLogAndMuteStdout, captureStdoutJsonOutput } from '@/testkit/logger/captureOutput';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';
import { reconcileCreatedPersonalHome } from './home/createLocalPersonalHome';
import { handleHomeCommand, type HomeCommandDeps } from './home';

const { getAgentCliSetupRecommendedIdsMock } = vi.hoisted(() => ({
  getAgentCliSetupRecommendedIdsMock: vi.fn(() => ['alpha', 'beta']),
}));

const { validateStoredAuthTokenAgainstActiveServerMock } = vi.hoisted(() => ({
  validateStoredAuthTokenAgainstActiveServerMock: vi.fn<
    (token: string) => Promise<ActiveServerStoredTokenValidationResult>
  >(async () => ({ state: 'valid', httpStatus: 200 })),
}));

vi.mock('@happier-dev/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@happier-dev/agents')>();
  return {
    ...actual,
    getAgentCliSetupRecommendedIds: getAgentCliSetupRecommendedIdsMock,
  };
});

vi.mock('@/auth/validateStoredAuthTokenAgainstActiveServer', () => ({
  validateStoredAuthTokenAgainstActiveServer: (token: string) => validateStoredAuthTokenAgainstActiveServerMock(token),
}));

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

function createBackgroundServiceSetupGuidance(
  overrides: Partial<BackgroundServiceSetupGuidance> = {},
): BackgroundServiceSetupGuidance {
  return {
    targetReleaseChannel: 'stable',
    targetServerUrl: 'https://relay.example.test',
    currentHappierHomeDir: null,
    currentDefaultReleaseChannel: 'stable',
    managedReleaseChannels: [],
    manualRelayOwner: null,
    exactDefaultServiceExists: false,
    conflictingServices: [],
    foreignHomeConflictingServices: [],
    shouldOfferDefaultReleaseChannelSwitch: false,
    shouldPromptForManualRelayTakeover: false,
    shouldPromptForServiceReplacement: false,
    ...overrides,
  };
}

describe('happier setup', () => {
  let output = captureConsoleLogAndMuteStdout();
  const envKeys = [
    'HAPPIER_HOME_DIR',
    'HAPPIER_SERVER_URL',
    'HAPPIER_LOCAL_SERVER_URL',
    'HAPPIER_PUBLIC_SERVER_URL',
    'HAPPIER_WEBAPP_URL',
    'HAPPIER_ACTIVE_SERVER_ID',
    'HAPPIER_NONINTERACTIVE',
    'PATH',
    'HOME',
  ] as const;

/**
 * Agent CLI resolution honours a `HAPPIER_<AGENT>_PATH` override, and this
 * machine may have one exported. Clearing every override is what makes "no agent
 * is installed here" a property of the temp home rather than of the developer.
 */
function withoutAgentCliPathOverrides(): () => void {
  const cleared = Object.keys(process.env).filter((key) => /^HAPPIER_[A-Z0-9_]+_PATH$/u.test(key));
  const previous = cleared.map((key) => [key, process.env[key]] as const);
  for (const key of cleared) delete process.env[key];
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
  let envScope = createEnvKeyScope(envKeys);

  beforeEach(() => {
    output.restore();
    output = captureConsoleLogAndMuteStdout();
    validateStoredAuthTokenAgainstActiveServerMock.mockReset();
    validateStoredAuthTokenAgainstActiveServerMock.mockResolvedValue({ state: 'valid', httpStatus: 200 });
    process.exitCode = undefined;
  });

  afterEach(() => {
    output.restore();
    envScope.restore();
    envScope = createEnvKeyScope(envKeys);
    vi.resetModules();
  });

  async function importHandleSetupCommand(): Promise<typeof import('./setup')> {
    return await import('./setup');
  }

  it('reconciles an authenticated created Home exactly once without reporting setup incomplete', async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      const { handleSetupCommand } = await importHandleSetupCommand();
      const useProfile = vi.fn(async () => ({ id: 'personal-home' } as never));
      const reload = vi.fn();
      const setupInvocations: string[][] = [];
      const serviceSteps: string[][] = [];
      output.logs.length = 0;

      await reconcileCreatedPersonalHome('personal-home', {
        useProfile,
        reload,
        quiet: true,
        runSetup: async (args, setupDeps) => {
          setupInvocations.push([...args]);
          await handleSetupCommand(args, {
            ...setupDeps,
            applyServerSelectionFromArgs: async (selectionArgs) => selectionArgs.filter(
              (argument) => argument !== '--server' && argument !== 'personal-home' && argument !== '--persist',
            ),
            readCredentialsFn: async () => ({ token: 'personal-home-token', encryption: null }),
            readSettingsFn: async () => ({ machineId: 'machine-local', machineIdConfirmedByServer: true } as never),
            isInteractiveTerminalFn: () => false,
            readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance(),
            runHappyCliStepFn: async (argv) => {
              serviceSteps.push([...argv]);
              return 0;
            },
            listInstalledAgentIdsFn: async () => ['codex'],
          });
        },
      });

      expect(useProfile).toHaveBeenCalledOnce();
      expect(reload).toHaveBeenCalledOnce();
      expect(setupInvocations).toEqual([['--server', 'personal-home', '--skip-providers', '--yes']]);
      expect(serviceSteps).toEqual([['service', 'install'], ['service', 'start']]);
      expect(output.logs).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('continues interactive Home creation through the real setup adapter before pairing or readiness output', async () => {
    const { handleSetupCommand } = await importHandleSetupCommand();
    const serviceSteps: string[][] = [];
    const order: string[] = [];
    let serviceExitCode = 0;
    const pairDevice = vi.fn(async () => {
      order.push('pair');
      return { kind: 'completed' as const, requestedDeviceLabel: 'Phone' };
    });
    const linkAccount = vi.fn(async () => {
      order.push('link');
      return { kind: 'linked' as const, homeServerIdentityId: 'srv_personal_home' };
    });
    const deps: HomeCommandDeps = {
      createRunner: () => { throw new Error('system-task runner is not used by local creation'); },
      resolvePath: (value) => value,
      isInteractiveTerminal: () => true,
      promptInput: async () => 'yes',
      sleep: async () => undefined,
      resolveDefaultChannel: () => 'dev',
      createPersonalHome: async () => {
        order.push('create');
        return {
          profileId: 'personal-home',
          homeServerIdentityId: 'srv_personal_home',
          canonicalServerUrl: 'http://127.0.0.1:43123',
          accountCreated: true,
        };
      },
      reconcileCreatedHome: async (profileId, options) => {
        order.push('reconcile');
        await reconcileCreatedPersonalHome(profileId, {
          ...options,
          useProfile: async () => ({ id: profileId } as never),
          reload: vi.fn(),
          runSetup: async (args, setupDeps) => await handleSetupCommand(args, {
            ...setupDeps,
            applyServerSelectionFromArgs: async (selectionArgs) => selectionArgs.filter(
              (argument) => argument !== '--server' && argument !== profileId && argument !== '--persist',
            ),
            readCredentialsFn: async () => ({ token: 'personal-home-token', encryption: null }),
            readSettingsFn: async () => ({ machineId: 'machine-local', machineIdConfirmedByServer: true } as never),
            isInteractiveTerminalFn: () => false,
            readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance(),
            runHappyCliStepFn: async (argv) => {
              serviceSteps.push([...argv]);
              order.push(argv.join(' '));
              return serviceExitCode;
            },
            listInstalledAgentIdsFn: async () => ['codex'],
          }),
        });
      },
      pairDevice,
      linkAccount,
    };

    output.logs.length = 0;
    await handleHomeCommand(['create', '--link-account', 'auto'], deps);

    expect(serviceSteps).toEqual([['service', 'install'], ['service', 'start']]);
    expect(order).toEqual(['create', 'reconcile', 'service install', 'service start', 'pair', 'link']);
    expect(process.exitCode).toBeUndefined();
    expect(output.logs.some((line) => line.includes('Personal Home ready'))).toBe(true);

    serviceExitCode = 17;
    serviceSteps.length = 0;
    order.length = 0;
    pairDevice.mockClear();
    linkAccount.mockClear();
    output.logs.length = 0;
    await expect(handleHomeCommand(['create', '--link-account', 'auto'], deps)).rejects.toMatchObject({
      code: 'home_create_reconciliation_failed',
    });
    expect(serviceSteps).toEqual([['service', 'install']]);
    expect(pairDevice).not.toHaveBeenCalled();
    expect(linkAccount).not.toHaveBeenCalled();
    expect(output.logs.some((line) => line.includes('Personal Home ready'))).toBe(false);
  });

  it('prints a setup_plan JSON envelope', async () => {
    await withTempDir('happier-setup-plan-json-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      output.restore();
      const jsonOutput = captureStdoutJsonOutput();
      try {
        await handleSetupCommand(['plan', '--relay-url', 'https://relay.example.test', '--json']);
        const parsed = jsonOutput.json<any>();
        expect(parsed.v).toBe(1);
        expect(parsed.ok).toBe(true);
        expect(parsed.kind).toBe('setup_plan');
        expect(parsed.data?.relayUrl).toBe('https://relay.example.test');
        expect(Array.isArray(parsed.data?.steps)).toBe(true);
        expect(parsed.data.steps.length).toBeGreaterThan(0);
      } finally {
        jsonOutput.restore();
        output = captureConsoleLogAndMuteStdout();
      }
    });
  });

  it('renders --help output as a structured help page', async () => {
    await withTempDir('happier-setup-help-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      await handleSetupCommand(['--help']);
      const text = stripAnsi(output.logs.join('\n'));
      expect(text).toContain('setup');
      expect(text).toContain('Usage:');
      expect(text).toContain('happier setup plan');
      expect(text).toContain('Examples:');
      expect(text).toContain('happier setup --home-url https://home.example.test --provider alpha --provider beta');
      expect(text).not.toContain('happier setup --home-url https://home.example.test --provider codex --provider claude');
      expect(text).toContain('Notes:');
      expect(text).toContain('Connects this computer to a Home');
      expect(text).not.toContain('Sets up this computer for a Relay');
      expect(text).not.toContain('Description:');
    });
  });

  it('prints a numbered setup plan in non-JSON plan mode', async () => {
    await withTempDir('happier-setup-plan-text-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      await handleSetupCommand(['plan', '--relay-url', 'https://relay.example.test']);
      const text = stripAnsi(output.logs.join('\n'));
      expect(output.logs[0]?.startsWith('\n')).toBe(false);
      expect(text).toContain('Setup plan');
      expect(text).toContain('Home:');
      expect(text).toContain('https://relay.example.test');
      expect(text).toContain('1. happier auth login');
    });
  });

  it('applies an explicit relay with --yes, then stops before the human-approved auth step', async () => {
    await withTempDir('happier-setup-run-noninteractive-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const calls: string[][] = [];
      const previousExitCode = process.exitCode;
      const applyServerSelectionFromArgs = async (args: string[]) => {
        expect(args).toEqual([
          '--server-url',
          'https://relay.example.test',
          '--persist',
          '--yes',
        ]);
        return ['--yes'];
      };

      try {
        await handleSetupCommand(
          ['--relay-url', 'https://relay.example.test', '--yes'],
          {
            applyServerSelectionFromArgs,
            readCredentialsFn: async () => null,
            readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance(),
            isInteractiveTerminalFn: () => false,
            promptInputFn: async () => {
              throw new Error('prompt should not be used');
            },
            runHappyCliStepFn: async (argv) => {
              calls.push([...argv]);
              return 0;
            },
          },
        );

        expect(calls).toEqual([]);
        expect(stripAnsi(output.logs.join('\n'))).toContain('happier setup --relay-url https://relay.example.test');
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = previousExitCode;
      }
    });
  });

  it('keeps public --yes incomplete even when the named Home already has valid credentials', async () => {
    await withTempDir('happier-setup-yes-valid-home-incomplete-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://home.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      const child = vi.fn(async () => 0);
      const previousExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        await handleSetupCommand(['--home-url', 'https://home.example.test', '--yes'], {
          applyServerSelectionFromArgs: async (selectionArgs) => selectionArgs.filter(
            (argument) => !['--server-url', 'https://home.example.test', '--yes'].includes(argument),
          ),
          readCredentialsFn: async () => ({ token: 'valid-token', encryption: null }),
          readSettingsFn: async () => ({ machineId: 'machine', machineIdConfirmedByServer: true } as never),
          isInteractiveTerminalFn: () => false,
          runHappyCliStepFn: child,
        });

        expect(child).not.toHaveBeenCalled();
        expect(stripAnsi(output.logs.join('\n'))).toContain('happier setup --home-url https://home.example.test');
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = previousExitCode;
      }
    });
  });

  it('reports explicit --yes JSON as incomplete after target application', async () => {
    await withTempDir('happier-setup-yes-json-incomplete-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      output.restore();
      const jsonOutput = captureStdoutJsonOutput();
      try {
        await handleSetupCommand(['--home-url', 'https://home.example.test', '--yes', '--json'], {
          applyServerSelectionFromArgs: async () => ['--yes', '--json'],
          isInteractiveTerminalFn: () => false,
        });
        expect(jsonOutput.json()).toMatchObject({
          v: 1,
          ok: false,
          kind: 'setup',
          error: { code: 'interactive_approval_required', state: 'incomplete', targetApplied: true },
        });
        expect(process.exitCode).toBe(1);
      } finally {
        jsonOutput.restore();
        output = captureConsoleLogAndMuteStdout();
      }
    });
  });

  it('resolves and adopts an Iroh-only descriptor, then focuses it only after authentication succeeds', async () => {
    await withTempDir('happier-setup-iroh-descriptor-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      const descriptor: HomeConnectionDescriptorV1 = {
        v: 1,
        homeServerIdentityId: 'srv_iroh_home',
        canonicalServerUrl: 'http://127.0.0.1:3005',
        revision: 1,
        endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
      };
      const resolveHomeTargetFn = vi.fn(async () => ({
        profileId: null,
        homeServerIdentityId: descriptor.homeServerIdentityId,
        descriptor,
        canonicalAuthUrl: descriptor.canonicalServerUrl,
        applicationUrl: descriptor.canonicalServerUrl,
        webappUrl: 'https://app.happier.dev',
        credentialDestination: {
          v: 1 as const,
          homeServerIdentityId: descriptor.homeServerIdentityId,
          canonicalServerUrl: descriptor.canonicalServerUrl,
          applicationEndpointUrls: [],
          irohEndpointIds: ['a'.repeat(64)],
        },
        preferredTransport: 'iroh' as const,
        authority: 'trusted_enrollment' as const,
      }));
      const adoptDescriptorFn = vi.fn(async () => ({ profile: { id: 'iroh-home' } } as never));
      const useProfileFn = vi.fn(async (_profileId: string) => ({ id: 'iroh-home' } as never));
      const childCalls: string[][] = [];
      const order: string[] = [];

      await handleSetupCommand(['--home-descriptor-file', '/tmp/home.json', '--skip-daemon', '--skip-providers'], {
        readHomeDescriptorTextFn: async () => JSON.stringify(descriptor),
        resolveHomeTargetFn,
        resolveCurrentHomeTargetFn: resolveHomeTargetFn,
        adoptHomeDescriptorFn: adoptDescriptorFn,
        useHomeProfileFn: async (profileId) => {
          order.push(`focus:${profileId}`);
          return await useProfileFn(profileId);
        },
        readCredentialsFn: async () => null,
        readSettingsFn: async () => ({ machineId: null } as never),
        isInteractiveTerminalFn: () => true,
        promptInputFn: async () => '',
        runHappyCliStepFn: async (argv) => {
          childCalls.push([...argv]);
          order.push(`child:${argv.join(' ')}`);
          return 0;
        },
      });

      expect(resolveHomeTargetFn).toHaveBeenCalledWith({ kind: 'descriptor', descriptor, authority: 'trusted_enrollment' });
      expect(adoptDescriptorFn).toHaveBeenCalledWith(expect.objectContaining({ descriptor, observation: 'exact', use: false }));
      expect(useProfileFn).toHaveBeenCalledWith('iroh-home');
      expect(childCalls).toEqual([['auth', 'login', '--wait-timeout', '300', '--no-daemon-start']]);
      expect(order).toEqual([
        'child:auth login --wait-timeout 300 --no-daemon-start',
        'focus:iroh-home',
      ]);
    });
  });

  it('keeps the previous active Home focused when descriptor authentication fails', async () => {
    await withTempDir('happier-setup-iroh-descriptor-auth-failure-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      const descriptor: HomeConnectionDescriptorV1 = {
        v: 1,
        homeServerIdentityId: 'srv_failed_home',
        canonicalServerUrl: 'http://127.0.0.1:3005',
        revision: 1,
        endpoints: [{ kind: 'iroh', endpointId: 'b'.repeat(64) }],
      };
      const resolved = {
        profileId: null,
        homeServerIdentityId: descriptor.homeServerIdentityId,
        descriptor,
        canonicalAuthUrl: descriptor.canonicalServerUrl,
        applicationUrl: descriptor.canonicalServerUrl,
        webappUrl: 'https://app.happier.dev',
        credentialDestination: {
          v: 1 as const,
          homeServerIdentityId: descriptor.homeServerIdentityId,
          canonicalServerUrl: descriptor.canonicalServerUrl,
          applicationEndpointUrls: [],
          irohEndpointIds: ['b'.repeat(64)],
        },
        preferredTransport: 'iroh' as const,
        authority: 'trusted_enrollment' as const,
      };
      const useProfileFn = vi.fn(async () => ({ id: 'failed-home' } as never));

      await handleSetupCommand(['--home-descriptor-file', '/tmp/home.json', '--skip-daemon', '--skip-providers'], {
        readHomeDescriptorTextFn: async () => JSON.stringify(descriptor),
        resolveHomeTargetFn: async () => resolved,
        resolveCurrentHomeTargetFn: async () => resolved,
        adoptHomeDescriptorFn: async () => ({ profile: { id: 'failed-home' } } as never),
        useHomeProfileFn: useProfileFn,
        readCredentialsFn: async () => null,
        readSettingsFn: async () => ({ machineId: null } as never),
        isInteractiveTerminalFn: () => true,
        promptInputFn: async () => '',
        runHappyCliStepFn: async () => 19,
      });

      expect(useProfileFn).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(19);
    });
  });

  it('keeps the previous active Home focused when saved HTTPS Home authentication fails', async () => {
    await withTempDir('happier-setup-saved-home-auth-failure-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      const useProfileFn = vi.fn(async () => ({ id: 'candidate-home' } as never));

      await handleSetupCommand(['--home-url', 'https://candidate.example.test', '--skip-daemon', '--skip-providers'], {
        prepareServerSelectionFromArgsFn: async () => ({
          rest: ['--skip-daemon', '--skip-providers'],
          profileId: 'candidate-home',
        }),
        resolveCurrentHomeTargetFn: async () => ({
          profileId: 'candidate-home',
          homeServerIdentityId: null,
          descriptor: null,
          canonicalAuthUrl: 'https://candidate.example.test',
          applicationUrl: 'https://candidate.example.test',
          webappUrl: 'https://candidate.example.test',
          credentialDestination: null,
          preferredTransport: 'https',
          authority: 'manual_url',
        }),
        useHomeProfileFn: useProfileFn,
        readCredentialsFn: async () => null,
        readSettingsFn: async () => ({ machineId: null } as never),
        isInteractiveTerminalFn: () => true,
        promptInputFn: async () => '',
        runHappyCliStepFn: async () => 23,
      });

      expect(useProfileFn).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(23);
    });
  });

  it('stops setup after a cancelled auth child without focusing the target or starting service/providers', async () => {
    await withTempDir('happier-setup-auth-cancel-incomplete-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      const useProfileFn = vi.fn(async () => ({ id: 'candidate-home' } as never));
      const calls: string[][] = [];

      await handleSetupCommand(['--home-url', 'https://candidate.example.test'], {
        prepareServerSelectionFromArgsFn: async () => ({ rest: [], profileId: 'candidate-home' }),
        resolveCurrentHomeTargetFn: async () => ({
          profileId: 'candidate-home',
          homeServerIdentityId: null,
          descriptor: null,
          canonicalAuthUrl: 'https://candidate.example.test',
          applicationUrl: 'https://candidate.example.test',
          webappUrl: 'https://candidate.example.test',
          credentialDestination: null,
          preferredTransport: 'https',
          authority: 'manual_url',
        }),
        useHomeProfileFn: useProfileFn,
        readCredentialsFn: async () => null,
        readSettingsFn: async () => ({ machineId: null } as never),
        isInteractiveTerminalFn: () => true,
        promptInputFn: async () => '',
        readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance(),
        runHappyCliStepFn: async (argv) => {
          calls.push([...argv]);
          return argv[0] === 'auth' ? 1 : 0;
        },
      });

      expect(calls).toEqual([['auth', 'login', '--wait-timeout', '300', '--no-daemon-start']]);
      expect(useProfileFn).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(stripAnsi(output.logs.join('\n'))).not.toContain('Setup complete.');
    });
  });

  it('rejects a missing descriptor value before selecting or authenticating', async () => {
    const { handleSetupCommand } = await importHandleSetupCommand();
    const select = vi.fn(async (args: string[]) => args);
    const child = vi.fn(async () => 0);

    await expect(handleSetupCommand(['--home-descriptor-file'], {
      applyServerSelectionFromArgs: select,
      isInteractiveTerminalFn: () => true,
      runHappyCliStepFn: child,
    })).rejects.toThrow('Missing value for --home-descriptor-file');

    expect(select).not.toHaveBeenCalled();
    expect(child).not.toHaveBeenCalled();
  });

  it('rejects competing descriptor and saved-Home targets before mutation', async () => {
    const { handleSetupCommand } = await importHandleSetupCommand();
    const select = vi.fn(async (args: string[]) => args);
    const child = vi.fn(async () => 0);

    await expect(handleSetupCommand(['--home-descriptor-file', '/tmp/home.json', '--home', 'saved-home'], {
      applyServerSelectionFromArgs: select,
      isInteractiveTerminalFn: () => true,
      runHappyCliStepFn: child,
    })).rejects.toThrow('Use only one explicit Home target');

    expect(select).not.toHaveBeenCalled();
    expect(child).not.toHaveBeenCalled();
  });

  it('delegates an explicit create choice to home create without installing a generic relay', async () => {
    await withTempDir('happier-setup-create-delegation-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      const calls: string[][] = [];
      const prompts: string[] = [];

      await handleSetupCommand(['--skip-providers'], {
        readCredentialsFn: async () => null,
        readSettingsFn: async () => ({ machineId: null } as never),
        isInteractiveTerminalFn: () => true,
        promptInputFn: async (prompt) => {
          prompts.push(prompt);
          if (prompt.includes('Run setup now?')) return '';
          if (prompt.includes('No preferred Home')) return 'c';
          return '';
        },
        runAccountServiceHomeEntryFn: async () => ({ kind: 'no_preferred_home' }),
        runHappyCliStepFn: async (argv) => { calls.push([...argv]); return 0; },
      });

      expect(calls).toEqual([['home', 'create']]);
      expect(calls.flat()).not.toContain('relay');
      expect(stripAnsi(prompts.join('\n'))).toContain('No preferred Home');
    });
  });

  it('treats HAPPIER_NONINTERACTIVE as zero-mutation even when a TTY is present', async () => {
    await withTempDir('happier-setup-env-noninteractive-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined, HAPPIER_NONINTERACTIVE: '1' });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      const select = vi.fn(async (args: string[]) => args);
      const child = vi.fn(async () => 0);
      const previousExitCode = process.exitCode;
      try {
        await handleSetupCommand(['--home-url', 'https://home.example.test'], {
          applyServerSelectionFromArgs: select,
          isInteractiveTerminalFn: () => true,
          runHappyCliStepFn: child,
        });
        expect(select).not.toHaveBeenCalled();
        expect(child).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = previousExitCode;
      }
    });
  });

  it('does not consume descriptor stdin when non-interactive setup must change nothing', async () => {
    const { handleSetupCommand } = await importHandleSetupCommand();
    const readHomeDescriptorTextFn = vi.fn(async () => {
      throw new Error('descriptor stdin must not be read');
    });

    await handleSetupCommand(['--home-descriptor-file', '-', '--non-interactive'], {
      readHomeDescriptorTextFn,
      isInteractiveTerminalFn: () => false,
    });

    expect(readHomeDescriptorTextFn).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('writes nothing when --yes does not name a relay', async () => {
    await withTempDir('happier-setup-run-yes-needs-relay-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const applyServerSelectionFromArgs = vi.fn(async (args: string[]) => args);
      const runHappyCliStepFn = vi.fn(async () => 0);
      const previousExitCode = process.exitCode;
      try {
        await handleSetupCommand(['--yes'], {
          applyServerSelectionFromArgs,
          readCredentialsFn: async () => null,
          readSettingsFn: async () => ({ machineId: null } as any),
          isInteractiveTerminalFn: () => false,
          promptInputFn: async () => {
            throw new Error('prompt should not be used');
          },
          runHappyCliStepFn,
        });

        expect(applyServerSelectionFromArgs).not.toHaveBeenCalled();
        expect(runHappyCliStepFn).not.toHaveBeenCalled();
        expect(stripAnsi(output.logs.join('\n'))).toContain('choose a Home');
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = previousExitCode;
      }
    });
  });

  it('keeps public --yes incomplete when credentials already exist', async () => {
    await withTempDir('happier-setup-skip-auth-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const calls: string[][] = [];
      await handleSetupCommand(
        ['--relay-url', 'https://relay.example.test', '--yes', '--skip-daemon'],
        {
          applyServerSelectionFromArgs: async () => ['--yes', '--skip-daemon'],
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => false,
          promptInputFn: async () => {
            throw new Error('prompt should not be used');
          },
          runHappyCliStepFn: async (argv) => {
            calls.push([...argv]);
            return 0;
          },
        },
      );

      expect(calls).toEqual([]);
    });
  });

  it('stops --yes before auth when credentials exist but the machine is not registered', async () => {
    await withTempDir('happier-setup-auth-when-machine-missing-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const calls: string[][] = [];
      await handleSetupCommand(
        ['--relay-url', 'https://relay.example.test', '--yes', '--skip-daemon'],
        {
          applyServerSelectionFromArgs: async () => ['--yes', '--skip-daemon'],
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: null } as any),
          isInteractiveTerminalFn: () => false,
          promptInputFn: async () => {
            throw new Error('prompt should not be used');
          },
          runHappyCliStepFn: async (argv) => {
            calls.push([...argv]);
            return 0;
          },
        },
      );

      expect(calls).toEqual([]);
      expect(stripAnsi(output.logs.join('\n'))).toContain('happier setup --relay-url https://relay.example.test');
    });
  });

  it('does not force persistence when relay-url already matches the active server selection', async () => {
    await withTempDir('happier-setup-no-persist-when-already-selected-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const calls: string[][] = [];
      const applyServerSelectionFromArgs = async (args: string[]) => {
        expect(args).toEqual([
          '--server-url',
          'https://relay.example.test',
          '--yes',
          '--skip-daemon',
        ]);
        return ['--yes', '--skip-daemon'];
      };

      await handleSetupCommand(
        ['--relay-url', 'https://relay.example.test', '--yes', '--skip-daemon'],
        {
          applyServerSelectionFromArgs,
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => false,
          promptInputFn: async () => {
            throw new Error('prompt should not be used');
          },
          runHappyCliStepFn: async (argv) => {
            calls.push([...argv]);
            return 0;
          },
        },
      );

      expect(calls).toEqual([]);
    });
  });

  it('does not reselect the relay or re-prompt auth when relay-url already matches the active server selection', async () => {
    await withTempDir('happier-setup-no-reselect-current-relay-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const calls: string[][] = [];
      await handleSetupCommand(
        ['--relay-url', 'https://relay.example.test', '--yes', '--skip-daemon'],
        {
          applyServerSelectionFromArgs: async () => {
            throw new Error('relay selection should not be re-applied when the relay URL already matches the active server');
          },
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => false,
          promptInputFn: async () => {
            throw new Error('prompt should not be used');
          },
          runHappyCliStepFn: async (argv) => {
            calls.push([...argv]);
            return 0;
          },
        },
      );

      expect(calls).toEqual([]);
    });
  });

  it('guides default release-channel switching and background-service replacement before daemon setup', async () => {
    await withTempDir('happier-setup-guided-daemon-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const calls: string[][] = [];
      const writeDefaultManagedReleaseChannelFn: typeof import('@happier-dev/cli-common/firstPartyRuntime').writeDefaultManagedReleaseChannel = vi.fn(async () => ({
        releaseChannel: 'preview' as const,
        statePath: `${homeDir}/default-cli-release-channel.json`,
      }));
      const syncInstalledFirstPartyShimsFn = vi.fn(async (): Promise<SyncInstalledFirstPartyShimsResult> => ({
        shimPaths: [`${homeDir}/bin/happier`],
      }));
      const promptInputFn = vi.fn<(prompt: string) => Promise<string>>()
        .mockResolvedValueOnce('y')
        .mockResolvedValueOnce('y')
        .mockResolvedValueOnce('y');

      await handleSetupCommand(
        ['--relay-url', 'https://relay.example.test', '--yes'],
        {
          quiet: true,
          invocation: 'authenticated-home-create-continuation',
          applyServerSelectionFromArgs: async () => ['--yes'],
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => true,
          promptInputFn,
          readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance({
            targetReleaseChannel: 'preview',
            currentDefaultReleaseChannel: 'stable',
            managedReleaseChannels: [
              {
                releaseChannel: 'stable',
                label: 'stable',
                version: '1.0.0',
                installationId: 'stable-install',
                installationPath: '/managed/stable',
                invokerName: 'happier',
                isDefault: true,
                onPath: true,
              },
              {
                releaseChannel: 'preview',
                label: 'preview',
                version: '2.0.0',
                installationId: 'preview-install',
                installationPath: '/managed/preview',
                invokerName: 'hprev',
                isDefault: false,
                onPath: true,
              },
            ],
            manualRelayOwner: {
              currentReleaseChannel: 'stable',
              currentCliVersion: '0.2.0',
            },
            exactDefaultServiceExists: false,
            conflictingServices: [
              {
                label: 'com.happier.cli.daemon.stable.default',
                releaseChannel: 'stable',
                targetMode: 'pinned',
                running: true,
                serverUrl: 'https://relay.example.test',
                happierHomeDir: homeDir,
              },
            ],
            shouldOfferDefaultReleaseChannelSwitch: true,
            shouldPromptForManualRelayTakeover: true,
            shouldPromptForServiceReplacement: true,
          }),
          writeDefaultManagedReleaseChannelFn,
          syncInstalledFirstPartyShimsFn,
          runHappyCliStepFn: async (argv) => {
            calls.push([...argv]);
            return 0;
          },
        },
      );

      expect(promptInputFn).toHaveBeenNthCalledWith(
        1,
        'Make preview the default release-channel before installing the default background service targeting https://relay.example.test? [Y/n] ',
      );
      expect(promptInputFn).toHaveBeenNthCalledWith(
        2,
        'This computer is currently using a temporary relay process for https://relay.example.test. Continue to stop that process and switch this computer to the background service? [Y/n] ',
      );
      expect(promptInputFn).toHaveBeenNthCalledWith(
        3,
        'This computer already has conflicting Happier background services. Replace them before installing the default background service targeting https://relay.example.test? [Y/n] ',
      );
      expect(writeDefaultManagedReleaseChannelFn).toHaveBeenCalledWith({
        processEnv: process.env,
        releaseChannel: 'preview',
      });
      expect(syncInstalledFirstPartyShimsFn).toHaveBeenCalledWith({
        componentId: 'happier-cli',
        channel: 'preview',
        processEnv: process.env,
      });
      expect(calls).toEqual([
        ['service', 'uninstall', '--all', '--yes'],
        ['service', 'install', '--takeover'],
        ['service', 'start', '--takeover'],
        ['agents', 'setup', '--yes'],
      ]);
    });
  });

  it('starts the existing default background service with takeover instead of reinstalling it', async () => {
    await withTempDir('happier-setup-takeover-existing-default-background-service-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const calls: string[][] = [];
      const promptInputFn = vi.fn<(prompt: string) => Promise<string>>()
        .mockResolvedValueOnce('y');

      await handleSetupCommand(
        ['--relay-url', 'https://relay.example.test', '--yes'],
        {
          quiet: true,
          invocation: 'authenticated-home-create-continuation',
          applyServerSelectionFromArgs: async () => ['--yes'],
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => true,
          promptInputFn,
          readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance({
            exactDefaultServiceExists: true,
            manualRelayOwner: {
              currentReleaseChannel: 'stable',
              currentCliVersion: '0.2.0',
            },
            shouldPromptForManualRelayTakeover: true,
            managedReleaseChannels: [
              {
                releaseChannel: 'stable',
                label: 'stable',
                version: '1.0.0',
                installationId: 'stable-install',
                installationPath: '/managed/stable',
                invokerName: 'happier',
                isDefault: true,
                onPath: true,
              },
            ],
          }),
          runHappyCliStepFn: async (argv) => {
            calls.push([...argv]);
            return 0;
          },
        },
      );

      expect(promptInputFn).toHaveBeenCalledWith(
        'This computer is currently using a temporary relay process for https://relay.example.test. Continue to stop that process and switch this computer to the background service? [Y/n] ',
      );
      expect(calls).toEqual([
        ['service', 'start', '--takeover'],
        ['agents', 'setup', '--yes'],
      ]);
    });
  });

  it('reuses an exact default background service instead of reinstalling it during setup', async () => {
    await withTempDir('happier-setup-reuse-default-background-service-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const calls: string[][] = [];
      await handleSetupCommand(
        ['--relay-url', 'https://relay.example.test', '--yes'],
        {
          quiet: true,
          invocation: 'authenticated-home-create-continuation',
          applyServerSelectionFromArgs: async () => ['--yes'],
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => false,
          promptInputFn: async () => {
            throw new Error('prompt should not be used');
          },
          readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance({
            exactDefaultServiceExists: true,
            managedReleaseChannels: [
              {
                releaseChannel: 'stable',
                label: 'stable',
                version: '1.0.0',
                installationId: 'stable-install',
                installationPath: '/managed/stable',
                invokerName: 'happier',
                isDefault: true,
                onPath: true,
              },
            ],
          }),
          runHappyCliStepFn: async (argv) => {
            calls.push([...argv]);
            return 0;
          },
        },
      );

      expect(calls).toEqual([
        ['agents', 'setup', '--yes'],
      ]);
    });
  });

  it('restarts the reused default background service when setup switched this computer to another relay', async () => {
    await withTempDir('happier-setup-reuse-default-background-service-new-relay-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://old-relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const calls: string[][] = [];
      await handleSetupCommand(
        ['--relay-url', 'https://new-relay.example.test', '--yes'],
        {
          quiet: true,
          invocation: 'authenticated-home-create-continuation',
          applyServerSelectionFromArgs: async () => ['--yes'],
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => false,
          promptInputFn: async () => {
            throw new Error('prompt should not be used');
          },
          readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance({
            targetServerUrl: 'https://new-relay.example.test',
            exactDefaultServiceExists: true,
            managedReleaseChannels: [
              {
                releaseChannel: 'stable',
                label: 'stable',
                version: '1.0.0',
                installationId: 'stable-install',
                installationPath: '/managed/stable',
                invokerName: 'happier',
                isDefault: true,
                onPath: true,
              },
            ],
          }),
          runHappyCliStepFn: async (argv) => {
            calls.push([...argv]);
            return 0;
          },
        },
      );

      // The service resolved its relay when it started, which was before this
      // run switched the machine. Reusing it as-is leaves it on the old relay.
      expect(calls).toEqual([
        ['service', 'restart'],
        ['agents', 'setup', '--yes'],
      ]);
    });
  });

  it('does not switch the default release-channel when setup is later cancelled by keeping conflicting services', async () => {
    await withTempDir('happier-setup-guided-decline-after-switch-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const calls: string[][] = [];
      const writeDefaultManagedReleaseChannelFn: typeof import('@happier-dev/cli-common/firstPartyRuntime').writeDefaultManagedReleaseChannel = vi.fn(async () => ({
        releaseChannel: 'preview' as const,
        statePath: `${homeDir}/default-cli-release-channel.json`,
      }));
      const syncInstalledFirstPartyShimsFn = vi.fn(async (): Promise<SyncInstalledFirstPartyShimsResult> => ({
        shimPaths: [`${homeDir}/bin/happier`],
      }));
      const promptInputFn = vi.fn<(prompt: string) => Promise<string>>()
        .mockResolvedValueOnce('y')
        .mockResolvedValueOnce('n');

      await expect(handleSetupCommand(
        ['--relay-url', 'https://relay.example.test', '--yes'],
        {
          quiet: true,
          invocation: 'authenticated-home-create-continuation',
          applyServerSelectionFromArgs: async (args) => args,
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => true,
          promptInputFn,
          readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance({
            targetReleaseChannel: 'preview',
            currentDefaultReleaseChannel: 'stable',
            managedReleaseChannels: [
              {
                releaseChannel: 'stable',
                label: 'stable',
                version: '1.0.0',
                installationId: 'stable-install',
                installationPath: '/managed/stable',
                invokerName: 'happier',
                isDefault: true,
                onPath: true,
              },
              {
                releaseChannel: 'preview',
                label: 'preview',
                version: '2.0.0',
                installationId: 'preview-install',
                installationPath: '/managed/preview',
                invokerName: 'hprev',
                isDefault: false,
                onPath: true,
              },
            ],
            exactDefaultServiceExists: false,
            conflictingServices: [
              {
                label: 'com.happier.cli.daemon.stable.default',
                releaseChannel: 'stable',
                targetMode: 'pinned',
                running: true,
                serverUrl: 'https://relay.example.test',
                happierHomeDir: homeDir,
              },
            ],
            shouldOfferDefaultReleaseChannelSwitch: true,
            shouldPromptForServiceReplacement: true,
          }),
          writeDefaultManagedReleaseChannelFn,
          syncInstalledFirstPartyShimsFn,
          runHappyCliStepFn: async (argv) => {
            calls.push([...argv]);
            return 0;
          },
        },
      )).rejects.toMatchObject({ code: 'home_create_reconciliation_failed' });

      expect(promptInputFn).toHaveBeenNthCalledWith(
        1,
        'Make preview the default release-channel before installing the default background service targeting https://relay.example.test? [Y/n] ',
      );
      expect(promptInputFn).toHaveBeenNthCalledWith(
        2,
        'This computer already has conflicting Happier background services. Replace them before installing the default background service targeting https://relay.example.test? [Y/n] ',
      );
      expect(writeDefaultManagedReleaseChannelFn).not.toHaveBeenCalled();
      expect(syncInstalledFirstPartyShimsFn).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    });
  });

  it('reports guided background-service cancellation as incomplete without running service or provider steps', async () => {
    await withTempDir('happier-setup-guidance-cancel-incomplete-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();
      const calls: string[][] = [];
      const promptInputFn = vi.fn<(prompt: string) => Promise<string>>()
        .mockResolvedValueOnce('y')
        .mockResolvedValueOnce('n');

      await handleSetupCommand(['--relay-url', 'https://relay.example.test'], {
        readCredentialsFn: async () => ({ encryption: null, token: 't' }),
        readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as never),
        isInteractiveTerminalFn: () => true,
        promptInputFn,
        readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance({
          exactDefaultServiceExists: false,
          conflictingServices: [{
            label: 'com.happier.cli.daemon.stable.default',
            releaseChannel: 'stable',
            targetMode: 'pinned',
            running: true,
            serverUrl: 'https://other.example.test',
            happierHomeDir: homeDir,
          }],
          shouldPromptForServiceReplacement: true,
        }),
        runHappyCliStepFn: async (argv) => {
          calls.push([...argv]);
          return 0;
        },
      });

      expect(calls).toEqual([]);
      expect(process.exitCode).toBe(1);
      const text = stripAnsi(output.logs.join('\n'));
      expect(text).toContain('Aborted.');
      expect(text).not.toContain('Setup complete.');
    });
  });

  it('fails closed in non-interactive mode when guided daemon setup needs release-channel or service decisions', async () => {
    await withTempDir('happier-setup-guided-noninteractive-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      await expect(handleSetupCommand(
        ['--relay-url', 'https://relay.example.test', '--yes'],
        {
          quiet: true,
          invocation: 'authenticated-home-create-continuation',
          applyServerSelectionFromArgs: async (args) => args,
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => false,
          promptInputFn: async () => {
            throw new Error('prompt should not be used');
          },
          readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance({
            targetReleaseChannel: 'preview',
            currentDefaultReleaseChannel: 'stable',
            managedReleaseChannels: [
              {
                releaseChannel: 'preview',
                label: 'preview',
                version: '2.0.0',
                installationId: 'preview-install',
                installationPath: '/managed/preview',
                invokerName: 'hprev',
                isDefault: false,
                onPath: true,
              },
            ],
            shouldOfferDefaultReleaseChannelSwitch: true,
          }),
          runHappyCliStepFn: async () => 0,
        },
      )).rejects.toThrow(/requires interactive guidance/i);
    });
  });

  it('warns that no coding agent is installed when setup finishes and none resolve', async () => {
    await withTempDir('happier-setup-no-agent-', async (homeDir) => {
      envScope.patch({
        HAPPIER_HOME_DIR: homeDir,
        HAPPIER_SERVER_URL: 'https://relay.example.test',
        HAPPIER_ACTIVE_SERVER_ID: undefined,
        // Agent CLI resolution reads PATH, HOME and HAPPIER_HOME_DIR; pointing all
        // three at an empty temp tree is what makes "nothing installed" real here.
        PATH: '',
        HOME: homeDir,
      });
      const restoreOverrides = withoutAgentCliPathOverrides();
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      try {
        await handleSetupCommand(
          ['--relay-url', 'https://relay.example.test', '--skip-daemon', '--skip-providers'],
          {
            applyServerSelectionFromArgs: async (args) => args,
            readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
            readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
            isInteractiveTerminalFn: () => true,
            promptInputFn: async () => '',
            runHappyCliStepFn: async () => 0,
          },
        );
      } finally {
        restoreOverrides();
      }

      const text = stripAnsi(output.logs.join('\n'));
      expect(text).toContain('No coding agent found on this computer.');
      expect(text).toContain('happier agents install alpha');
      expect(text).toContain('happier agents install beta');
      expect(text).toContain('Setup complete.');
    });
  }, 180_000);

  it('does not warn about a missing coding agent when one resolves', async () => {
    await withTempDir('happier-setup-agent-present-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      await handleSetupCommand(
        ['--relay-url', 'https://relay.example.test', '--skip-daemon', '--skip-providers'],
        {
          applyServerSelectionFromArgs: async (args) => args,
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => true,
          promptInputFn: async () => '',
          runHappyCliStepFn: async () => 0,
          listInstalledAgentIdsFn: async () => ['alpha'],
        },
      );

      const text = stripAnsi(output.logs.join('\n'));
      expect(text).not.toContain('No coding agent found');
      expect(text).toContain('Setup complete.');
    });
  });

  it('does not warn about a missing coding agent when setup ran the agent install step itself', async () => {
    await withTempDir('happier-setup-agent-installed-by-setup-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      await handleSetupCommand(
        ['--relay-url', 'https://relay.example.test', '--skip-daemon'],
        {
          applyServerSelectionFromArgs: async (args) => args,
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => true,
          promptInputFn: async () => '',
          runHappyCliStepFn: async () => 0,
          listInstalledAgentIdsFn: async () => [],
        },
      );

      expect(stripAnsi(output.logs.join('\n'))).not.toContain('No coding agent found');
    });
  });

  it('delegates the five-minute bound to the auth command that owns polling', async () => {
    await withTempDir('happier-setup-auth-timeout-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
      vi.resetModules();
      const { handleSetupCommand } = await importHandleSetupCommand();

      const previousExitCode = process.exitCode;
      const calls: string[][] = [];
      try {
        await handleSetupCommand(
          ['--relay-url', 'https://relay.example.test', '--skip-daemon', '--skip-providers'],
          {
            applyServerSelectionFromArgs: async (args) => args,
            readCredentialsFn: async () => null,
            isInteractiveTerminalFn: () => true,
            promptInputFn: async () => '',
            readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance(),
            runHappyCliStepFn: async (argv) => {
              calls.push([...argv]);
              return argv[0] === 'auth' ? 1 : 0;
            },
          },
        );

        expect(calls).toEqual([['auth', 'login', '--wait-timeout', '300', '--no-daemon-start']]);
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = previousExitCode;
      }
    });
  });

  /**
   * Credentials are stored per relay profile, so the relay has to be settled
   * before `happier auth login` runs: a self-hoster who signs in first and points
   * at their own relay afterwards ends up with two accounts, not a moved one.
   */
  describe('where the relay lives', () => {
    it('runs the Account Service Home-entry coordinator for fresh default Cloud setup instead of generic Home auth', async () => {
      await withTempDir('happier-setup-account-service-default-', async (homeDir) => {
        envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();

        const runAccountServiceHomeEntryFn = vi.fn(async () => ({
          kind: 'preferred_home_enrolled' as const,
          homeServerIdentityId: 'srv_home_studio',
          profileId: 'studio',
        }));
        const childCalls: string[][] = [];

        await handleSetupCommand(['--skip-daemon', '--skip-providers'], {
          applyServerSelectionFromArgs: async (selectionArgs) => selectionArgs.filter(
            (argument) => argument !== '--server' && argument !== 'cloud',
          ),
          readCredentialsFn: async () => null,
          readSettingsFn: async () => ({ machineId: null } as any),
          isInteractiveTerminalFn: () => true,
          promptInputFn: async (prompt) => prompt.includes('Where does your relay live?') ? 'c' : '',
          runAccountServiceHomeEntryFn,
          runHappyCliStepFn: async (argv) => {
            childCalls.push([...argv]);
            return 0;
          },
        });

        expect(runAccountServiceHomeEntryFn).toHaveBeenCalledTimes(1);
        expect(childCalls).not.toContainEqual(expect.arrayContaining(['auth', 'login']));
      });
    });

    it('does not install or select the chosen relay when the user declines the run confirmation', async () => {
      await withTempDir('happier-setup-relay-confirm-before-write-', async (homeDir) => {
        envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();

        const calls: string[][] = [];
        await handleSetupCommand(['--skip-daemon', '--skip-providers'], {
          applyServerSelectionFromArgs: async (args) => args,
          readCredentialsFn: async () => null,
          readSettingsFn: async () => ({ machineId: null } as any),
          isInteractiveTerminalFn: () => true,
          promptInputFn: async (prompt: string) => {
            if (prompt.includes('Where does your relay live?')) return 't';
            if (prompt.includes('Run setup now?')) return 'n';
            return '';
          },
          runHappyCliStepFn: async (argv) => {
            calls.push([...argv]);
            return 0;
          },
        });

        expect(calls).toEqual([]);
        expect(process.exitCode).toBe(1);
        expect(stripAnsi(output.logs.join('\n'))).not.toContain('Setup complete.');
      });
    });

    it('asks again when stored credentials are rejected by the active relay', async () => {
      await withTempDir('happier-setup-relay-question-rejected-credentials-', async (homeDir) => {
        envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
        validateStoredAuthTokenAgainstActiveServerMock.mockResolvedValue({ state: 'invalid', httpStatus: 401, reasonCode: 'not_authenticated' });
        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();

        const prompts: string[] = [];
        const calls: string[][] = [];
        const accountServiceEntry = vi.fn(async () => ({
          kind: 'preferred_home_enrolled' as const,
          homeServerIdentityId: 'srv_home',
          profileId: 'home',
        }));
        await handleSetupCommand(['--skip-daemon', '--skip-providers'], {
          applyServerSelectionFromArgs: async (args) => args.filter((arg) => arg !== '--server' && arg !== 'cloud'),
          readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 'rejected' } as any),
          readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
          isInteractiveTerminalFn: () => true,
          promptInputFn: async (prompt: string) => {
            prompts.push(prompt);
            return prompt.includes('Where does your relay live?') ? 'c' : '';
          },
          runAccountServiceHomeEntryFn: accountServiceEntry,
          runHappyCliStepFn: async (argv) => {
            calls.push([...argv]);
            return 0;
          },
        });

        expect(stripAnsi(prompts.join('\n'))).not.toContain('Where does your relay live?');
        expect(accountServiceEntry).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([]);
      });
    });

    it('retains an unavailable active Home and never starts selection or authentication', async () => {
      await withTempDir('happier-setup-home-unavailable-', async (homeDir) => {
        envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://home.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
        validateStoredAuthTokenAgainstActiveServerMock.mockResolvedValue({
          state: 'unknown',
          httpStatus: null,
          reasonCode: 'TimeoutError',
        });
        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();

        const selection = vi.fn(async (selectionArgs: string[]) => selectionArgs);
        const calls: string[][] = [];
        const prompts: string[] = [];
        const previousExitCode = process.exitCode;
        try {
          await handleSetupCommand(['--skip-daemon', '--skip-providers'], {
            applyServerSelectionFromArgs: selection,
            readCredentialsFn: async () => ({
              encryption: null,
              token: 'stored-token',
              credentialProvenance: 'stored_session',
            }),
            readSettingsFn: async () => ({
              machineId: 'machine-confirmed',
              machineIdConfirmedByServer: true,
            }) as Awaited<ReturnType<typeof import('@/persistence').readSettings>>,
            isInteractiveTerminalFn: () => true,
            promptInputFn: async (prompt) => {
              prompts.push(prompt);
              return '';
            },
            runHappyCliStepFn: async (argv) => {
              calls.push([...argv]);
              return 0;
            },
          });

          expect(selection).not.toHaveBeenCalled();
          expect(calls).toEqual([]);
          expect(stripAnsi(output.logs.join('\n'))).toContain('did not answer');
          expect(stripAnsi(output.logs.join('\n'))).toContain('Stored sign-in was kept');
          expect(stripAnsi(prompts.join('\n'))).not.toContain('Where does your relay live?');
          expect(process.exitCode).toBe(1);
        } finally {
          process.exitCode = previousExitCode;
        }
      });
    });

    it('uses the default Account Service without installing a relay on this computer', async () => {
      await withTempDir('happier-setup-relay-question-this-computer-', async (homeDir) => {
        envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'http://127.0.0.1:3005', HAPPIER_ACTIVE_SERVER_ID: undefined });
        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();

        const calls: string[][] = [];
        const prompts: string[] = [];
        await handleSetupCommand(
          ['--skip-providers'],
          {
            applyServerSelectionFromArgs: async (args) => args,
            readCredentialsFn: async () => null,
            readSettingsFn: async () => ({ machineId: null } as any),
            isInteractiveTerminalFn: () => true,
            promptInputFn: async (prompt: string) => {
              prompts.push(prompt);
              return prompt.includes('Where does your relay live?') ? 't' : '';
            },
            runAccountServiceHomeEntryFn: async () => ({
              kind: 'preferred_home_enrolled', homeServerIdentityId: 'srv_home', profileId: 'home',
            }),
            readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance({
              targetServerUrl: 'http://127.0.0.1:3005',
            }),
            runHappyCliStepFn: async (argv) => {
              calls.push([...argv]);
              return 0;
            },
          },
        );

        const asked = stripAnsi(prompts.join('\n'));
        expect(asked).not.toContain('Where does your relay live?');
        expect(calls).toEqual([
          ['service', 'install'],
          ['service', 'start'],
        ]);
      });
    });

    it('lets the Account Service owner reuse its persisted custom selection without a Cloud override', async () => {
      await withTempDir('happier-setup-relay-question-cloud-', async (homeDir) => {
        envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();

        const selectionArgs: string[][] = [];
        const calls: string[][] = [];
        const persistedAccountServiceEndpoint = 'https://accounts.company.example';
        const contactedAccountServiceEndpoints: string[] = [];
        const accountServiceEntry = vi.fn(async (input: Readonly<{ endpoint?: string }>) => {
          contactedAccountServiceEndpoints.push(input.endpoint ?? persistedAccountServiceEndpoint);
          return {
            kind: 'preferred_home_enrolled' as const,
            homeServerIdentityId: 'srv_home',
            profileId: 'home',
          };
        });
        await handleSetupCommand(
          ['--skip-providers'],
          {
            applyServerSelectionFromArgs: async (args) => {
              selectionArgs.push([...args]);
              return args.filter((arg) => arg !== '--server' && arg !== 'cloud');
            },
            readCredentialsFn: async () => null,
            readSettingsFn: async () => ({ machineId: null } as any),
            isInteractiveTerminalFn: () => true,
            promptInputFn: async (prompt: string) => (prompt.includes('Where does your relay live?') ? 'c' : ''),
            runAccountServiceHomeEntryFn: accountServiceEntry,
            readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance(),
            runHappyCliStepFn: async (argv) => {
              calls.push([...argv]);
              return 0;
            },
          },
        );

        expect(selectionArgs).toEqual([]);
        expect(accountServiceEntry).toHaveBeenCalledWith(expect.not.objectContaining({ endpoint: expect.anything() }));
        expect(contactedAccountServiceEndpoints).toEqual([persistedAccountServiceEndpoint]);
        expect(calls).toEqual([
          ['service', 'install'],
          ['service', 'start'],
        ]);
      });
    });

    it('does not enter the legacy relay chooser when setup has no explicit target', async () => {
      await withTempDir('happier-setup-relay-question-existing-', async (homeDir) => {
        envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();

        const applyServerSelectionFromArgs = vi.fn(async (args: string[]) => args);
        const calls: string[][] = [];
        await handleSetupCommand(
          ['--skip-providers'],
          {
            applyServerSelectionFromArgs,
            readCredentialsFn: async () => null,
            readSettingsFn: async () => ({ machineId: null } as any),
            isInteractiveTerminalFn: () => true,
            promptInputFn: async (prompt: string) => {
              if (prompt.includes('Where does your relay live?')) return 'r';
              if (stripAnsi(prompt).includes('Relay URL')) return 'https://relay.example.test';
              return '';
            },
            runAccountServiceHomeEntryFn: async () => ({
              kind: 'preferred_home_enrolled', homeServerIdentityId: 'srv_home', profileId: 'home',
            }),
            readBackgroundServiceSetupGuidanceFn: async () => createBackgroundServiceSetupGuidance(),
            runHappyCliStepFn: async (argv) => {
              calls.push([...argv]);
              return 0;
            },
          },
        );

        expect(applyServerSelectionFromArgs).not.toHaveBeenCalled();
        expect(calls).toEqual([
          ['service', 'install'],
          ['service', 'start'],
        ]);
      });
    });

    it('does not ask when the relay was named on the command line', async () => {
      await withTempDir('happier-setup-relay-question-skipped-', async (homeDir) => {
        envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_ACTIVE_SERVER_ID: undefined });
        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();

        const prompts: string[] = [];
        const calls: string[][] = [];
        await handleSetupCommand(
          ['--relay-url', 'https://relay.example.test', '--skip-daemon', '--skip-providers'],
          {
            applyServerSelectionFromArgs: async () => ['--skip-daemon', '--skip-providers'],
            readCredentialsFn: async () => null,
            readSettingsFn: async () => ({ machineId: null } as any),
            isInteractiveTerminalFn: () => true,
            promptInputFn: async (prompt: string) => {
              prompts.push(prompt);
              return '';
            },
            runHappyCliStepFn: async (argv) => {
              calls.push([...argv]);
              return 0;
            },
          },
        );

        expect(stripAnsi(prompts.join('\n'))).not.toContain('Where does your relay live?');
        expect(calls).toEqual([['auth', 'login', '--wait-timeout', '300', '--no-daemon-start']]);
      });
    });

    it('does not ask when this computer already has an account on its active relay', async () => {
      await withTempDir('happier-setup-relay-question-already-signed-in-', async (homeDir) => {
        envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();

        const prompts: string[] = [];
        await handleSetupCommand(
          ['--skip-daemon', '--skip-providers'],
          {
            applyServerSelectionFromArgs: async (args) => args,
            readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
            readSettingsFn: async () => ({ machineId: 'mid_123', machineIdConfirmedByServer: true } as any),
            isInteractiveTerminalFn: () => true,
            promptInputFn: async (prompt: string) => {
              prompts.push(prompt);
              return '';
            },
            runHappyCliStepFn: async () => 0,
          },
        );

        expect(stripAnsi(prompts.join('\n'))).not.toContain('Where does your relay live?');
      });
    });

    it('keeps the authenticated relay when only this machine still needs registration', async () => {
      await withTempDir('happier-setup-relay-question-machine-registration-', async (homeDir) => {
        envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_ACTIVE_SERVER_ID: undefined });
        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();

        const prompts: string[] = [];
        const calls: string[][] = [];
        await handleSetupCommand(
          ['--skip-daemon', '--skip-providers'],
          {
            applyServerSelectionFromArgs: async (selectionArgs) => {
              throw new Error(`relay selection should not run: ${selectionArgs.join(' ')}`);
            },
            readCredentialsFn: async () => ({ encryption: { type: 'legacy', secret: new Uint8Array([1]) }, token: 't' } as any),
            readSettingsFn: async () => ({ machineId: null } as any),
            isInteractiveTerminalFn: () => true,
            promptInputFn: async (prompt: string) => {
              prompts.push(prompt);
              return '';
            },
            runHappyCliStepFn: async (argv) => {
              calls.push([...argv]);
              return 0;
            },
          },
        );

        expect(stripAnsi(prompts.join('\n'))).not.toContain('Where does your relay live?');
        expect(calls).toEqual([['auth', 'login', '--wait-timeout', '300', '--no-daemon-start']]);
      });
    });

    it('does not offer relay-access providers during default Account Service entry', async () => {
      await withTempDir('happier-setup-relay-access-offer-', async (homeDir) => {
        envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: undefined, HAPPIER_ACTIVE_SERVER_ID: undefined });
        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();

        const calls: string[][] = [];
        const prompts: string[] = [];
        await handleSetupCommand(
          ['--skip-daemon', '--skip-providers'],
          {
            applyServerSelectionFromArgs: async (args) => args,
            readCredentialsFn: async () => null,
            readSettingsFn: async () => ({ machineId: null } as any),
            isInteractiveTerminalFn: () => true,
            promptInputFn: async (prompt: string) => {
              prompts.push(prompt);
              if (prompt.includes('Where does your relay live?')) return 't';
              if (prompt.includes('How should your phone reach this relay?')) return 'tailscaleServe';
              return '';
            },
            runAccountServiceHomeEntryFn: async () => ({
              kind: 'preferred_home_enrolled', homeServerIdentityId: 'srv_home', profileId: 'home',
            }),
            runHappyCliStepFn: async (argv) => {
              calls.push([...argv]);
              return 0;
            },
          },
        );

        expect(stripAnsi(prompts.join('\n'))).not.toContain('How should your phone reach this relay?');
        expect(stripAnsi(prompts.join('\n'))).not.toContain('Tailscale Funnel');
        expect(calls).toEqual([]);
      });
    });
  });

  /**
   * `happier setup plan` is a dry run: it prints what setup WOULD do. Resolving the
   * requested relay must therefore stay read-only — no settings write, no
   * process-wide env write — while still reporting the relay the real run would use.
   */
  describe('plan mode is side-effect free', () => {
    async function seedServerProfile(params: Readonly<{ name: string; serverUrl: string; use: boolean }>): Promise<void> {
      const { upsertServerProfileByUrl } = await import('@/server/serverProfiles');
      await upsertServerProfileByUrl({
        name: params.name,
        serverUrl: params.serverUrl,
        webappUrl: params.serverUrl,
        use: params.use,
      });
    }

    it('does not persist a relay switch when planning with --relay-url', async () => {
      await withTempDir('happier-setup-plan-no-persist-', async (homeDir) => {
        envScope.patch({
          HAPPIER_HOME_DIR: homeDir,
          HAPPIER_SERVER_URL: undefined,
          HAPPIER_LOCAL_SERVER_URL: undefined,
          HAPPIER_PUBLIC_SERVER_URL: undefined,
          HAPPIER_WEBAPP_URL: undefined,
          HAPPIER_ACTIVE_SERVER_ID: undefined,
        });
        vi.resetModules();
        await seedServerProfile({ name: 'company', serverUrl: 'https://company.example.test', use: true });

        const settingsFile = join(homeDir, 'settings.json');
        const settingsBefore = await readFile(settingsFile, 'utf8');

        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();
        await handleSetupCommand(['plan', '--relay-url', 'https://relay.example.test']);

        expect(await readFile(settingsFile, 'utf8')).toBe(settingsBefore);
        expect(process.env.HAPPIER_SERVER_URL).toBeUndefined();
        expect(process.env.HAPPIER_ACTIVE_SERVER_ID).toBeUndefined();
        expect(process.env.HAPPIER_WEBAPP_URL).toBeUndefined();

        const text = stripAnsi(output.logs.join('\n'));
        expect(text).toContain('https://relay.example.test');
      });
    });

    it('does not switch the active server profile when planning with --server', async () => {
      await withTempDir('happier-setup-plan-no-profile-switch-', async (homeDir) => {
        envScope.patch({
          HAPPIER_HOME_DIR: homeDir,
          HAPPIER_SERVER_URL: undefined,
          HAPPIER_LOCAL_SERVER_URL: undefined,
          HAPPIER_PUBLIC_SERVER_URL: undefined,
          HAPPIER_WEBAPP_URL: undefined,
          HAPPIER_ACTIVE_SERVER_ID: undefined,
        });
        vi.resetModules();
        await seedServerProfile({ name: 'company', serverUrl: 'https://company.example.test', use: true });
        await seedServerProfile({ name: 'staging', serverUrl: 'https://staging.example.test', use: false });

        const settingsFile = join(homeDir, 'settings.json');
        const settingsBefore = await readFile(settingsFile, 'utf8');

        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();
        await handleSetupCommand(['plan', '--server', 'staging']);

        expect(await readFile(settingsFile, 'utf8')).toBe(settingsBefore);
        expect(JSON.parse(settingsBefore).activeServerId).not.toBe('staging');

        // Resolution still happened: the plan reports the profile that a real run would select.
        const text = stripAnsi(output.logs.join('\n'));
        expect(text).toContain('https://staging.example.test');
      });
    });

    it('does not rewrite server environment variables when planning with --no-persist', async () => {
      await withTempDir('happier-setup-plan-no-env-write-', async (homeDir) => {
        envScope.patch({
          HAPPIER_HOME_DIR: homeDir,
          HAPPIER_SERVER_URL: undefined,
          HAPPIER_LOCAL_SERVER_URL: undefined,
          HAPPIER_PUBLIC_SERVER_URL: undefined,
          HAPPIER_WEBAPP_URL: undefined,
          HAPPIER_ACTIVE_SERVER_ID: undefined,
        });
        vi.resetModules();
        await seedServerProfile({ name: 'company', serverUrl: 'https://company.example.test', use: true });

        const settingsFile = join(homeDir, 'settings.json');
        const settingsBefore = await readFile(settingsFile, 'utf8');

        vi.resetModules();
        const { handleSetupCommand } = await importHandleSetupCommand();
        await handleSetupCommand(['plan', '--relay-url', 'https://relay.example.test', '--no-persist']);

        expect(process.env.HAPPIER_SERVER_URL).toBeUndefined();
        expect(process.env.HAPPIER_ACTIVE_SERVER_ID).toBeUndefined();
        expect(process.env.HAPPIER_WEBAPP_URL).toBeUndefined();
        expect(await readFile(settingsFile, 'utf8')).toBe(settingsBefore);

        const text = stripAnsi(output.logs.join('\n'));
        expect(text).toContain('https://relay.example.test');
      });
    });
  });
});
