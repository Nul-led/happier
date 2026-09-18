import { describe, expect, it } from 'vitest';

import { captureStdout } from '@/testkit/logger/captureOutput';

import { handleCompletionCliCommand } from './completion';

describe('completion command', () => {
  it.each([
    ['bash', 'complete -F _happier_completion happier'],
    ['zsh', 'compdef _happier_completion happier'],
    ['fish', 'complete -c happier'],
    ['powershell', 'Register-ArgumentCompleter -Native -CommandName happier'],
  ] as const)('emits a pure %s completion script', async (shell, marker) => {
    const output = captureStdout();
    try {
      await handleCompletionCliCommand({
        args: ['completion', shell], rawArgv: ['happier', 'completion', shell], terminalRuntime: null,
      });
      expect(output.chunks).toHaveLength(1);
      expect(output.text()).toContain(marker);
      expect(output.text()).not.toContain('node ');
      expect(output.text()).not.toContain('npm ');
    } finally {
      output.restore();
    }
  });

  it('uses native token arrays instead of reparsing Fish command text', async () => {
    const output = captureStdout();
    try {
      await handleCompletionCliCommand({
        args: ['completion', 'fish'], rawArgv: ['happier', 'completion', 'fish'], terminalRuntime: null,
      });

      expect(output.text()).toContain('set -l words (commandline -xpc)');
      expect(output.text()).toContain('$words[2..]');
      expect(output.text()).not.toContain('commandline -opc');
      expect(output.text()).not.toContain("string split ' '");
    } finally {
      output.restore();
    }
  });

  it('drops only the executable word from the Zsh argv array', async () => {
    const output = captureStdout();
    try {
      await handleCompletionCliCommand({
        args: ['completion', 'zsh'], rawArgv: ['happier', 'completion', 'zsh'], terminalRuntime: null,
      });

      expect(output.text()).toContain('"${words[@]:1}"');
      expect(output.text()).not.toContain('"${words[@]:2}"');
    } finally {
      output.restore();
    }
  });

  it('forwards dequoted PowerShell string values without evaluating command text', async () => {
    const output = captureStdout();
    try {
      await handleCompletionCliCommand({
        args: ['completion', 'powershell'], rawArgv: ['happier', 'completion', 'powershell'], terminalRuntime: null,
      });

      expect(output.text()).toContain('StringConstantExpressionAst');
      expect(output.text()).toContain('$element.Value');
      expect(output.text()).not.toContain('ForEach-Object { $_.Extent.Text }');
      expect(output.text()).not.toContain('Where-Object');
    } finally {
      output.restore();
    }
  });

  it.each(['bash', 'zsh', 'fish', 'powershell'] as const)('keeps %s completion failures quiet', async (shell) => {
    const output = captureStdout();
    try {
      await handleCompletionCliCommand({
        args: ['completion', shell], rawArgv: ['happier', 'completion', shell], terminalRuntime: null,
      });
      expect(output.text()).toMatch(shell === 'powershell' ? /2>\$null/u : /2>\/dev\/null/u);
    } finally {
      output.restore();
    }
  });
});
