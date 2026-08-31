import type { IrohObservedPath } from '@happier-dev/iroh-native';

/** Native topology boundary exported only by a `test-relay-fixture` addon. */
export type IrohTestControllerNative = Readonly<{
  forceDirectOnly(): Promise<void>;
  forceRelayOnly(): Promise<void>;
  restoreAutomatic(): Promise<void>;
  getObservedPath(): IrohObservedPath;
}>;

function unavailable(): never {
  throw new Error(
    'Iroh test controller requires a native addon built with the test-relay-fixture Cargo feature',
  );
}

/**
 * Lane 06's test-only controller. It owns no path state: topology changes and
 * observed-path evidence both come from the native fixture boundary.
 */
export class IrohTestController {
  constructor(private readonly native: IrohTestControllerNative | null) {}

  async forceDirectOnly(): Promise<void> {
    if (!this.native) unavailable();
    await this.native.forceDirectOnly();
  }

  async forceRelayOnly(): Promise<void> {
    if (!this.native) unavailable();
    await this.native.forceRelayOnly();
  }

  async restoreAutomatic(): Promise<void> {
    if (!this.native) unavailable();
    await this.native.restoreAutomatic();
  }

  getObservedPath(): IrohObservedPath {
    return this.native?.getObservedPath() ?? 'unknown';
  }
}

type RawIrohTestAddon = Readonly<{
  forceDirectOnly(): Promise<string>;
  forceRelayOnly(): Promise<string>;
  restoreAutomatic(): Promise<string>;
  getObservedPath(): unknown;
}>;

function requireRawAddon(candidate: unknown): RawIrohTestAddon {
  if (typeof candidate !== 'object' || candidate === null) unavailable();
  const record = candidate as Record<string, unknown>;
  for (const operation of ['forceDirectOnly', 'forceRelayOnly', 'restoreAutomatic', 'getObservedPath']) {
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

/** Adapts the feature-built raw NAPI addon to the exact Lane 06 controller. */
export function createIrohTestControllerFromNativeAddon(candidate: unknown): IrohTestController {
  const addon = requireRawAddon(candidate);
  return new IrohTestController({
    async forceDirectOnly() { requireSuccessfulOperation(await addon.forceDirectOnly()); },
    async forceRelayOnly() { requireSuccessfulOperation(await addon.forceRelayOnly()); },
    async restoreAutomatic() { requireSuccessfulOperation(await addon.restoreAutomatic()); },
    getObservedPath() {
      const value = addon.getObservedPath();
      return value === 'direct' || value === 'relay' || value === 'unknown' ? value : 'unknown';
    },
  });
}

export function createIrohTestController(native: IrohTestControllerNative | null = null): IrohTestController {
  return new IrohTestController(native);
}
