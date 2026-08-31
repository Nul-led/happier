import { IrohError, normalizeIrohNativeError } from './errors.js';
import { getOptionalHappierIrohNativeModule } from './HappierIrohNative.js';
import type {
  IrohHomeTunnelLease,
  IrohHomeTunnelRequest,
  IrohNativeAdapter,
  IrohNativeTunnelEvent,
  IrohObservedPath,
} from './types.js';

type NativeLifecycleModule = {
  ensureHomeTunnel(input: IrohHomeTunnelRequest): Promise<Omit<IrohHomeTunnelLease, 'release'>>;
  releaseHomeTunnel(leaseId: string): Promise<void>;
  getTunnelStatus?(tunnelId: string): Promise<Record<string, unknown> | null>;
};

type AdapterOptions = Readonly<{ statusPollIntervalMs?: number }>;

type NativeStatus = Readonly<{
  active: boolean;
  observedPath: IrohObservedPath;
}>;

function readObservedPath(value: unknown): IrohObservedPath {
  return value === 'direct' || value === 'relay' || value === 'unknown' ? value : 'unknown';
}

function readNativeStatus(value: Record<string, unknown>): NativeStatus {
  const connectionActive = value.connectionActive;
  const active = typeof connectionActive === 'boolean'
    ? connectionActive
    : value.active === true;
  return { active, observedPath: readObservedPath(value.observedPath) };
}

/** Lifecycle-only adapter boundary. Native implementations supply the byte carrier. */
export function createIrohNativeAdapter(native?: NativeLifecycleModule, options: AdapterOptions = {}): IrohNativeAdapter {
  const leases = new Map<string, IrohHomeTunnelLease>();
  const pollers = new Map<string, {
    listeners: Set<(event: IrohNativeTunnelEvent) => void>;
    timer: ReturnType<typeof setInterval>;
    lastStatus: NativeStatus | null;
    polling: boolean;
  }>();
  const statusPollIntervalMs = options.statusPollIntervalMs ?? 2_000;

  function stopPolling(leaseId: string): void {
    const poller = pollers.get(leaseId);
    if (!poller) return;
    clearInterval(poller.timer);
    pollers.delete(leaseId);
  }

  function emit(leaseId: string, event: IrohNativeTunnelEvent): void {
    const poller = pollers.get(leaseId);
    if (!poller) return;
    for (const listener of poller.listeners) listener(event);
  }

  async function pollStatus(leaseId: string): Promise<void> {
    const poller = pollers.get(leaseId);
    const lease = leases.get(leaseId);
    if (!poller || !lease || !native?.getTunnelStatus || poller.polling) return;
    poller.polling = true;
    try {
      const value = await native.getTunnelStatus(leaseId);
      if (!pollers.has(leaseId)) return;
      if (value === null) {
        emit(leaseId, {
          type: 'closed', tunnelHandle: leaseId, status: 'closed',
          errorCode: 'transport_closed', atMs: Date.now(),
        });
        stopPolling(leaseId);
        return;
      }
      const current = readNativeStatus(value);
      const previous = poller.lastStatus;
      if (!current.active) {
        if (previous?.active !== false) {
          emit(leaseId, {
            type: 'degraded', tunnelHandle: leaseId, status: 'degraded',
            observedPath: current.observedPath, errorCode: 'transport_closed', atMs: Date.now(),
          });
        }
      } else if (previous === null || !previous.active) {
        emit(leaseId, {
          type: 'ready', tunnelHandle: leaseId, status: 'ready',
          observedPath: current.observedPath, atMs: Date.now(),
        });
      } else if (previous.observedPath !== current.observedPath) {
        emit(leaseId, {
          type: 'path_changed', tunnelHandle: leaseId, status: 'ready',
          observedPath: current.observedPath, atMs: Date.now(),
        });
      }
      poller.lastStatus = current;
    } catch (error) {
      const normalized = normalizeIrohNativeError(error, 'unknown');
      emit(leaseId, {
        type: 'error', tunnelHandle: leaseId, status: 'error',
        errorCode: normalized.code, atMs: Date.now(),
      });
      // A failed native status boundary cannot safely certify recovery. Stop
      // this observation; the existing supervisor owns foreground/reacquire.
      stopPolling(leaseId);
    } finally {
      const current = pollers.get(leaseId);
      if (current) current.polling = false;
    }
  }

  return {
    async ensureHomeTunnel(input) {
      if (!native) throw new IrohError('unavailable', 'Native Iroh transport is unavailable.');
      let result: Omit<IrohHomeTunnelLease, 'release'>;
      try {
        result = await native.ensureHomeTunnel(input);
      } catch (error) {
        throw normalizeIrohNativeError(error, 'unknown');
      }
      // Fail closed on a stale or misrouted native result: a lease belongs to
      // exactly the Home identity and endpoint it was requested for, and must
      // never be adopted for (or published onto) a different Home.
      if (result.homeServerIdentityId !== input.homeServerIdentityId || result.homeEndpointId !== input.endpointId) {
        try {
          await native.releaseHomeTunnel(result.leaseId);
        } catch {
          // Best-effort release only; the misrouted lease is never adopted.
        }
        throw new IrohError('identity_mismatch', 'Native Iroh lease does not match the requested Home identity.');
      }
      const lease: IrohHomeTunnelLease = {
        ...result,
        release: async () => {
          stopPolling(result.leaseId);
          await native.releaseHomeTunnel(result.leaseId);
          leases.delete(result.leaseId);
        },
      };
      leases.set(lease.leaseId, lease);
      return lease;
    },
    async releaseHomeTunnel(leaseId) {
      const lease = leases.get(leaseId);
      if (lease) await lease.release();
      else if (native) await native.releaseHomeTunnel(leaseId);
    },
    subscribeEvents(leaseId, listener) {
      const lease = leases.get(leaseId);
      if (!lease || !native?.getTunnelStatus) return () => undefined;
      const existing = pollers.get(leaseId);
      if (existing) {
        existing.listeners.add(listener);
      } else {
        const listeners = new Set([listener]);
        const timer = setInterval(() => { void pollStatus(leaseId); }, statusPollIntervalMs);
        pollers.set(leaseId, { listeners, timer, lastStatus: null, polling: false });
      }
      return () => {
        const poller = pollers.get(leaseId);
        if (!poller) return;
        poller.listeners.delete(listener);
        if (poller.listeners.size === 0) stopPolling(leaseId);
      };
    },
  };
}

/** Creates the optional mobile/desktop adapter without making native presence mandatory. */
export function createOptionalIrohNativeAdapter(): IrohNativeAdapter {
  const native = getOptionalHappierIrohNativeModule();
  return createIrohNativeAdapter(native ? {
    ensureHomeTunnel: async ({ homeServerIdentityId, endpointId, policy, directAddresses, relayUrls, descriptorRevision, endpointKeyPath }) =>
      native.startHomeTunnel({
        homeServerIdentityId,
        endpointId,
        relayPolicy: policy,
        ...(directAddresses ? { directAddresses } : {}),
        ...(relayUrls ? { relayUrls } : {}),
        ...(descriptorRevision !== undefined ? { descriptorRevision } : {}),
        ...(endpointKeyPath ? { endpointKeyPath } : {}),
    }),
    releaseHomeTunnel: (leaseId) => native.stopHomeTunnel(leaseId),
    getTunnelStatus: (tunnelId) => native.getTunnelStatus(tunnelId),
  } : undefined);
}
