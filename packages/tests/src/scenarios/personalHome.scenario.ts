/**
 * Lane 09 Personal Home shell-first owner contract assertions (lane-09 §7.1).
 *
 * These are bounded owner-level supporting checks bound to the canonical owners named by the
 * plan. Composed desktop/QR/device proofs (real shell frame, live process restart, loaded
 * daemon) remain release evidence owned by the sole Lane 09 release report and are not claimed
 * here. The suites/contracts/*.test.ts files run these assertions as ordinary named tests.
 */

import {
  createDaemonServiceStartTaskKind,
  type DaemonServiceKindDeps,
  type DaemonServiceStatusSnapshot,
} from '../../../cli-common/src/systemTasks/kinds/daemonServiceKinds';
import { SystemTaskExecutionError } from '../../../cli-common/src/systemTasks/runSystemTask';
import {
  runPersonalHomeBootstrap,
  type PersonalHomeAccountCredentials,
  type PersonalHomeBootstrapDeps,
  type PersonalHomeBootstrapReceipt,
} from '../../../cli-common/src/firstPartyRuntime/personalHome/bootstrap';
import {
  createPersonalHomeRuntimeSpec,
  renderPersonalHomeRuntimeEnv,
} from '../../../cli-common/src/firstPartyRuntime/personalHome/personalHomeRuntimeSpec';
import { assertLayoutPath, resolvePersonalHomeRuntimeLayout } from '../../../cli-common/src/firstPartyRuntime/personalHome/layout';
import {
  applyAndVerifyPersonalHomeSignupClosure,
  assertPersonalHomeSignupClosed,
  PERSONAL_HOME_SIGNUP_POLICY_ENV_KEY,
  PersonalHomeSignupClosureError,
  readEffectivePersonalHomeSignupPolicy,
} from '../../../cli-common/src/firstPartyRuntime/personalHomeSignupPolicy';
import { resolveLocalServicePublicExposureDecision } from '../../../../apps/server/sources/app/local/services/public/policy';
import type { LocalServicePublicExposureModeV1 } from '@happier-dev/protocol';

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The Personal Home runtime purpose is loopback-only, plaintext, and owns its data layout. */
export async function assertPersonalHomeRuntimeSpecContract(): Promise<void> {
  const spec = createPersonalHomeRuntimeSpec({ canonicalServerUrl: 'http://127.0.0.1:43123/' });
  require(spec.purpose === 'personal-home' && spec.anonymousSignupPhase === 'loopback-bootstrap-then-disabled', 'Personal Home runtime purpose drifted');
  require(spec.bindAddress === '127.0.0.1', 'Personal Home must bind loopback');
  require(spec.encryptionStoragePolicy === 'plaintext_only' && spec.defaultAccountMode === 'plain', 'Personal Home storage policy drifted');
  const env = renderPersonalHomeRuntimeEnv({ spec, port: 43123, anonymousSignupEnabled: false });
  require(env.AUTH_ANONYMOUS_SIGNUP_ENABLED === '0', 'Signup closure was not rendered');
  require(env.HAPPIER_PUBLIC_SERVER_URL === 'http://127.0.0.1:43123', 'Canonical origin was changed');
  const layout = resolvePersonalHomeRuntimeLayout({ homeDir: '/tmp/personal-home-scenario', platform: 'linux', mode: 'user' });
  // Canonical layout-containment assertion owner; it throws when a Home path escapes the data root.
  assertLayoutPath(layout, layout.databasePath);
  assertLayoutPath(layout, layout.masterSecretPath);
}

/**
 * After an interruption, the bootstrap owner resumes from persisted facts without
 * duplicating the port fact, the signup closure, or the local account.
 */
export async function assertPersonalHomeBootstrapRecoveryContract(): Promise<void> {
  const facts = {
    signupPolicy: 'unknown' as 'unknown' | 'enabled' | 'disabled',
    persistedPort: null as number | null,
    portResolutions: 0,
    portPersistences: 0,
    accountCreations: 0,
    persistedCredentials: null as PersonalHomeAccountCredentials | null,
    receipts: [] as PersonalHomeBootstrapReceipt[],
  };
  // Receipts mutate across the two runs; read the count through a function so no
  // property narrowing is carried between the interrupted and resumed stages.
  const receiptCount = (): number => facts.receipts.length;
  const existingAccount: PersonalHomeAccountCredentials = { token: 'home-local-token', secret: 'home-local-secret' };
  let interrupted = true;
  const deps: PersonalHomeBootstrapDeps = {
    bindLoopback: async () => undefined,
    resolveNonCollidingPort: async () => { facts.portResolutions += 1; return 43110; },
    readPersistedPort: async () => facts.persistedPort,
    readPersistedPolicy: async () => facts.signupPolicy,
    ensureRuntimeStarted: async ({ spec, port, anonymousSignupEnabled }) => {
      if (facts.persistedPort == null) {
        facts.persistedPort = port;
        facts.portPersistences += 1;
      }
      require(spec.bindAddress === '127.0.0.1' && port === facts.persistedPort, 'Runtime start did not use the stable loopback origin');
      require(anonymousSignupEnabled === (facts.signupPolicy !== 'disabled'), 'Runtime start posture drifted from the persisted signup policy');
      facts.signupPolicy = anonymousSignupEnabled ? 'enabled' : 'disabled';
    },
    readPersistedCredentials: async () => facts.persistedCredentials,
    createLocalAccount: async ({ endpoint, spec }) => {
      facts.accountCreations += 1;
      require(endpoint === `http://127.0.0.1:${facts.persistedPort}`, 'Account creation did not target the canonical loopback origin');
      require(spec.purpose === 'personal-home', 'Account creation did not receive the Personal Home runtime spec');
      return existingAccount;
    },
    persistCredentials: async (credentials) => { facts.persistedCredentials = credentials; },
    verifyAuthenticatedAccess: async (credentials) => credentials === facts.persistedCredentials,
    restartHome: async () => {
      facts.signupPolicy = 'disabled';
      if (interrupted) throw new Error('simulated interruption before the managed restart completed');
    },
    readEffectivePolicy: async () => facts.signupPolicy,
    probeAnonymousSignupRefused: async () => true,
    readListenerOrigin: async () => `http://127.0.0.1:${facts.persistedPort}`,
    persistCompletionReceipt: async (receipt) => { facts.receipts.push(receipt); },
  };

  let interruption: unknown = null;
  try { await runPersonalHomeBootstrap(deps); } catch (error) { interruption = error; }
  require(interruption != null, 'Bootstrap interruption was not injected');
  require(facts.persistedPort === 43110 && facts.portPersistences === 1, 'Interrupted bootstrap did not persist its port fact');
  require(facts.signupPolicy === 'disabled', 'Interrupted bootstrap did not persist signup closure');
  require(facts.accountCreations === 1, 'Interrupted bootstrap did not create its local account');
  require(facts.persistedCredentials?.token === existingAccount.token, 'Interrupted bootstrap did not persist its local credentials');
  require(receiptCount() === 0, 'An interrupted bootstrap persisted a completion receipt');

  interrupted = false;
  const resumed = await runPersonalHomeBootstrap(deps);
  require(resumed.canonicalServerUrl === 'http://127.0.0.1:43110', 'Recovery changed the canonical origin');
  require(facts.portResolutions === 1 && facts.portPersistences === 1, 'Recovery re-derived or re-persisted the port fact');
  require(facts.accountCreations === 1, 'Recovery created a duplicate local account instead of resuming from persisted credentials');
  require(resumed.accountCreated === false, 'Recovery reported a newly created account');
  require(resumed.credentials.token === existingAccount.token && resumed.credentials.secret === existingAccount.secret, 'Recovery minted a second local account');
  require(receiptCount() === 1 && facts.receipts[0]?.canonicalServerUrl === 'http://127.0.0.1:43110' && facts.receipts[0]?.accountCreated === false, 'Recovery did not persist exactly one completion receipt for the resumed account');
  require(facts.signupPolicy === 'disabled', 'Recovery reopened the signup closure');
}

/**
 * Signup closure is persisted as AUTH_ANONYMOUS_SIGNUP_ENABLED=0, is reapplied after a
 * managed update reopens or drops it, and the exposure gate refuses non-loopback exposure while
 * the closure is unverified (unauthenticated non-loopback signup stays rejected).
 */
export async function assertPersonalHomeSignupClosureContract(): Promise<void> {
  const installed = 'HAPPIER_SERVER_HOST=127.0.0.1\nPORT=43111\nAUTH_ANONYMOUS_SIGNUP_ENABLED=1\n';
  const closed = applyAndVerifyPersonalHomeSignupClosure(installed);
  require(closed.includes(`${PERSONAL_HOME_SIGNUP_POLICY_ENV_KEY}=0`), 'Signup closure was not persisted as an env assignment');
  require(closed.includes('PORT=43111'), 'Signup closure dropped unrelated managed entries');
  require(readEffectivePersonalHomeSignupPolicy(closed) === 'disabled', 'Persisted signup closure did not read back disabled');

  const driftedByUpdate = closed.replace(`${PERSONAL_HOME_SIGNUP_POLICY_ENV_KEY}=0`, `${PERSONAL_HOME_SIGNUP_POLICY_ENV_KEY}=1`);
  const reapplied = applyAndVerifyPersonalHomeSignupClosure(driftedByUpdate);
  const assignments = reapplied.match(new RegExp(`^${PERSONAL_HOME_SIGNUP_POLICY_ENV_KEY}=(.*)$`, 'gmu')) ?? [];
  require(readEffectivePersonalHomeSignupPolicy(reapplied) === 'disabled', 'Managed update drift was not reclosed');
  require(assignments.length === 1 && assignments[0] === `${PERSONAL_HOME_SIGNUP_POLICY_ENV_KEY}=0`, 'Reapplication duplicated the signup policy assignment');

  const strippedByUpdate = closed.replace(`${PERSONAL_HOME_SIGNUP_POLICY_ENV_KEY}=0\n`, '');
  require(readEffectivePersonalHomeSignupPolicy(strippedByUpdate) === 'unknown', 'A missing policy entry did not read back unknown');
  require(applyAndVerifyPersonalHomeSignupClosure(strippedByUpdate).includes(`${PERSONAL_HOME_SIGNUP_POLICY_ENV_KEY}=0`), 'A missing policy entry was not reclosed');

  for (const unverified of [`${PERSONAL_HOME_SIGNUP_POLICY_ENV_KEY}=1\n`, 'PORT=43111\n']) {
    let rejected = false;
    try { assertPersonalHomeSignupClosed(unverified); } catch (error) { rejected = error instanceof PersonalHomeSignupClosureError; }
    require(rejected, 'Exposure gate did not refuse an unverified signup policy');
  }
}

/**
 * On a Home without public ingress, public exposure requests return the typed
 * unavailable state instead of an exposure — and never a proxy fallback. The decision is
 * capability-aware: a policy that grants the mode still succeeds.
 */
export async function assertPersonalHomeNoIngressContract(): Promise<void> {
  const modes: readonly LocalServicePublicExposureModeV1[] = ['authenticated', 'secret_link', 'public'];
  for (const requestedMode of modes) {
    const decision = resolveLocalServicePublicExposureDecision({
      policy: { enabled: false },
      requestedMode,
      requestedTtlMs: 3_600_000,
      nowMs: 1_700_000_000_000,
      previewEligible: true,
      sessionAuthorized: true,
      dnsTlsValid: true,
      rateLimitProfileId: 'profile_personal_home',
    });
    require(!decision.ok && decision.reasonCode === 'public_preview_disabled', `No-ingress ${requestedMode} exposure was not typed-unavailable`);
  }

  const capabilityMismatch = resolveLocalServicePublicExposureDecision({
    policy: { enabled: true, allowedModes: [], maxTtlMs: 3_600_000 },
    requestedMode: 'public',
    requestedTtlMs: 3_600_000,
    nowMs: 1_700_000_000_000,
    previewEligible: true,
    sessionAuthorized: true,
    dnsTlsValid: true,
    rateLimitProfileId: 'profile_personal_home',
  });
  require(!capabilityMismatch.ok && capabilityMismatch.reasonCode === 'mode_not_allowed', 'A capability-mismatched exposure request was not typed-rejected');

  const publicIngress = resolveLocalServicePublicExposureDecision({
    policy: { enabled: true, allowedModes: ['public'], maxTtlMs: 3_600_000, dnsTlsRequired: false, auditRequired: false, rateLimitProfileIds: [] },
    requestedMode: 'public',
    requestedTtlMs: 3_600_000,
    nowMs: 1_700_000_000_000,
    previewEligible: true,
    sessionAuthorized: true,
    dnsTlsValid: true,
    rateLimitProfileId: 'profile_personal_home',
  });
  require(publicIngress.ok, 'The decision owner rejected a public-ingress policy that grants the requested mode');
}

/**
 * Daemon setup failure is a typed, service-scoped failure that leaves the provisioned
 * Home (managed env, local account, transcript data) untouched, and retrying after repair
 * succeeds without recreating Home data. The composed desktop shell-usability gate is the
 * bootstrap presentation owner's release evidence and is not claimed here.
 */
export async function assertPersonalHomeDaemonSetupNonBlockingContract(): Promise<void> {
  const provisionedHome = {
    managedEnv: `${PERSONAL_HOME_SIGNUP_POLICY_ENV_KEY}=0\n`,
    accountSecret: 'home-local-secret',
    transcriptId: 'session_local_1',
  };
  const homeDataSnapshot = JSON.stringify(provisionedHome);
  const calls = { readStatus: 0, startService: 0, stopService: 0, restartService: 0 };
  const taskContext = {
    params: { target: { kind: 'local' as const } },
    emit: () => undefined,
    prompt: async () => undefined,
  };
  const absentStatus: DaemonServiceStatusSnapshot = {
    serviceInstalled: false, daemonRunning: false, needsAuth: false, machineId: null,
    daemonServerUrl: null, daemonComparableKey: null, daemonAccountId: null, daemonMachineRegistered: null,
  };
  const statusWith = (daemonRunning: boolean): DaemonServiceStatusSnapshot => ({
    serviceInstalled: true, daemonRunning, needsAuth: false, machineId: daemonRunning ? 'machine_personal_home' : null,
    daemonServerUrl: null, daemonComparableKey: null, daemonAccountId: null, daemonMachineRegistered: daemonRunning ? true : null,
  });
  const depsWith = (readStatus: DaemonServiceKindDeps['readStatus']): DaemonServiceKindDeps => ({
    readStatus: async (params) => { calls.readStatus += 1; return readStatus(params); },
    startService: async () => { calls.startService += 1; },
    stopService: async () => { calls.stopService += 1; },
    restartService: async () => { calls.restartService += 1; },
  });

  let missingFailure: unknown = null;
  try { await createDaemonServiceStartTaskKind(depsWith(async () => absentStatus)).run(taskContext); } catch (error) { missingFailure = error; }
  require(missingFailure instanceof SystemTaskExecutionError && missingFailure.code === 'daemon_service_not_installed', 'Missing daemon did not fail typed and scoped');
  require(calls.startService === 0, 'Setup attempted to start an absent daemon service');

  const readyTimeoutKey = 'HAPPIER_BOOTSTRAP_SETUP_THIS_COMPUTER_SERVICE_READY_TIMEOUT_MS';
  const readyPollKey = 'HAPPIER_BOOTSTRAP_SETUP_THIS_COMPUTER_SERVICE_READY_POLL_MS';
  const previousTimeout = process.env[readyTimeoutKey];
  const previousPoll = process.env[readyPollKey];
  process.env[readyTimeoutKey] = '100';
  process.env[readyPollKey] = '50';
  let notReadyFailure: unknown = null;
  try {
    await createDaemonServiceStartTaskKind(depsWith(async () => statusWith(false))).run(taskContext);
  } catch (error) { notReadyFailure = error; } finally {
    if (previousTimeout === undefined) delete process.env[readyTimeoutKey]; else process.env[readyTimeoutKey] = previousTimeout;
    if (previousPoll === undefined) delete process.env[readyPollKey]; else process.env[readyPollKey] = previousPoll;
  }
  require(notReadyFailure instanceof SystemTaskExecutionError && notReadyFailure.code === 'daemon_service_not_ready', 'A never-ready daemon did not fail typed and scoped');
  require(calls.stopService === 0 && calls.restartService === 0, 'Daemon setup failure disturbed unrelated services');
  require(JSON.stringify(provisionedHome) === homeDataSnapshot, 'Failed daemon setup touched Home account/env/transcript data');

  const retryResult = await createDaemonServiceStartTaskKind(depsWith(async () => statusWith(true))).run(taskContext);
  require(retryResult.serviceInstalled && retryResult.daemonRunning, 'Daemon setup retry did not report the repaired service');
  require(JSON.stringify(provisionedHome) === homeDataSnapshot, 'Daemon setup retry recreated Home account/env/transcript data');
}
