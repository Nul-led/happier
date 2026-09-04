import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { renderKeyboardReferenceMarkdown } from './generateKeyboardReference.mjs';

test('documents Search independent gating and account-synced shortcut preferences', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happier-keyboard-reference-'));
  try {
    const commandsPath = join(root, 'commands.ts');
    const settingsPath = join(root, 'accountSettings.ts');
    await writeFile(commandsPath, `export const commands = [
    {
      id: 'commandPalette.open',
      defaultBinding: { binding: 'Alt+K' },
    },
    {
      id: 'session.new',
      defaultBinding: { binding: 'Alt+N' },
    },
];\n`);
    await writeFile(settingsPath, `const settings = {
  commandPaletteEnabled: accountPreference(z.boolean(), true, 'keyboard shortcuts'),
  keyboardShortcutsV2Enabled: accountPreference(z.boolean(), false, 'keyboard shortcuts'),
};\n`);

    const markdown = await renderKeyboardReferenceMarkdown({ commandsPath, settingsPath });

    assert.match(markdown, /Open Search shortcut has its own switch/u);
    assert.match(markdown, /other commands remain off/u);
    assert.match(markdown, /sync with your account/u);
    assert.doesNotMatch(markdown, /before any binding below does anything/u);
    assert.doesNotMatch(markdown, /stored per device rather than synced/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
