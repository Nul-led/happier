type DevinCliCommandResult = Readonly<{
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}>;

type DevinCliAuthStatus =
  | Readonly<{
    state: 'logged_in';
    method: 'oauth_cli';
    source: 'command';
  }>
  | Readonly<{
    state: 'logged_out';
    reason: 'missing_credentials';
    source: 'command';
  }>
  | Readonly<{
    state: 'unknown';
    reason: 'probe_failed';
    source: 'command';
  }>;

export type DevinCliAuthRunCommand = (
  args: readonly string[],
  options?: Readonly<{ timeoutMs?: number }>,
) => Promise<DevinCliCommandResult>;

function reportsDevinLoggedOut(stdout: string, stderr: string): boolean {
  return /(?:^|\r?\n)\s*not logged in\.\s*(?:\r?\n|$)/iu.test(`${stdout}\n${stderr}`);
}

export async function detectDevinCliAuthStatus(params: Readonly<{
  runCommand: DevinCliAuthRunCommand;
}>): Promise<DevinCliAuthStatus> {
  const result = await params.runCommand(['auth', 'status'], { timeoutMs: 2_000 });

  if (reportsDevinLoggedOut(result.stdout, result.stderr)) {
    return { state: 'logged_out', reason: 'missing_credentials', source: 'command' };
  }
  return result.ok
    ? { state: 'logged_in', method: 'oauth_cli', source: 'command' }
    : { state: 'unknown', reason: 'probe_failed', source: 'command' };
}
