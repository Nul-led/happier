import {
  openEncryptedDataKeyEnvelopeV1,
  resolvePublishedMachineDataEncryptionKeyV1,
} from '@happier-dev/protocol';
import {
  ExternalActionMachineBootstrapListV1Schema,
  type ExternalActionMachineBootstrapV1,
} from '@happier-dev/protocol/actions';
import { decodeBase64, encodeBase64 } from '@happier-dev/protocol/crypto/base64';

import { HappierTransportError } from './errors.js';

export type HappierMachine = Readonly<{
  id: string;
  kind: 'persistent' | 'ephemeral_session_runner';
  active: boolean;
  revokedAt: number | null;
  replacedByMachineId: string | null;
}>;

export type MachineListOptions = Readonly<{
  signal?: AbortSignal;
}>;

/** Account E2EE material, and the Machine content key a Runner target needs. */
export type ProtectedActionMaterial = Readonly<{ type: 'dataKey'; machineKey: Uint8Array }>;

export function parseMachineBootstrapRows(
  value: unknown,
): readonly ExternalActionMachineBootstrapV1[] {
  const parsed = ExternalActionMachineBootstrapListV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new HappierTransportError('The Happier machine API returned an invalid response.');
  }
  return parsed.data;
}

export function parseMachineListResponse(value: unknown): readonly HappierMachine[] {
  return Object.freeze(parseMachineBootstrapRows(value).map((row) => Object.freeze({
    id: row.id,
    kind: row.kind,
    active: row.active,
    revokedAt: row.revokedAt,
    replacedByMachineId: row.replacedByMachineId,
  })));
}

export type MachineProtectedActionMaterialResolution =
  /** Not a restricted Runner: the released Account-material sealing applies. */
  | Readonly<{ kind: 'account' }>
  | Readonly<{ kind: 'runner'; material: ProtectedActionMaterial }>
  | Readonly<{ kind: 'unavailable' }>;

function openPublishedRunnerEnvelope(
  published: string,
  accountContentSecret: Uint8Array,
): Uint8Array | null {
  try {
    const envelope = decodeBase64(published);
    if (encodeBase64(envelope) !== published) return null;
    return openEncryptedDataKeyEnvelopeV1({
      envelope,
      recipientSecretKeyOrSeed: accountContentSecret,
    });
  } catch {
    return null;
  }
}

/**
 * Decides what a protected Action targeting this exact Machine seals against.
 *
 * A restricted Runner holds no Account material by contract, so a request
 * sealed with the Account key is unreadable there. Its own Machine content key
 * is published as an Account-sealed envelope authenticated by the creator's
 * strict binding; this resolves that key through the one canonical Machine
 * content-key owner, with the Home, creator Account and exact Machine supplied
 * from the credential's locally pinned scope rather than from the row. Any
 * mismatch — substituted binding, verifier fact, envelope or Machine — resolves
 * `unavailable`, and the caller fails closed instead of falling back to the
 * Account key or to plaintext.
 */
export function resolveMachineProtectedActionMaterial(params: Readonly<{
  rows: readonly ExternalActionMachineBootstrapV1[];
  machineId: string;
  homeServerIdentityId: string;
  accountId: string;
  accountMaterial: ProtectedActionMaterial;
}>): MachineProtectedActionMaterialResolution {
  const row = params.rows.find((candidate) => candidate.id === params.machineId);
  if (!row || row.kind !== 'ephemeral_session_runner') return { kind: 'account' };
  const openedDataEncryptionKey = typeof row.dataEncryptionKey === 'string'
    ? openPublishedRunnerEnvelope(row.dataEncryptionKey, params.accountMaterial.machineKey)
    : null;
  const resolution = resolvePublishedMachineDataEncryptionKeyV1({
    machine: {
      id: row.id,
      kind: row.kind,
      installationId: row.installationId,
      dataEncryptionKey: row.dataEncryptionKey,
      runnerContentKeyBinding: row.runnerContentKeyBinding,
    },
    openedDataEncryptionKey,
    expectedAccountMode: 'e2ee',
    expectedRunnerBinding: {
      homeServerIdentityId: params.homeServerIdentityId,
      creatorAccountId: params.accountId,
      machineId: params.machineId,
      accountScopedMaterial: params.accountMaterial,
    },
  });
  return resolution.status === 'e2ee'
    ? { kind: 'runner', material: { type: 'dataKey', machineKey: resolution.dataKey } }
    : { kind: 'unavailable' };
}
