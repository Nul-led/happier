import { resolveHappyHomeDirFromEnvironment } from '@happier-dev/cli-common/agents';

import { resolveCliSelectedAccountServicePresentation } from '@/auth/accountService/cliAccountServicePresentation';
import { createCliAccountServiceSessionOwner } from '@/auth/accountService/cliAccountServiceSession';
import { runCliAccountServiceSetupEntry } from '@/auth/accountService/cliAccountServiceSetupEntry';

export type AuthServiceCommandDeps = Readonly<{
  createSession?: typeof createCliAccountServiceSessionOwner;
  resolvePresentation?: typeof resolveCliSelectedAccountServicePresentation;
  runSetupEntry?: typeof runCliAccountServiceSetupEntry;
}>;

const USAGE = 'Usage: happier auth service status | use <endpoint> | logout';

/**
 * The read/change/sign-out surface for the Account Service this CLI signs in
 * through. Every decision stays with its existing owner: the session owner holds
 * the selection and its restricted credential, the presentation owner verifies
 * the selected service's current identity and role, and the setup entry owner
 * performs discovery, selection and sign-in. This command only names the
 * subcommands and reports what those owners answered.
 */
export async function handleAuthServiceCommand(
  args: readonly string[],
  signal?: AbortSignal,
  deps: AuthServiceCommandDeps = {},
): Promise<void> {
  const createSession = deps.createSession ?? createCliAccountServiceSessionOwner;
  const resolvePresentation = deps.resolvePresentation ?? resolveCliSelectedAccountServicePresentation;
  const runSetupEntry = deps.runSetupEntry ?? runCliAccountServiceSetupEntry;
  const subcommand = args[0];

  if (subcommand === 'status') {
    if (args.length > 1) throw Object.assign(new Error(USAGE), { code: 'invalid_params' });
    const session = createSession({ happyHomeDir: resolveHappyHomeDirFromEnvironment(process.env) });
    const selection = await session.readSelection();
    if (!selection) {
      console.log('No Account Service is selected. Run `happier auth service use <endpoint>` to choose one.');
      return;
    }
    const presentation = await resolvePresentation({ ...(signal ? { signal } : {}) });
    if (!presentation) {
      // The pointer is stored, but the service did not verify as the same
      // Account-Service-capable identity it was selected as.
      console.log(`Selected Account Service: ${selection.endpoint}`);
      console.log('This service did not confirm its identity or Account Service role. Re-run `happier auth service use <endpoint>`.');
      process.exitCode = 1;
      return;
    }
    console.log(`Selected Account Service: ${presentation.displayName}`);
    console.log(`  Endpoint: ${presentation.endpoint}`);
    console.log(`  Server identity: ${presentation.serverIdentityId}`);
    return;
  }

  if (subcommand === 'use') {
    const endpoint = args[1]?.trim();
    if (!endpoint || args.length > 2) throw Object.assign(new Error(USAGE), { code: 'invalid_params' });
    const outcome = await runSetupEntry({
      endpoint,
      context: { kind: 'none' },
      ...(signal ? { signal } : {}),
    });
    if (outcome.kind === 'home_entered') {
      console.log(`Signed in through ${endpoint} and entered Home ${outcome.homeServerIdentityId}.`);
      return;
    }
    // Everything else is a decision the interactive setup journey owns (choosing
    // a Home, creating one, recovering material). This command does not re-ask
    // those questions; it reports the owner's typed answer and points at it.
    console.log(`Account Service sign-in did not complete: ${outcome.kind}.`);
    console.log('Run `happier setup` to continue this choice interactively.');
    process.exitCode = 1;
    return;
  }

  if (subcommand === 'logout') {
    if (args.length > 1) throw Object.assign(new Error(USAGE), { code: 'invalid_params' });
    const session = createSession({ happyHomeDir: resolveHappyHomeDirFromEnvironment(process.env) });
    await session.logout();
    // `logout` drops the restricted credential and keeps the selection, so the
    // next sign-in returns to the same service without rediscovering it.
    console.log('Signed out of the selected Account Service. Homes you already entered keep their own credentials.');
    return;
  }

  throw Object.assign(new Error(USAGE), { code: 'invalid_params' });
}
