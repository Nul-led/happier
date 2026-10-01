import type {
  TerminalHostAdapter,
  TerminalHostKind,
  TerminalHostPreference,
} from '@happier-dev/agents';
import type { AgentTerminalHostResolutionReason } from '@happier-dev/plugin-sdk/agents/runtime';

export type {
  TerminalHostAdapter,
  TerminalHostAttachMetadata,
  TerminalHostHandle,
  TerminalHostKind,
  TerminalHostPreference,
  TerminalInputState,
} from '@happier-dev/agents';

export type TerminalHostResolverPlatform = Readonly<{
  os: NodeJS.Platform;
  arch: NodeJS.Architecture;
}>;

export type TerminalHostResolutionReason = AgentTerminalHostResolutionReason;

export type TerminalHostResolution =
  | Readonly<{
      status: 'resolved';
      adapter: TerminalHostAdapter;
      reason: TerminalHostResolutionReason;
    }>
  | Readonly<{
      status: 'disabled';
      reason: TerminalHostResolutionReason;
      message: string;
    }>;

export type ResolveTerminalHostParams = Readonly<{
  preference: TerminalHostPreference;
  platform: TerminalHostResolverPlatform;
  adapters: Readonly<Partial<Record<TerminalHostKind, TerminalHostAdapter>>>;
  tmuxAvailable: boolean;
  zellijAvailable: boolean;
}>;
