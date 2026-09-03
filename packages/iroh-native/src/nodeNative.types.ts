/**
 * Node/Bun lifecycle binding contracts over the `happier-iroh-native` JSON C
 * ABI. Lifecycle/status only: requests and responses are validated JSON
 * envelopes; tunnel payload bytes never cross this boundary and there is no
 * generic dispatch operation — one typed function per C ABI export.
 */
import type { NativeIrohModule } from './HappierIrohNative.types.js';
import type { IrohObservedPath, IrohRelayPolicy } from './types.js';

/** Fixed machine-carrier admission/framing metadata shared with daemon composition. */
export const IROH_MACHINE_ADMISSION_PATH = '/v1/iroh/machine/admit' as const;
export const IROH_MACHINE_REMOTE_ENDPOINT_HEADER = 'X-Happier-Iroh-Remote-Endpoint-Id' as const;
/**
 * Header of the trusted local admission response that selects the application
 * loopback port for one authenticated machine stream. Only the locally trusted
 * admission owner may select a destination; the peer can never supply one.
 */
export const IROH_MACHINE_APPLICATION_PORT_HEADER = 'X-Happier-Iroh-Application-Port' as const;
export const IROH_MACHINE_APPLICATION_CAPABILITY_HEADER = 'X-Happier-Iroh-Application-Capability' as const;
export const IROH_MACHINE_STREAM_ACCEPT_BYTE = 0x01 as const;
export const IROH_MACHINE_STREAM_REJECT_BYTE = 0x00 as const;

/** Cap profile ids accepted by the C ABI (`IrohCapProfile`). */
export type IrohNodeCapProfile = 'homeInteractive' | 'machineBulk';

/** Every export the Node/Bun addon must expose (the exact no-payload allowlist). */
export const IROH_NODE_NATIVE_EXPORTS = [
  'getAvailability',
  'createEndpoint',
  'startHomeAcceptor',
  'stopHomeAcceptor',
  'ensureHomeTunnel',
  'releaseHomeTunnel',
  'shutdownEndpoint',
  'getEndpointStatus',
  'getTunnelStatus',
  'startMachineAcceptor',
  'stopMachineAcceptor',
  'getMachineAcceptorStatus',
  'startMachineTunnel',
  'startMachineHttpTunnel',
  'stopMachineTunnel',
  'getMachineTunnelStatus',
] as const;

export type IrohNodeNativeExportName = (typeof IROH_NODE_NATIVE_EXPORTS)[number];

/** Availability/status metadata reported by the addon (`getAvailability`). */
export type IrohNodeAvailability = Readonly<{
  available: boolean;
  os: string;
  arch: string;
  engine: string;
  surface: readonly string[];
}>;

/** Raw `.node` addon surface: one JSON-string request per C ABI operation. */
export type IrohNodeNativeAddon = Readonly<{
  getAvailability: () => IrohNodeAvailability;
}> & {
  [Name in Exclude<IrohNodeNativeExportName, 'getAvailability'>]: (
    request: string,
  ) => Promise<string>;
};

export type IrohNodeCreateEndpointRequest = Readonly<{
  keyPath?: string;
  relayPolicy?: IrohRelayPolicy;
  relayUrls?: readonly string[];
  capProfile?: IrohNodeCapProfile;
}>;

export type IrohNodeStartHomeAcceptorRequest = Readonly<{
  endpointHandle: string;
  targetHost?: string;
  targetPort: number;
}>;

export type IrohNodeEndpointHandleRequest = Readonly<{ endpointHandle: string }>;

/**
 * The acceptor owns only its fixed local admission target: the application
 * host is hard-coded loopback in Rust and the per-stream application port is
 * selected by the trusted local admission response, never by an input.
 */
export type IrohNodeStartMachineAcceptorRequest = Readonly<{
  endpointHandle: string;
  admissionHost?: string;
  admissionPort: number;
}>;

export type IrohNodeStartMachineTunnelRequest = Readonly<{
  endpointHandle: string;
  endpointId: string;
  directAddresses?: readonly string[];
  relayUrls?: readonly string[];
  handshakeJson: string;
  capProfile?: Extract<IrohNodeCapProfile, 'machineBulk'>;
}>;

export type IrohNodeEnsureHomeTunnelRequest = Readonly<{
  endpointHandle: string;
  homeServerIdentityId: string;
  endpointId: string;
  directAddresses?: readonly string[];
  relayUrls?: readonly string[];
  descriptorRevision?: number;
}>;

/**
 * Legacy mobile trio start request. Mirrors the shared `NativeIrohModule`
 * request shape exactly (including `capProfile?: string`) so the Node module
 * stays structurally assignable to that shared surface.
 */
/** Status object of a running Home acceptor (`HomeAcceptorStatus`). */
export type IrohNodeAcceptorStatus = Readonly<{
  running: boolean;
  connectionsAccepted: number;
  connectionsActive: number;
  streamsAccepted: number;
  streamsRejected: number;
  lastPath: Readonly<{
    observedPath: IrohObservedPath;
    isRelay: boolean;
    remoteEndpointId: string;
    atMs: number;
  }> | null;
  /** Machine acceptors populate this with the last rejected stream category. */
  lastErrorCode?: IrohNodeMachineFailureCode | null;
}>;

export type IrohNodeMachineFailureCode =
  | 'invalid-preamble'
  | 'machine-control-invalid'
  | 'machine-admission-rejected'
  | 'endpoint-identity-mismatch'
  | 'transport-unavailable';

export type IrohNodeAcceptorStarted = Readonly<{
  endpointHandle: string;
  reused: boolean;
  status: IrohNodeAcceptorStatus;
}>;

export type IrohNodeMachineTunnelStarted = Readonly<{
  machineTunnelId: string;
  endpointHandle: string;
  localPort: number;
  /** Per-listener local capability consumed natively before application bytes. */
  localCapability: string;
  connectionActive: boolean;
  /** Normalized authenticated remote endpoint identity this tunnel dials. */
  remoteEndpointId: string;
  observedPath: IrohObservedPath;
  startedAtMs: number;
  lastErrorCode: IrohNodeMachineFailureCode | null;
}>;

export type IrohNodeMachineHttpTunnelStarted = IrohNodeMachineTunnelStarted;

export type IrohNodeMachineTunnelStatus = Readonly<{
  machineTunnelId: string;
  endpointHandle: string;
  localPort: number;
  connectionActive: boolean;
  remoteEndpointId: string;
  observedPath: IrohObservedPath;
  startedAtMs: number;
  lastErrorCode: IrohNodeMachineFailureCode | null;
  streamsOpened: number;
}>;

export type IrohNodeEndpointCreated = Readonly<{
  endpointHandle: string;
  endpointId: string;
  relayPolicy: 'automatic' | 'disabled';
  relayMode: 'disabled' | 'custom';
  /** Incoming-service default; outgoing connections apply their own profile. */
  capProfile: string;
  relayUrls: readonly string[];
}>;

export type IrohNodeEndpointStatus = Readonly<{
  endpointHandle: string;
  endpointId: string;
  relayPolicy: 'automatic' | 'disabled';
  relayMode: string;
  relayUrls: readonly string[];
  /** Incoming-service default; outgoing connections apply their own profile. */
  capProfile: string;
  directAddresses: readonly string[];
  active: boolean;
}>;

export type IrohNodeTunnelStarted = Readonly<{
  tunnelId: string;
  homeServerIdentityId: string;
  homeEndpointId: string;
  runtimeOrigin: string;
  carrier: 'iroh';
  observedPath: IrohObservedPath;
  startedAtMs: number;
  descriptorRevision: number | null;
  endpointHandle: string;
}>;

export type IrohNodeTunnelStatus = Readonly<{
  tunnelId: string;
  homeServerIdentityId: string;
  runtimeOrigin: string;
  carrier: 'iroh';
  observedPath: IrohObservedPath;
  connectionActive: boolean;
  streamsOpened: number;
  startedAtMs: number;
  descriptorRevision: number | null;
  endpointHandle: string;
}>;

/**
 * Typed async lifecycle surface exposed to Node/Bun callers. Structurally
 * assignable to the shared `NativeIrohModule` (see
 * `NodeIrohNativeModuleSatisfiesSharedSurface`), so server composition can
 * reuse the mobile seam owners unchanged.
 */
export type NodeIrohNativeModule = Readonly<{
  getAvailability: () => IrohNodeAvailability;
  createEndpoint: (request: IrohNodeCreateEndpointRequest) => Promise<IrohNodeEndpointCreated>;
  startHomeAcceptor: (request: IrohNodeStartHomeAcceptorRequest) => Promise<IrohNodeAcceptorStarted>;
  stopHomeAcceptor: (request: IrohNodeEndpointHandleRequest) => Promise<void>;
  ensureHomeTunnel: (request: IrohNodeEnsureHomeTunnelRequest) => Promise<IrohNodeTunnelStarted>;
  releaseHomeTunnel: (tunnelId: string) => Promise<void>;
  shutdownEndpoint: (request: IrohNodeEndpointHandleRequest) => Promise<void>;
  getEndpointStatus: (endpointHandle: string) => Promise<IrohNodeEndpointStatus | null>;
  getTunnelStatus: (tunnelId: string) => Promise<IrohNodeTunnelStatus | null>;
  startMachineAcceptor: (request: IrohNodeStartMachineAcceptorRequest) => Promise<IrohNodeAcceptorStarted>;
  stopMachineAcceptor: (request: IrohNodeEndpointHandleRequest) => Promise<void>;
  getMachineAcceptorStatus: (endpointHandle: string) => Promise<IrohNodeAcceptorStatus | null>;
  startMachineTunnel: (request: IrohNodeStartMachineTunnelRequest) => Promise<IrohNodeMachineTunnelStarted>;
  startMachineHttpTunnel: (request: IrohNodeStartMachineTunnelRequest) => Promise<IrohNodeMachineHttpTunnelStarted>;
  stopMachineTunnel: (machineTunnelId: string) => Promise<void>;
  getMachineTunnelStatus: (machineTunnelId: string) => Promise<IrohNodeMachineTunnelStatus | null>;
}>;

/**
 * Compile-time proof that the Node module satisfies the shared native module
 * surface used by the mobile/desktop adapter owners.
 */
export type NodeIrohNativeModuleSatisfiesSharedSurface =
  NodeIrohNativeModule extends NativeIrohModule ? true : never;

/**
 * Typed loader outcome: `native_unavailable` when no target addon exists —
 * never a silent fallback to an unrelated binary.
 */
export type LoadIrohNodeNativeResult = Readonly<
  | { available: true; native: NodeIrohNativeModule; addonPath: string }
  | {
      available: false;
      reason: 'native_unavailable';
      message: string;
      addonPath: string | null;
    }
>;
