import { readFile } from 'node:fs/promises';
import { approveTerminalAuthRequest, parseTerminalAuthApprovalRequest } from '@/auth/terminalAuthApproval';
import { writeJsonStdout } from '@/cli/output/jsonEnvelope';
import { applyServerSelectionFromArgs } from '@/server/serverSelection';

export async function handleAuthApprove(argsRaw: string[]): Promise<void> {
  const args = await applyServerSelectionFromArgs(argsRaw);

  const json = args.includes('--json');
  if (!json) {
    console.error('Missing required flag: --json');
    process.exit(2);
  }

  const keyIndex = args.findIndex((a) => a === '--public-key');
  const publicKeyRaw = keyIndex >= 0 ? (args[keyIndex + 1] ?? '') : '';
  const fileIndex = args.indexOf('--request-file');
  const requestFile = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  if (fileIndex >= 0 && (!requestFile || requestFile.startsWith('--'))) {
    console.error('Missing --request-file <path>');
    process.exit(2);
  }
  if (!requestFile && (!publicKeyRaw || publicKeyRaw.startsWith('--'))) {
    console.error('Missing --request-file <path> or --public-key <base64>');
    process.exit(2);
  }
  try {
    let packet: unknown = { publicKey: publicKeyRaw };
    if (requestFile) {
      try { packet = JSON.parse(await readFile(requestFile, 'utf8')); }
      catch { throw new Error('Unable to read a valid auth request JSON file'); }
    }
    const request = parseTerminalAuthApprovalRequest(packet);
    if (publicKeyRaw && request.publicKey !== parseTerminalAuthApprovalRequest({ publicKey: publicKeyRaw }).publicKey) {
      throw new Error('Auth request public key does not match --public-key');
    }
    if (!request.pairing) console.error('Public-key-only approval supports older recipients. Happier 0.3 requires --request-file with a new authenticated pairing request.');
    await approveTerminalAuthRequest(request);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Failed to approve auth request.');
    process.exit(1);
  }

  await writeJsonStdout({ success: true });
}
