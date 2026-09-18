import {
  parseHomeTargetInput,
  type HomeTargetInput,
} from '@happier-dev/cli-common/homeTarget';

import { runRemoteTerminalEnrollment } from '@/auth/remoteTerminalEnrollment';
import { writeJsonStdout } from '@/cli/output/jsonEnvelope';
import { resolveCliHomeTarget } from '@/server/homeTarget';
import { applyResolvedServerSelectionNonFocusing } from '@/server/serverSelection';
import {
  adoptServerProfileHomeConnectionDescriptor,
  upsertServerProfileByUrl,
  useServerProfile,
} from '@/server/serverProfiles';

const MAX_HOME_TARGET_STDIN_BYTES = 64 * 1024;
const DEFAULT_REMOTE_ENROLLMENT_TIMEOUT_MS = 10 * 60_000;

type EnrollRemoteDeps = Readonly<{
  readHomeTargetInput: () => Promise<HomeTargetInput>;
  prepareHomeTarget: typeof prepareRemoteEnrollmentHomeTarget;
  runEnrollment: typeof runRemoteTerminalEnrollment;
  useHomeProfile: typeof useServerProfile;
  writeOutput: typeof writeJsonStdout;
}>;

async function readBoundedStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_HOME_TARGET_STDIN_BYTES) {
      throw new Error('Home target input exceeds the supported size.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readHomeTargetInputFromStdin(): Promise<HomeTargetInput> {
  const rawInput = await readBoundedStdin();
  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(rawInput);
  } catch {
    throw new Error('Home target input is not valid JSON.');
  }
  return parseHomeTargetInput(parsedInput);
}

function parseTimeoutMs(args: readonly string[]): number {
  const index = args.indexOf('--wait-timeout-ms');
  if (index < 0) return DEFAULT_REMOTE_ENROLLMENT_TIMEOUT_MS;
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Invalid --wait-timeout-ms value.');
  }
  return value;
}

export async function prepareRemoteEnrollmentHomeTarget(input: HomeTargetInput): Promise<Readonly<{
  profileId: string;
  target: Awaited<ReturnType<typeof resolveCliHomeTarget>>;
}>> {
  if (input.kind === 'saved_profile') {
    throw new Error('Remote enrollment input must contain a transferable Home descriptor or HTTPS URL.');
  }
  const profile = input.kind === 'descriptor'
    ? (await adoptServerProfileHomeConnectionDescriptor({
        descriptor: input.descriptor,
        suggestedName: input.descriptor.homeServerIdentityId,
        observation: 'exact',
        use: false,
      })).profile
    : await upsertServerProfileByUrl({
        name: new URL(input.url).hostname,
        serverUrl: input.url,
        ...(input.localUrl ? { localServerUrl: input.localUrl } : {}),
        webappUrl: input.webappUrl ?? new URL(input.url).origin,
        use: false,
      });
  const target = await resolveCliHomeTarget({ kind: 'saved_profile', profileRef: profile.id });
  await applyResolvedServerSelectionNonFocusing({
    homeTarget: target,
    serverUrl: profile.serverUrl,
    localServerUrl: profile.localServerUrl ?? null,
    webappUrl: profile.webappUrl,
    activeServerId: profile.id,
    application: { kind: 'useServerProfile', selector: profile.id },
  });
  return { profileId: profile.id, target };
}

/** Internal SSH automation command. Public split request/wait remains compatibility-only. */
export async function handleAuthEnrollRemote(
  args: string[],
  parentSignal?: AbortSignal,
  dependencies: Partial<EnrollRemoteDeps> = {},
): Promise<void> {
  if (!args.includes('--json-lines') || !args.includes('--home-target-stdin')) {
    throw new Error('auth enroll-remote requires --json-lines --home-target-stdin.');
  }
  const allowed = new Set(['--json-lines', '--home-target-stdin', '--wait-timeout-ms']);
  const timeoutIndex = args.indexOf('--wait-timeout-ms');
  const unexpected = args.filter((arg, index) => {
    if (index === timeoutIndex + 1) return false;
    return !allowed.has(arg);
  });
  if (unexpected.length > 0) {
    throw new Error(`Unknown auth enroll-remote arguments: ${unexpected.join(' ')}`);
  }
  const timeoutMs = parseTimeoutMs(args);
  const deps: EnrollRemoteDeps = {
    readHomeTargetInput: readHomeTargetInputFromStdin,
    prepareHomeTarget: prepareRemoteEnrollmentHomeTarget,
    runEnrollment: runRemoteTerminalEnrollment,
    useHomeProfile: useServerProfile,
    writeOutput: writeJsonStdout,
    ...dependencies,
  };
  const controller = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal;
  const onSignal = () => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    signal.throwIfAborted();
    const input = await deps.readHomeTargetInput();
    signal.throwIfAborted();
    const prepared = await deps.prepareHomeTarget(input);
    signal.throwIfAborted();
    const result = await deps.runEnrollment({
      target: prepared.target,
      signal,
      timeoutMs,
      onPairingRequest: async (request) => {
        await deps.writeOutput({
          kind: 'remote_home_enrollment_pairing_request',
          protocolVersion: 1,
          ...request,
        });
      },
    });
    signal.throwIfAborted();
    await deps.useHomeProfile(prepared.profileId);
    signal.throwIfAborted();
    await deps.writeOutput({
      kind: 'remote_home_enrollment_result',
      protocolVersion: 1,
      ...result,
      remoteProfileId: prepared.profileId,
    });
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}
