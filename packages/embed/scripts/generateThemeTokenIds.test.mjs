import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { checkThemeTokenIds, renderPlaceholderTheme, renderThemeTokenIds } from './generateThemeTokenIds.mjs';

test('canonical token changes change the host projection and current generated types match', async () => {
  const source = await readFile(new URL('../../../apps/ui/sources/theme/tokens/themeColorTokenDefinitions.ts', import.meta.url), 'utf8');
  const changed = source.replace("id: 'background.canvas'", "id: 'background.replacement'");
  assert.notEqual(renderThemeTokenIds(source), renderThemeTokenIds(changed));
  await checkThemeTokenIds();
});

test('the host empty-composer projection follows the incumbent geometry owner', async () => {
  const sources = await Promise.all([
    '../../../apps/ui/sources/theme/index.ts',
    '../../plugin-ui/src/presentation/interaction/motion.ts',
    '../../../apps/ui/sources/theme/themeStyleScales.ts',
    '../../../apps/ui/sources/components/sessions/agentInput/AgentInput.tsx',
    '../../../apps/ui/sources/components/sessions/agentInput/components/agentInputChromeStyles.ts',
    '../../../apps/ui/sources/components/ui/layout/contentWidthMode.ts',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  const [theme, motion, scales, composer, chrome, width] = sources;
  const changed = composer.replace('minHeight: 40,', 'minHeight: 41,');
  assert.notEqual(
    renderPlaceholderTheme(theme, motion, scales, composer, chrome, width),
    renderPlaceholderTheme(theme, motion, scales, changed, chrome, width),
  );
});
