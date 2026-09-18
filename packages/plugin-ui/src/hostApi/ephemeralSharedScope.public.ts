import type {
  PluginEphemeralSharedScope,
  PluginEphemeralSharedValueLease,
} from '@happier-dev/plugin-sdk';

/** Backward-compatible UI spelling of the canonical shared-scope capability. */
export type PluginUiEphemeralSharedScope = PluginEphemeralSharedScope;
/** Backward-compatible UI spelling of a canonical shared-value lease. */
export type PluginUiEphemeralSharedValueLease<T> = PluginEphemeralSharedValueLease<T>;
