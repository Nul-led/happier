import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('internal remote Home enrollment surface', () => {
  it('is not advertised and SSH entry points do not compose persisted request/wait commands', async () => {
    const [help, pairRemote, enrollRemote, remoteEnrollmentOwner, machineKind, commandBuilder] = await Promise.all([
      readFile(new URL('./auth/help.ts', import.meta.url), 'utf8'),
      readFile(new URL('./auth/pairRemote.ts', import.meta.url), 'utf8'),
      readFile(new URL('./auth/enrollRemote.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../auth/remoteTerminalEnrollment.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../../../../packages/cli-common/src/systemTasks/kinds/remoteSshBootstrapMachineKind.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../../../../packages/cli-common/src/systemTasks/ssh/remoteBootstrapCommandBuilder.ts', import.meta.url), 'utf8'),
    ]);

    expect(help).not.toContain('enroll-remote');
    expect(pairRemote).not.toMatch(/['"]request['"].*--persist/u);
    expect(pairRemote).not.toMatch(/['"]wait['"].*--persist/u);
    expect(pairRemote).not.toMatch(/runOpenSshRemoteCommand|createOpenSshHappierJsonExecutor/u);
    expect(pairRemote).toContain('createLiveRemoteEnrollmentExecutor');
    expect(machineKind).not.toMatch(/['"]auth['"],\s*['"]request['"]/u);
    expect(machineKind).not.toMatch(/['"]auth['"],\s*['"]wait['"]/u);
    expect(commandBuilder).not.toMatch(/auth (?:request|wait)|--remote-pairing-context|--persist/u);
    expect(`${enrollRemote}\n${remoteEnrollmentOwner}`).not.toContain('/auth/pending');
    expect(`${enrollRemote}\n${remoteEnrollmentOwner}`).not.toContain('writeProtectedLocalStateFile');
  });
});
