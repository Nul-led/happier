import type { CommandContext } from '@/cli/commandRegistry';
import { errorFrame } from '@happier-dev/cli-common/output';

import { showAuthHelp } from './auth/help';
import { handleAuthApprove } from './auth/approve';
import { handleAuthLogin } from './auth/login';
import { handleAuthLogout } from './auth/logout';
import { handleAuthPairRemote } from './auth/pairRemote';
import { handleAuthRequest } from './auth/request';
import { handleAuthStatus } from './auth/status';
import { handleAuthWait } from './auth/wait';
import { handleAuthEnrollRemote } from './auth/enrollRemote';

type SafeAuthErrorDiagnostic = Readonly<{
  name: string;
  message: string;
  code?: string | number;
  status?: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readSafeErrorCode(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return undefined;
  return /^[A-Za-z0-9_.:-]+$/.test(value) ? value : undefined;
}

function readSafeHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function projectSafeAuthError(error: unknown): SafeAuthErrorDiagnostic {
  const errorRecord = isRecord(error) ? error : null;
  const responseRecord = errorRecord && isRecord(errorRecord.response) ? errorRecord.response : null;
  const name = error instanceof Error && error.name.length > 0 && error.name.length <= 64
    ? error.name
    : 'Error';
  const message = error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 2_048)
    : 'Unknown error';
  const code = readSafeErrorCode(errorRecord?.code);
  const status = readSafeHttpStatus(errorRecord?.status)
    ?? readSafeHttpStatus(responseRecord?.status);
  return {
    name,
    message,
    ...(code !== undefined ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

export async function handleAuthCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    showAuthHelp();
    return;
  }

  switch (subcommand) {
    case 'login':
      await handleAuthLogin(args.slice(1));
      return;
    case 'request':
      await handleAuthRequest(args.slice(1));
      return;
    case 'approve':
      await handleAuthApprove(args.slice(1));
      return;
    case 'wait':
      await handleAuthWait(args.slice(1));
      return;
    case 'pair-remote':
      await handleAuthPairRemote(args.slice(1));
      return;
    case 'enroll-remote':
      await handleAuthEnrollRemote(args.slice(1));
      return;
    case 'logout':
      await handleAuthLogout(args.slice(1));
      return;
    case 'status':
      await handleAuthStatus(args.slice(1));
      return;
    default:
      console.error(errorFrame('Error:', [`Unknown auth subcommand: ${subcommand}`]));
      showAuthHelp();
      process.exit(1);
  }
}

export async function handleAuthCliCommand(context: CommandContext): Promise<void> {
  try {
    await handleAuthCommand(context.args.slice(1));
  } catch (error) {
    console.error(errorFrame('Error:', [error instanceof Error ? error.message : 'Unknown error']));
    if (process.env.DEBUG) {
      // Error objects from HTTP clients retain request bodies, response bodies,
      // headers, and config. Project only bounded actionable fields at the CLI
      // boundary so pairing and credential material cannot reach diagnostics.
      console.error(projectSafeAuthError(error));
    }
    process.exit(1);
  }
}
