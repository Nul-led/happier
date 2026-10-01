import type {
  SessionHandoffAgentBundleTransferPublication as ProtocolSessionHandoffAgentBundleTransferPublication,
} from '@happier-dev/protocol';

export type SessionHandoffAgentBundleTransferPublication =
  ProtocolSessionHandoffAgentBundleTransferPublication;

const SESSION_HANDOFF_PROVIDER_BUNDLE_TRANSFER_ID_SUFFIX = ':provider-bundle-file';

export function buildSessionHandoffAgentBundleTransferId(handoffId: string): string {
  return `session-handoff:${handoffId}${SESSION_HANDOFF_PROVIDER_BUNDLE_TRANSFER_ID_SUFFIX}`;
}

export function parseSessionHandoffAgentBundleTransferId(
  transferId: string,
): Readonly<{ handoffId: string }> | null {
  if (!transferId.startsWith('session-handoff:') || !transferId.endsWith(SESSION_HANDOFF_PROVIDER_BUNDLE_TRANSFER_ID_SUFFIX)) {
    return null;
  }

  const handoffId = transferId.slice(
    'session-handoff:'.length,
    transferId.length - SESSION_HANDOFF_PROVIDER_BUNDLE_TRANSFER_ID_SUFFIX.length,
  ).trim();
  return handoffId.length > 0 ? { handoffId } : null;
}

export function buildSessionHandoffWorkspaceSeedTransferId(handoffId: string): string {
  return `session-handoff:${handoffId}:workspace-seed`;
}

export function parseSessionHandoffWorkspaceSeedTransferId(transferId: string): Readonly<{ handoffId: string }> | null {
  const match = /^session-handoff:([A-Za-z0-9._-]+):workspace-seed(?::blob:[a-f0-9]{64})?$/u.exec(transferId);
  return match ? { handoffId: match[1] } : null;
}
