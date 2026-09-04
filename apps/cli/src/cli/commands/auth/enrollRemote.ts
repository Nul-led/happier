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
export async function handleAuthEnrollRemote(args: string[]): Promise<void> {
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
  const rawInput = await readBoundedStdin();
  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(rawInput);
  } catch {
    throw new Error('Home target input is not valid JSON.');
  }
  const input = parseHomeTargetInput(parsedInput);
  const prepared = await prepareRemoteEnrollmentHomeTarget(input);
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const result = await runRemoteTerminalEnrollment({
      target: prepared.target,
      signal: controller.signal,
      timeoutMs,
      onPairingRequest: async (request) => {
        await writeJsonStdout({
          kind: 'remote_home_enrollment_pairing_request',
          protocolVersion: 1,
          ...request,
        });
      },
    });
    await useServerProfile(prepared.profileId);
    await writeJsonStdout({
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
