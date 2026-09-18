import type {
  CredentialReadinessState,
  MachineRegistrationState,
} from '@/auth/resolveActiveServerAuthReadiness';

export type SetupReadinessDecision =
  | Readonly<{ kind: 'select-home' }>
  | Readonly<{ kind: 'home-unavailable' }>
  | Readonly<{ kind: 'authenticate'; reason: 'sign-in' | 'register-machine' }>
  | Readonly<{ kind: 'ready' }>;

/**
 * Pure setup entry decision. In particular, unknown validation is neither a
 * successful sign-in nor evidence that the user needs a different Home.
 */
export function decideSetupReadiness(params: Readonly<{
  credentialState: CredentialReadinessState;
  machineRegistrationState: MachineRegistrationState;
  hasExplicitTarget: boolean;
}>): SetupReadinessDecision {
  if (params.credentialState === 'unknown') {
    return { kind: 'home-unavailable' };
  }
  if (params.credentialState === 'valid') {
    return params.machineRegistrationState === 'server-confirmed'
      ? { kind: 'ready' }
      : { kind: 'authenticate', reason: 'register-machine' };
  }
  if (!params.hasExplicitTarget) {
    return { kind: 'select-home' };
  }
  return { kind: 'authenticate', reason: 'sign-in' };
}

export type SetupStep = Readonly<{
  id: 'auth_login' | 'daemon_install' | 'daemon_start' | 'agents_setup';
  argv: readonly string[];
  display: string;
}>;

export type SetupPlan = Readonly<{
  serverUrl: string;
  steps: readonly SetupStep[];
}>;

export const SETUP_AUTH_WAIT_TIMEOUT_SECONDS = 5 * 60;

export function buildSetupPlan(params: Readonly<{
  serverUrl: string;
  includeAuth: boolean;
  forceWebAuthentication: boolean;
  includeDaemon: boolean;
  skipProviders: boolean;
  installedAgentIds: readonly string[];
  providers: readonly string[];
  assumeYes: boolean;
  recoverAccountMaterial?: boolean;
}>): SetupPlan {
  const serverUrl = params.serverUrl.trim().replace(/\/+$/u, '');
  const steps: SetupStep[] = [];
  if (params.includeAuth) {
    const methodArgs = params.forceWebAuthentication ? ['--method', 'web'] : [];
    const materialArgs = params.recoverAccountMaterial ? ['--recover-account-material'] : [];
    steps.push({
      id: 'auth_login',
      argv: [
        'auth',
        'login',
        '--wait-timeout',
        String(SETUP_AUTH_WAIT_TIMEOUT_SECONDS),
        ...methodArgs,
        ...materialArgs,
        '--no-daemon-start',
      ],
      display: `happier auth login --wait-timeout ${SETUP_AUTH_WAIT_TIMEOUT_SECONDS}${methodArgs.length > 0 ? ' --method web' : ''}${materialArgs.length > 0 ? ' --recover-account-material' : ''}`,
    });
  }
  if (params.includeDaemon) {
    steps.push({ id: 'daemon_install', argv: ['service', 'install'], display: 'happier service install' });
    steps.push({ id: 'daemon_start', argv: ['service', 'start'], display: 'happier service start' });
  }
  const includeProviders = !params.skipProviders
    && (params.installedAgentIds.length === 0 || params.providers.length > 0);
  if (includeProviders) {
    const yesArgv = params.assumeYes ? ['--yes'] : [];
    const providerArgv = params.providers.flatMap((id) => ['--provider', id]);
    steps.push({
      id: 'agents_setup',
      argv: ['agents', 'setup', ...providerArgv, ...yesArgv],
      display: providerArgv.length > 0
        ? `happier agents setup ${params.providers.map((id) => `--provider ${id}`).join(' ')}${params.assumeYes ? ' --yes' : ''}`
        : `happier agents setup${params.assumeYes ? ' --yes' : ''}`,
    });
  }
  return { serverUrl, steps };
}
