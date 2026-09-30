import chalk from 'chalk';
import { existsSync, rmSync } from 'node:fs';

import { cmd, neutral, ok, warn } from '@happier-dev/cli-common/output';

import {
  clearCredentials,
  readCredentials,
  updateSettings,
} from '@/persistence';
import { configuration } from '@/configuration';
import { stopDaemon } from '@/daemon/controlClient';
import { stopAllDaemonsBestEffort } from '@/daemon/multiDaemon';
import { promptConfirmYesNo } from '@/terminal/prompts/promptConfirmYesNo';
import { clearServerScopedAuthStateInSettings } from './clearServerScopedAuthState';

export async function handleAuthLogout(args: string[]): Promise<void> {
  const logoutAll = args.includes('--all');
  const happyDir = configuration.happyHomeDir;
  const targetServerId = configuration.activeServerId;

  if (!logoutAll) {
    const credentials = await readCredentials();
    if (!credentials) {
      console.log(neutral('Not signed in'));
      return;
    }
  }

  console.log(warn(logoutAll
    ? 'This signs you out of Happier on all relays and removes local data'
    : `This signs you out of Happier for relay ${targetServerId}`));
  console.log(chalk.gray('  You will need to sign in again to use Happier.'));

  const confirmed = await promptConfirmYesNo(
    logoutAll ? 'Sign out everywhere and delete local data?' : 'Sign out?',
    { default: 'no' },
  );

  if (confirmed) {
    try {
      if (logoutAll) {
        try {
          await stopAllDaemonsBestEffort();
        } catch {
          // best-effort
        }
        if (existsSync(happyDir)) {
          rmSync(happyDir, { recursive: true, force: true });
        }
      } else {
        try {
          await stopDaemon();
          console.log(ok('Stopped the daemon'));
        } catch {
          // ignore
        }

        await clearCredentials();

        await updateSettings((settings) => {
          return clearServerScopedAuthStateInSettings(settings, targetServerId);
        });
      }

      console.log(ok('Signed out'));
      console.log(chalk.gray(`  Run ${cmd('happier auth login')} to sign in again.`));
    } catch (error) {
      throw new Error(`Failed to logout: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    return;
  }

  console.log(neutral('Sign-out cancelled'));
}
