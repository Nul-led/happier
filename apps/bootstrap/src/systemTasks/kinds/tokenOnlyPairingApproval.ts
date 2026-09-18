import { randomBytes } from 'node:crypto';

import { sealTerminalProvisioningV3TokenOnlyPayload } from '@happier-dev/protocol';
import type {
  InteractiveSystemTaskContext,
  LocalFirstPartyCommandProvenance,
} from '@happier-dev/cli-common/systemTasks';

export type TokenOnlyPairingApprovalTarget = Readonly<{
  serverUrl: string;
  webappUrl: string;
}>;

/** The CLI this run resolved, as classified by the one canonical resolver. */
export type TokenOnlyPairingCli = Readonly<{
  provenance: LocalFirstPartyCommandProvenance;
  command: string | null;
}>;

type TokenOnlyPairingContext = Readonly<{
  terminalEphemeralPublicKey: Uint8Array;
  pairingSecret: Uint8Array;
  createdAtMs: number;
  expiresAtMs: number;
}>;

/**
 * Reads the v3 token-only pairing context that the terminal's `auth request` retained locally.
 * Only the public key and the short-lived pairing context are consumed; the claim secret and
 * state file path are never read here and never leave the task.
 */
function readTokenOnlyPairingContext(
  requestPayload: Readonly<Record<string, unknown>>,
): TokenOnlyPairingContext | null {
  if (requestPayload.supportsTokenOnly !== true) {
    return null;
  }
  const publicKeyRaw = typeof requestPayload.publicKey === 'string' ? requestPayload.publicKey.trim() : '';
  const pairing = requestPayload.pairing;
  if (!publicKeyRaw || !pairing || typeof pairing !== 'object' || Array.isArray(pairing)) {
    return null;
  }
  const pairingRecord = pairing as Record<string, unknown>;
  const secretRaw = typeof pairingRecord.secretB64Url === 'string' ? pairingRecord.secretB64Url.trim() : '';
  const createdAtMs = pairingRecord.createdAtMs;
  const expiresAtMs = pairingRecord.expiresAtMs;
  if (!secretRaw || typeof createdAtMs !== 'number' || typeof expiresAtMs !== 'number') {
    return null;
  }
  if (
    !Number.isSafeInteger(createdAtMs)
    || !Number.isSafeInteger(expiresAtMs)
    || createdAtMs < 0
    || expiresAtMs <= createdAtMs
  ) {
    return null;
  }
  const terminalEphemeralPublicKey = new Uint8Array(Buffer.from(publicKeyRaw, 'base64'));
  const pairingSecret = new Uint8Array(Buffer.from(secretRaw, 'base64url'));
  if (terminalEphemeralPublicKey.length !== 32 || pairingSecret.length !== 32) {
    return null;
  }
  return { terminalEphemeralPublicKey, pairingSecret, createdAtMs, expiresAtMs };
}

/**
 * Seals the existing protocol-owned token-only provisioning response for the requesting terminal
 * and returns the blocking approval prompt data. The response carries no credential: the terminal
 * claims its own bearer from the Home's claim endpoint. Prompt data exposes only the opaque
 * response, the explicit target identity and how this run's CLI was acquired — never a secret,
 * claim material, state file, or bearer. This is the one prompt contract the desktop approval
 * owner (`approveSystemTaskAuthRequestPrompt`) recognizes; local setup and local repair both emit
 * it.
 *
 * `cliProvenance` is reported by this executor, which ships inside the app bundle — not by the CLI
 * being judged — and the approval owner approves only `managed` without asking. `cliCommand` is
 * the command this run actually resolved, shown verbatim to the person asked to vouch for a CLI
 * the install path did not place (R8/R13), so the decision is about the program that is really
 * asking. It is a local filesystem path, never a credential, and it goes through the same event
 * redaction as every other prompt field.
 */
function buildTokenOnlyApprovalPromptData(
  publicKey: string,
  requestPayload: Readonly<Record<string, unknown>>,
  target: TokenOnlyPairingApprovalTarget,
  cli: TokenOnlyPairingCli,
): Record<string, string> | null {
  const context = readTokenOnlyPairingContext({ ...requestPayload, publicKey });
  if (!context) {
    return null;
  }
  let sealed: Uint8Array;
  try {
    sealed = sealTerminalProvisioningV3TokenOnlyPayload({
      ...context,
      randomBytes: (length) => new Uint8Array(randomBytes(length)),
    });
  } catch {
    return null;
  }
  return {
    kind: 'authRequest',
    publicKey,
    response: Buffer.from(sealed).toString('base64'),
    responseKind: 'tokenOnly',
    relayUrl: target.serverUrl,
    webappUrl: target.webappUrl,
    cliProvenance: cli.provenance,
    // Present unless nothing resolved at all, so the approval owner can name the exact program
    // asking when it has to ask a human about it.
    ...(cli.command ? { cliCommand: cli.command } : {}),
  };
}

/**
 * The answering owner's decision. A refusal carries the owner's own reason code when it named one,
 * so the task can fail with what actually happened (a relay mismatch, an unreadable credential, a
 * failed approval POST) instead of reporting every refusal as a human decline.
 */
export type TokenOnlyPairingApprovalDecision =
  | Readonly<{ approved: true }>
  | Readonly<{ approved: false; reason: string | null }>;

/**
 * Issues the one blocking token-only approval prompt and reports the answering owner's decision.
 * Returns `null` when the requesting CLI supplied no token-only pairing material, so the caller
 * fails closed by name.
 */
export async function requestTokenOnlyPairingApproval(params: Readonly<{
  ctx: Pick<InteractiveSystemTaskContext, 'prompt'>;
  stepId: string;
  message: string;
  publicKey: string;
  requestPayload: Readonly<Record<string, unknown>>;
  target: TokenOnlyPairingApprovalTarget;
  /**
   * Which `happier` CLI this run resolved and how. Only `managed` is approved without asking; any
   * other provenance is confirmed by the person at the keyboard, who is shown `command`.
   */
  cli: TokenOnlyPairingCli;
}>): Promise<TokenOnlyPairingApprovalDecision | null> {
  const promptData = buildTokenOnlyApprovalPromptData(
    params.publicKey,
    params.requestPayload,
    params.target,
    params.cli,
  );
  if (!promptData) {
    return null;
  }
  const answer = await params.ctx.prompt({
    kind: 'authRequest',
    stepId: params.stepId,
    message: params.message,
    data: promptData,
  }) as Readonly<{ approved?: unknown; reason?: unknown }> | null;
  if (answer?.approved === true) {
    return { approved: true };
  }
  const reason = typeof answer?.reason === 'string' && answer.reason.trim() ? answer.reason.trim() : null;
  return { approved: false, reason };
}
