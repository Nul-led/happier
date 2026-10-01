/**
 * Test-only controller adapter for the `test-relay-fixture` NAPI addon build.
 *
 * This is the single adapter between the raw feature-built addon surface and
 * Lane 06's typed test controller. The package owns both sides: the raw addon
 * exports (`rust/happier-iroh-node`) and this adaptation, so every fixture —
 * server, CLI, UI, and the composed tests workspace — consumes the same typed
 * boundary instead of restating the raw interface. It is exported only through
 * the `./test-controller` subpath and is never reachable from the production
 * `.` or `./node` surfaces.
 *
 * The controller owns no path or relay state: topology changes, observed-path
 * evidence, and the shared `LocalTestRelay` lifetime all come from the native
 * fixture boundary in this same package.
 */
import type { IrohObservedPath } from './types.js';

/** Native topology boundary exported only by a `test-relay-fixture` addon. */
export type IrohTestControllerNative = Readonly<{
  forceDirectOnly(): Promise<void>;
  forceRelayOnly(relayUrl?: string): Promise<void>;
  restoreAutomatic(): Promise<void>;
  getObservedPath(): IrohObservedPath;
  /**
   * The shared stock test relay URL while — and only while — forced relay is
   * active; `null` under automatic or direct-only topology.
   */
  getTestRelayUrl(): string | null;
}>;

function unavailable(): never {
  throw new Error(
    'Iroh test controller requires a native addon built with the test-relay-fixture Cargo feature',
  );
}

export class IrohTestController {
  constructor(private readonly native: IrohTestControllerNative | null) {}

  async forceDirectOnly(): Promise<void> {
    if (!this.native) unavailable();
    await this.native.forceDirectOnly();
  }

  async forceRelayOnly(relayUrl?: string): Promise<void> {
    if (!this.native) unavailable();
    await this.native.forceRelayOnly(relayUrl);
  }

  async restoreAutomatic(): Promise<void> {
    if (!this.native) unavailable();
    await this.native.restoreAutomatic();
  }

  getObservedPath(): IrohObservedPath {
    return this.native?.getObservedPath() ?? 'unknown';
  }

  getTestRelayUrl(): string | null {
    return this.native?.getTestRelayUrl() ?? null;
  }
}

type RawIrohTestAddon = Readonly<{
  forceDirectOnly(): Promise<string>;
  forceRelayOnly(relayUrl?: string): Promise<string>;
  restoreAutomatic(): Promise<string>;
  getObservedPath(): unknown;
  getTestRelayUrl(): unknown;
}>;

function requireRawAddon(candidate: unknown): RawIrohTestAddon {
  if (typeof candidate !== 'object' || candidate === null) unavailable();
  const record = candidate as Record<string, unknown>;
  for (const operation of [
    'forceDirectOnly',
    'forceRelayOnly',
    'restoreAutomatic',
    'getObservedPath',
    'getTestRelayUrl',
  ]) {
    if (typeof record[operation] !== 'function') unavailable();
  }
  return candidate as RawIrohTestAddon;
}

function requireSuccessfulOperation(raw: string): void {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error('Iroh native test controller returned a non-JSON response');
  }
  if (typeof envelope !== 'object' || envelope === null || (envelope as { ok?: unknown }).ok !== true) {
    const error = (envelope as { error?: { message?: unknown } } | null)?.error;
    throw new Error(
      typeof error?.message === 'string'
        ? error.message
        : 'Iroh native test controller operation failed',
    );
  }
}

function requireRelayUrl(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Adapts the feature-built raw NAPI addon to the exact Lane 06 controller. */
export function createIrohTestControllerFromNativeAddon(candidate: unknown): IrohTestController {
  const addon = requireRawAddon(candidate);
  return new IrohTestController({
    async forceDirectOnly() { requireSuccessfulOperation(await addon.forceDirectOnly()); },
    async forceRelayOnly(relayUrl?: string) { requireSuccessfulOperation(await addon.forceRelayOnly(relayUrl)); },
    async restoreAutomatic() { requireSuccessfulOperation(await addon.restoreAutomatic()); },
    getObservedPath() {
      const value = addon.getObservedPath();
      return value === 'direct' || value === 'relay' || value === 'unknown' ? value : 'unknown';
    },
    getTestRelayUrl() {
      return requireRelayUrl(addon.getTestRelayUrl());
    },
  });
}

export function createIrohTestController(native: IrohTestControllerNative | null = null): IrohTestController {
  return new IrohTestController(native);
}
