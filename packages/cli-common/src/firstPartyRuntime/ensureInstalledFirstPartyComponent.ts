import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import type { FirstPartyComponentId } from './componentCatalog.js';
import { installVersionedPayload } from './installVersionedPayload.js';
import { resolveFirstPartyVersionInstallPath } from './installLayout.js';
import { prepareFirstPartyComponentPayloadFromGitHubRelease } from './prepareFirstPartyComponentPayloadFromGitHubRelease.js';
import {
  resolveInstalledFirstPartyComponentPaths,
  type InstalledFirstPartyComponentPaths,
} from './resolveInstalledComponentPaths.js';

type EnsureInstalledFirstPartyComponentDependencies = Readonly<{
  preparePayload: typeof prepareFirstPartyComponentPayloadFromGitHubRelease;
  installPayload: typeof installVersionedPayload;
  resolveInstalled: typeof resolveInstalledFirstPartyComponentPaths;
}>;

const pendingInstalls = new Map<string, Promise<void>>();

/**
 * Canonical acquisition path for an internal first-party component payload.
 * Callers provide the immutable desired version and an owner-specific payload
 * validator; concurrent callers share one download/install attempt.
 */
export async function ensureInstalledFirstPartyComponent(params: Readonly<{
  componentId: FirstPartyComponentId;
  channel: PublicReleaseRingId;
  versionId: string;
  exactVersion?: boolean;
  processEnv?: NodeJS.ProcessEnv;
  validatePayload(payloadRoot: string): unknown;
}>, overrides: Partial<EnsureInstalledFirstPartyComponentDependencies> = {}): Promise<InstalledFirstPartyComponentPaths> {
  const deps: EnsureInstalledFirstPartyComponentDependencies = {
    preparePayload: prepareFirstPartyComponentPayloadFromGitHubRelease,
    installPayload: installVersionedPayload,
    resolveInstalled: resolveInstalledFirstPartyComponentPaths,
    ...overrides,
  };
  const resolveAndValidate = async (): Promise<InstalledFirstPartyComponentPaths> => {
    const installed = deps.resolveInstalled({
      componentId: params.componentId,
      releaseRing: params.channel,
      processEnv: params.processEnv,
    });
    const payloadRoot = params.exactVersion
      ? resolveFirstPartyVersionInstallPath(params)
      : installed.resolvedCurrentPath ?? installed.currentPath;
    await params.validatePayload(payloadRoot);
    return installed;
  };

  try {
    return await resolveAndValidate();
  } catch {
    // The desired immutable version below owns recovery from missing, stale,
    // or invalid current payloads.
  }

  const firstPaths = deps.resolveInstalled({
    componentId: params.componentId,
    releaseRing: params.channel,
    processEnv: params.processEnv,
  });
  const key = `${firstPaths.installRoot}\0${params.componentId}\0${params.channel}\0${params.versionId}`;
  let pending = pendingInstalls.get(key);
  if (!pending) {
    pending = (async () => {
      const prepared = await deps.preparePayload({
        componentId: params.componentId,
        channel: params.channel,
        ...(params.exactVersion ? { versionId: params.versionId } : {}),
        ...(params.componentId === 'mutagen-engine' ? { engineVersion: params.versionId } : {}),
      });
      try {
        if (prepared.versionId !== params.versionId) {
          throw new Error(
            `Prepared ${params.componentId} payload version '${prepared.versionId}' does not match requested immutable version '${params.versionId}'.`,
          );
        }
        await params.validatePayload(prepared.payloadRoot);
        await deps.installPayload({
          componentId: params.componentId,
          releaseRing: params.channel,
          processEnv: params.processEnv,
          versionId: prepared.versionId,
          payloadRoot: prepared.payloadRoot,
        });
      } finally {
        await prepared.cleanup();
      }
    })();
    pendingInstalls.set(key, pending);
    void pending.finally(() => {
      if (pendingInstalls.get(key) === pending) pendingInstalls.delete(key);
    }).catch(() => undefined);
  }
  await pending;
  return await resolveAndValidate();
}
