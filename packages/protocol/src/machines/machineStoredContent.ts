import { z } from 'zod';

import type { AccountScopedCryptoMaterial } from '../crypto/accountScopedCipher.js';
import { decodeBase64, encodeBase64 } from '../crypto/base64.js';
import {
  computeRunnerMachineContentKeyFingerprintV1,
  openRunnerMachineContentKeyVerifierFactV1,
  readRunnerMachineContentKeyBindingSignedPayloadV1,
  RunnerMachineContentKeyBindingV1Schema,
  verifyRunnerMachineContentKeyBindingV1,
} from '../ephemeralRunner/machineContentKeyBinding.js';
import { RunnerClaimV1Schema, verifyRunnerClaimV1 } from '../ephemeralRunner/endpoint.js';
import { MachineKindFromLegacyProjectionSchema } from './machineKind.js';

const MachinePlainStoredContentEnvelopeSchema = z.object({
  t: z.literal('plain'),
  v: z.json(),
}).strict();

function encodeMachinePlainEnvelope(value: unknown): string {
  let envelope: ReturnType<typeof MachinePlainStoredContentEnvelopeSchema.safeParse>;
  try {
    envelope = MachinePlainStoredContentEnvelopeSchema.safeParse(
      JSON.parse(JSON.stringify({ t: 'plain', v: value })),
    );
  } catch {
    throw new Error('Invalid plaintext machine content');
  }
  if (!envelope.success) {
    throw new Error('Invalid plaintext machine content');
  }
  return encodeBase64(
    new TextEncoder().encode(JSON.stringify(envelope.data)),
    'base64',
  );
}

function parseMachinePlainEnvelopeBytes(value: Uint8Array): z.infer<
  typeof MachinePlainStoredContentEnvelopeSchema
> | null {
  try {
    const parsed = MachinePlainStoredContentEnvelopeSchema.safeParse(
      JSON.parse(new TextDecoder().decode(value)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseEncodedMachinePlainEnvelope(value: string): z.infer<
  typeof MachinePlainStoredContentEnvelopeSchema
> | null {
  try {
    return parseMachinePlainEnvelopeBytes(decodeBase64(value, 'base64'));
  } catch {
    return null;
  }
}

export const MACHINE_PLAIN_DATA_KEY_MARKER = encodeMachinePlainEnvelope(null);

export function isPlainMachineDataKeyMarker(
  value: string | Uint8Array | null | undefined,
): boolean {
  const envelope = typeof value === 'string'
    ? parseEncodedMachinePlainEnvelope(value)
    : value instanceof Uint8Array
      ? parseMachinePlainEnvelopeBytes(value)
      : null;
  return envelope?.v === null;
}

export function encodePlainMachineStoredContent(value: unknown): string {
  return encodeMachinePlainEnvelope(value);
}

function isPlainMachineStoredContent(value: unknown): boolean {
  return typeof value === 'string' && parseEncodedMachinePlainEnvelope(value) !== null;
}

export function decodePlainMachineStoredContent(value: string): unknown {
  const envelope = parseEncodedMachinePlainEnvelope(value);
  if (!envelope) {
    throw new Error('Invalid plaintext machine content');
  }
  return envelope.v;
}

export function machineStoredContentMatchesAccountMode(params: Readonly<{
  mode: 'plain' | 'e2ee';
  metadata: string;
  daemonState?: string;
  dataEncryptionKey?: string | Uint8Array | null;
}>): boolean {
  const hasPlainMarker = isPlainMachineDataKeyMarker(params.dataEncryptionKey);
  if (params.mode === 'plain') {
    return (
      hasPlainMarker
      && isPlainMachineStoredContent(params.metadata)
      && (
        params.daemonState === undefined
        || isPlainMachineStoredContent(params.daemonState)
      )
    );
  }
  return (
    !hasPlainMarker
    && !isPlainMachineStoredContent(params.metadata)
    && (
      params.daemonState === undefined
      || !isPlainMachineStoredContent(params.daemonState)
    )
  );
}

export function machineUpdateMatchesStoredMode(params: Readonly<{
  dataEncryptionKey?: string | Uint8Array | null;
  metadata?: string;
  daemonState?: string;
}>): boolean {
  const plain = isPlainMachineDataKeyMarker(params.dataEncryptionKey);
  if (plain) {
    return (
      (params.metadata === undefined || isPlainMachineStoredContent(params.metadata))
      && (params.daemonState === undefined || isPlainMachineStoredContent(params.daemonState))
    );
  }
  return (
    (params.metadata === undefined || !isPlainMachineStoredContent(params.metadata))
    && (params.daemonState === undefined || !isPlainMachineStoredContent(params.daemonState))
  );
}

export type PublishedMachineDataEncryptionKeyV1 = Readonly<{
  id: string;
  kind?: 'persistent' | 'ephemeral_session_runner';
  installationId?: string | null;
  dataEncryptionKey?: unknown;
  runnerContentKeyBinding?: unknown;
  /**
   * Runner only; the activation-signed `RunnerClaimV1` persisted when the
   * endpoint claimed this Machine. Consulted only when the caller selected the
   * Runner by Session (`ExpectedRunnerMachineContentKeyBindingV1.sessionId`).
   */
  runnerClaim?: unknown;
}>;

export type PublishedMachineDataEncryptionKeyResolutionV1 =
  | Readonly<{ status: 'plain' }>
  | Readonly<{ status: 'legacy' }>
  | Readonly<{ status: 'e2ee'; dataKey: Uint8Array }>
  | Readonly<{ status: 'unavailable' }>;

export type ExpectedRunnerMachineContentKeyBindingV1 = Readonly<{
  /** Independently trusted Home identity; never accepted from the Home-published binding. */
  homeServerIdentityId: string;
  /** Independently trusted Account identity; never accepted from the Home-published binding. */
  creatorAccountId: string;
  /** Exact Machine selected by the caller; never accepted from the Home-published binding. */
  machineId: string;
  /**
   * Creator-device custody verifier. Present only on the creating device; a
   * Home-published Machine field is never accepted here.
   */
  accountSigningPublicKeyBase64Url?: string;
  /**
   * Account E2EE material of the reading device. Any authorized device of the
   * creator Account uses it to open the creator-sealed verifier fact carried by
   * the binding, which is how a non-creating device or daemon reaches the same
   * verifier identity. The Home holds no such material and cannot forge one.
   */
  accountScopedMaterial?: AccountScopedCryptoMaterial;
  /**
   * Exact Session the caller targets when it selected this Machine by Session.
   * The Machine-key binding does not sign a Session, so an authentic Runner key
   * is not by itself proof that this Runner holds that Session; when present,
   * the key is accepted only if the Runner's activation-signed claim — verified
   * under the same trusted activation identity that authenticates the binding —
   * names this exact Session, Machine and activation.
   */
  sessionId?: string;
}>;

/**
 * Proves a Home-selected Runner is the one activated for `expected.sessionId`.
 *
 * The claim is signed by the activation identity the caller already trusts
 * independently of the Home (creator custody or the Account-sealed verifier
 * fact), carries no credential, and binds activation, Session, Machine and the
 * winning installation together. Everything it names must equal the verified
 * Machine-key binding and the caller's own scope; the Home only relays it.
 */
function runnerClaimCorrespondsV1(params: Readonly<{
  claim: unknown;
  sessionId: string;
  activationId: string;
  installationId: string;
  activationSigningPublicKey: string;
  expected: ExpectedRunnerMachineContentKeyBindingV1;
}>): boolean {
  const parsed = RunnerClaimV1Schema.safeParse(params.claim);
  if (!parsed.success) return false;
  const claimed = parsed.data.payload.binding;
  if (
    claimed.sessionId !== params.sessionId
    || claimed.activationId !== params.activationId
    || claimed.machineId !== params.expected.machineId
    || claimed.homeServerIdentityId !== params.expected.homeServerIdentityId
    || claimed.creatorAccountId !== params.expected.creatorAccountId
    || claimed.activationSigningPublicKey !== params.activationSigningPublicKey
    || parsed.data.payload.installation.installationId !== params.installationId
  ) return false;
  return verifyRunnerClaimV1({ claim: parsed.data, expectedBinding: claimed }) !== null;
}

/**
 * The single post-envelope-open decision for published Machine content keys.
 *
 * Persistent Machines retain the released absent-envelope Account-key fallback.
 * A Runner never does: its opened key is usable only when a creator signing
 * identity the reader trusts independently of the Home authenticates the strict
 * binding. That identity is the creating device's own custody record, or — for
 * any other authorized device of the same Account — the creator-sealed verifier
 * fact opened with Account material the Home never holds. Home, creator, and
 * exact Machine come from caller scope; activation and installation are
 * accepted only as signed values, with installation also matching the row.
 *
 * Which branch a row takes is therefore never decided by the Home's own `kind`
 * alone: a caller that already knows this exact Machine is a Runner says so,
 * and the creator binding the Home only ever receives at Runner materialization
 * classifies the row by itself. Either fact makes the persistent fallback
 * unreachable, so relabelling a Runner `persistent` — or omitting the kind —
 * fails closed instead of disclosing a Home-chosen key.
 */
export function resolvePublishedMachineDataEncryptionKeyV1(params: Readonly<{
  machine: PublishedMachineDataEncryptionKeyV1;
  openedDataEncryptionKey: Uint8Array | null;
  expectedRunnerBinding?: ExpectedRunnerMachineContentKeyBindingV1;
  /** Trusted Account mode. A Home-published plain marker cannot decide it. */
  expectedAccountMode?: 'plain' | 'e2ee';
  /**
   * Classification the caller established independently of this response —
   * creator-device custody, or the pins its own credential carries. Only the
   * Runner direction is assertable: nothing trusts "this is persistent".
   */
  trustedMachineKind?: 'ephemeral_session_runner';
}>): PublishedMachineDataEncryptionKeyResolutionV1 {
  const machineKind = MachineKindFromLegacyProjectionSchema.safeParse(params.machine.kind);
  if (!machineKind.success) return { status: 'unavailable' };

  const carriesRunnerContentKeyBinding = params.machine.runnerContentKeyBinding !== null
    && params.machine.runnerContentKeyBinding !== undefined;
  const isRunner = params.trustedMachineKind === 'ephemeral_session_runner'
    || carriesRunnerContentKeyBinding
    || machineKind.data === 'ephemeral_session_runner';

  const published = params.machine.dataEncryptionKey;
  const openedDataEncryptionKey = params.openedDataEncryptionKey;
  if (typeof published === 'string' && isPlainMachineDataKeyMarker(published)) {
    if (
      params.expectedAccountMode === 'e2ee'
      || (
        isRunner
        && (
          params.expectedAccountMode !== 'plain'
          || carriesRunnerContentKeyBinding
        )
      )
    ) return { status: 'unavailable' };
    return { status: 'plain' };
  }

  if (!isRunner) {
    if (published === null || published === undefined) return { status: 'legacy' };
    return typeof published === 'string' && openedDataEncryptionKey !== null && openedDataEncryptionKey.length > 0
      ? { status: 'e2ee', dataKey: openedDataEncryptionKey }
      : { status: 'unavailable' };
  }

  if (
    typeof published !== 'string'
    || openedDataEncryptionKey === null
    || openedDataEncryptionKey.length !== 32
    || typeof params.machine.installationId !== 'string'
    || params.machine.installationId.length === 0
    || !params.expectedRunnerBinding
    || (
      params.expectedAccountMode !== undefined
      && params.expectedAccountMode !== 'e2ee'
    )
  ) return { status: 'unavailable' };

  const binding = RunnerMachineContentKeyBindingV1Schema.safeParse(
    params.machine.runnerContentKeyBinding,
  );
  const expected = params.expectedRunnerBinding;
  if (
    !binding.success
    || expected.machineId !== params.machine.id
    || binding.data.homeServerIdentityId !== expected.homeServerIdentityId
    || binding.data.creatorAccountId !== expected.creatorAccountId
    || binding.data.machineId !== expected.machineId
    || binding.data.installationId !== params.machine.installationId
    || binding.data.machineContentKeyFingerprint
      !== computeRunnerMachineContentKeyFingerprintV1(openedDataEncryptionKey)
  ) return { status: 'unavailable' };
  const authenticatedPayload = readRunnerMachineContentKeyBindingSignedPayloadV1(binding.data);
  const expectedAccountSigningPublicKey = expected.accountSigningPublicKeyBase64Url
    ?? (expected.accountScopedMaterial
      ? openRunnerMachineContentKeyVerifierFactV1({
        ciphertext: binding.data.creatorVerifierFactCiphertext,
        material: expected.accountScopedMaterial,
        expectedActivationId: binding.data.activationId,
        expectedMachineId: expected.machineId,
      })
      : null);
  if (!authenticatedPayload || !expectedAccountSigningPublicKey) return { status: 'unavailable' };
  const verified = verifyRunnerMachineContentKeyBindingV1({
    binding: binding.data,
    expectedPayload: authenticatedPayload,
    expectedAccountSigningPublicKey,
  });
  if (!verified) return { status: 'unavailable' };
  if (expected.sessionId !== undefined && !runnerClaimCorrespondsV1({
    claim: params.machine.runnerClaim,
    sessionId: expected.sessionId,
    activationId: binding.data.activationId,
    installationId: binding.data.installationId,
    activationSigningPublicKey: expectedAccountSigningPublicKey,
    expected,
  })) return { status: 'unavailable' };
  return { status: 'e2ee', dataKey: openedDataEncryptionKey };
}
