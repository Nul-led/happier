import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { build } from 'esbuild';
import { chromium } from 'playwright';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const uiModules = resolve(repositoryRoot, 'apps/ui/node_modules');

test('Columns lays out wrapped cells and spans without losing a focused draft on resize', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve(repositoryRoot, 'packages/plugin-ui'),
      sourcefile: 'columns.browser.fixture.tsx',
      loader: 'tsx',
      contents: `
        import { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { TextInput, View } from 'react-native';
        import { HappierColumn as Column, HappierColumns as Columns } from './src/presentation/layout/Columns.tsx';
        function Draft() {
          const [value, setValue] = useState('Original');
          return <TextInput testID="draft" value={value} onChangeText={setValue} />;
        }
        createRoot(document.getElementById('root')).render(<>
          <div id="pair-frame" style={{ width: 900 }}>
            <Columns columns={2}>
              <Column testID="pair-1"><View style={{ height: 40 }}><Draft /></View></Column>
              <Column testID="pair-2"><View style={{ height: 40 }} /></Column>
              <Column testID="pair-3"><View style={{ height: 40 }} /></Column>
            </Columns>
          </div>
          <div style={{ width: 1100 }}>
            <Columns columns={3} paddingHorizontal={20} columnGap={18}>
              <Column testID="span-1" span={2}><View style={{ height: 40 }} /></Column>
              <Column testID="span-2"><View style={{ height: 40 }} /></Column>
              <Column testID="span-3"><View style={{ height: 40 }} /></Column>
            </Columns>
          </div>
        </>);
      `,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: resolve(uiModules, 'react'),
      'react-dom': resolve(uiModules, 'react-dom'),
      'react-native': resolve(uiModules, 'react-native-web'),
    },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => {
      const cell = document.querySelector('[data-testid="pair-1"]');
      const span = document.querySelector('[data-testid="span-1"]');
      return cell && span
        && cell.getBoundingClientRect().width < 800
        && span.getBoundingClientRect().width < 1000;
    });
    const rectangles = async (prefix) => page.locator(`[data-testid^="${prefix}-"]`).evaluateAll((cells) => (
      cells.map((cell) => {
        const { x, y, width, height } = cell.getBoundingClientRect();
        return { x, y, width, height };
      })
    ));
    const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.1, `${actual} != ${expected}`);
    const pair = await rectangles('pair');
    closeTo(pair[0].width, 428);
    closeTo(pair[1].width, 428);
    closeTo(pair[1].x - pair[0].x - pair[0].width, 12);
    closeTo(pair[0].y, pair[1].y);
    assert.ok(pair[2].y >= pair[0].y + pair[0].height);
    closeTo(pair[2].width, 428);

    const spans = await rectangles('span');
    closeTo(spans[0].width, 2 * ((1060 - 36) / 3) + 18);
    closeTo(spans[1].width, (1060 - 36) / 3);
    closeTo(spans[1].x - spans[0].x - spans[0].width, 18);
    closeTo(spans[0].y, spans[1].y);
    assert.ok(spans[2].y >= spans[0].y + spans[0].height);

    const input = page.getByTestId('draft');
    await input.fill('Working draft');
    await input.evaluate((element) => {
      element.setSelectionRange(3, 7);
      window.originalDraft = element;
    });
    for (const width of [500, 900]) {
      await page.locator('#pair-frame').evaluate((element, nextWidth) => {
        element.style.width = `${nextWidth}px`;
      }, width);
      await page.waitForFunction((expectedWidth) => {
        const cell = document.querySelector('[data-testid="pair-1"]');
        return cell && Math.abs(cell.getBoundingClientRect().width - expectedWidth) < 0.1;
      }, width === 500 ? 468 : 428);
      assert.deepEqual(await input.evaluate((element) => ({
        sameNode: element === window.originalDraft,
        focused: element === document.activeElement,
        value: element.value,
        selection: [element.selectionStart, element.selectionEnd],
      })), { sameNode: true, focused: true, value: 'Working draft', selection: [3, 7] });
    }
  } finally {
    await browser.close();
  }
});
