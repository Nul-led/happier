import { readFile } from 'node:fs/promises';

import {
  approveTerminalAuthRequest,
  TerminalPairingContextRequiredError,
} from '@/auth/terminalAuthApproval';
import { writeJsonStdout } from '@/cli/output/jsonEnvelope';
import { applyServerSelectionFromArgs } from '@/server/serverSelection';

function fail(message: string, exitCode: 1 | 2): never {
  console.error(message);
  process.exit(exitCode);
}

function decodePublicKeyBytes(value: string): Uint8Array | null {
  try {
    const buf = Buffer.from(String(value ?? '').trim(), 'base64');
    if (buf.length === 32) return new Uint8Array(buf);
  } catch {
    // fall through to the mismatch/invalid handling
  }
  return null;
}

/**
 * The remote `auth request --json` envelope is the only genuine source of the
 * pairing context for this manual entry point. The approval owner validates
 * it; this reader only forwards `pairing`/`supportsTokenOnly` verbatim and
 * never fabricates pairing material.
 */
async function readRequestPairingEnvelope(path: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    fail(`Unable to read --request-json-file: ${path}`, 2);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    fail(
      `--request-json-file must contain the JSON envelope printed by \`happier auth request --json\`: ${path}`,
      2,
    );
  }
}

export async function handleAuthApprove(argsRaw: string[]): Promise<void> {
  const args = await applyServerSelectionFromArgs(argsRaw);

  const json = args.includes('--json');
  if (!json) {
    fail('Missing required flag: --json', 2);
  }

  const keyIndex = args.findIndex((a) => a === '--public-key');
  const publicKeyRaw = keyIndex >= 0 ? (args[keyIndex + 1] ?? '') : '';
  if (!publicKeyRaw || String(publicKeyRaw).startsWith('--')) {
    fail('Missing required flag: --public-key <base64>', 2);
  }

  const fileIndex = args.findIndex((a) => a === '--request-json-file');
  const requestJsonFileRaw = fileIndex >= 0 ? (args[fileIndex + 1] ?? '') : '';
  if (fileIndex >= 0 && (!requestJsonFileRaw || String(requestJsonFileRaw).startsWith('--'))) {
    fail('Missing value for --request-json-file <path>', 2);
  }
  const requestJsonFile = requestJsonFileRaw || null;

  let pairing: unknown;
  let supportsTokenOnly = false;
  if (requestJsonFile) {
    const envelope = await readRequestPairingEnvelope(requestJsonFile);
    const envelopePublicKey = typeof envelope.publicKey === 'string' ? envelope.publicKey : '';
    if (envelopePublicKey) {
      const envelopeKey = decodePublicKeyBytes(envelopePublicKey);
      const requestedKey = decodePublicKeyBytes(String(publicKeyRaw));
      if (
        !envelopeKey
        || !requestedKey
        || Buffer.from(envelopeKey).toString('hex') !== Buffer.from(requestedKey).toString('hex')
      ) {
        fail(
          'The request envelope public key does not match --public-key; approve the matching request.',
          2,
        );
      }
    }
    if (envelope.pairing !== undefined && envelope.pairing !== null) {
      pairing = envelope.pairing;
    }
    supportsTokenOnly = envelope.supportsTokenOnly === true;
  }

  try {
    await approveTerminalAuthRequest({
      publicKey: String(publicKeyRaw),
      ...(pairing ? { pairing } : {}),
      ...(supportsTokenOnly ? { supportsTokenOnly: true } : {}),
    });
  } catch (error) {
    if (error instanceof TerminalPairingContextRequiredError) {
      console.error(error.message);
      if (!requestJsonFile) {
        console.error(
          'Save the remote `happier auth request --json` output to a file and re-run with '
            + '--request-json-file <path>, or pair with `happier auth pair-remote --ssh <user@host>`.',
        );
      } else {
        console.error(
          'The request envelope did not include a pairing context. Upgrade the remote CLI, then run '
            + '`happier auth request --json` on the remote machine and approve the new request.',
        );
      }
      process.exit(1);
    }
    fail(error instanceof Error ? error.message : 'Failed to approve auth request.', 1);
  }

  await writeJsonStdout({ success: true });
}
