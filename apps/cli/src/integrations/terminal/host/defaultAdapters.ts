import type { TerminalHostAdapter, TerminalHostPreference } from './_types';
import type { TerminalPromptSubmitVerificationPolicy } from '../../terminalHost/promptSubmitVerification';

import { createTmuxTerminalHostAdapter, isTmuxAvailable } from '../../tmux';
import {
  createZellijTerminalHostAdapter,
  prepareZellijSocketDir,
  resolveZellijRuntimeBinary,
  resolveZellijSocketDir,
} from '../../zellij';
import { createPtyTerminalHostAdapter } from '@/terminal/pty/hostAdapter';
import { createHerdrTerminalHostAdapter } from '@/integrations/herdr/adapter';
import { HERDR_ACTION_TIMEOUT_MS, HERDR_STARTUP_TIMEOUT_MS, resolveHerdrRuntimeBinary } from '@/integrations/herdr/runtimeBinary';
import { createTerminalHostRegistry } from './registry';


type DefaultTerminalHostAdapterDependencies = Readonly<{
  isTmuxAvailable: typeof isTmuxAvailable;
  resolveZellijRuntimeBinary: typeof resolveZellijRuntimeBinary;
  prepareZellijSocketDir: typeof prepareZellijSocketDir;
  resolveZellijSocketDir: typeof resolveZellijSocketDir;
  createTmuxTerminalHostAdapter: typeof createTmuxTerminalHostAdapter;
  createZellijTerminalHostAdapter: typeof createZellijTerminalHostAdapter;
  createPtyTerminalHostAdapter: typeof createPtyTerminalHostAdapter;
  resolveHerdrRuntimeBinary: typeof resolveHerdrRuntimeBinary;
  createHerdrTerminalHostAdapter: typeof createHerdrTerminalHostAdapter;
}>;

export type DefaultTerminalHostAdapterInventory = Readonly<{
  adapters: Readonly<Partial<Record<TerminalHostAdapter['kind'], TerminalHostAdapter>>>;
  tmuxAvailable: boolean;
  zellijAvailable: boolean;
}>;

export async function createDefaultTerminalHostAdapterInventory(params: Readonly<{
  happyHomeDir: string;
  preference: TerminalHostPreference;
  herdrSessionName?: string;
  platform?: NodeJS.Platform;
  promptSubmitVerification?: TerminalPromptSubmitVerificationPolicy;
  dependencies?: DefaultTerminalHostAdapterDependencies;
}>): Promise<DefaultTerminalHostAdapterInventory> {
  const dependencies = params.dependencies ?? {
    isTmuxAvailable,
    resolveZellijRuntimeBinary,
    prepareZellijSocketDir,
    resolveZellijSocketDir,
    createTmuxTerminalHostAdapter,
    createZellijTerminalHostAdapter,
    createPtyTerminalHostAdapter,
    resolveHerdrRuntimeBinary,
    createHerdrTerminalHostAdapter,
  };
  const adapters: TerminalHostAdapter[] = [];
  const platform = params.platform ?? process.platform;
  const tmuxAvailable = platform === 'win32' ? false : await dependencies.isTmuxAvailable();
  if (tmuxAvailable) {
    adapters.push(dependencies.createTmuxTerminalHostAdapter({
      ...(params.promptSubmitVerification
        ? { promptSubmitVerification: params.promptSubmitVerification }
        : {}),
    }));
  }
  if (platform === 'win32') {
    adapters.push(dependencies.createPtyTerminalHostAdapter({
      ...(params.promptSubmitVerification
        ? { promptSubmitVerification: params.promptSubmitVerification }
        : {}),
    }));
  }

  const shouldConfigureZellij = platform !== 'win32' || params.preference === 'zellij';
  const zellijBinary = shouldConfigureZellij
    ? await dependencies.resolveZellijRuntimeBinary()
    : null;
  if (zellijBinary) {
    const socketDir = dependencies.resolveZellijSocketDir(params.happyHomeDir);
    await dependencies.prepareZellijSocketDir(socketDir);
    adapters.push(dependencies.createZellijTerminalHostAdapter({
      zellijBinary,
      socketDir,
      ...(params.promptSubmitVerification
        ? { promptSubmitVerification: params.promptSubmitVerification }
        : {}),
    }));
  }

  if (params.preference === 'herdr' && platform !== 'win32') {
    const herdrBinary = await dependencies.resolveHerdrRuntimeBinary({ actionTimeoutMs: HERDR_ACTION_TIMEOUT_MS });
    if (herdrBinary) {
      adapters.push(dependencies.createHerdrTerminalHostAdapter({
        binary: herdrBinary,
        ...(params.herdrSessionName ? { sessionName: params.herdrSessionName } : {}),
        actionTimeoutMs: HERDR_ACTION_TIMEOUT_MS,
        startupTimeoutMs: HERDR_STARTUP_TIMEOUT_MS,
        ...(params.promptSubmitVerification
          ? { promptSubmitVerification: params.promptSubmitVerification }
          : {}),
      }));
    }
  }

  return {
    adapters: createTerminalHostRegistry(adapters),
    tmuxAvailable,
    zellijAvailable: zellijBinary !== null,
  };
}
