import { act, useState } from 'react';
import { TextInput } from 'react-native';
import { describe, expect, it } from 'vitest';

import { Column, Columns } from '../../components/Layout.js';
import { PluginUiProvider } from '../../components/PluginUiProvider.js';
import { mountThroughReactNativeWeb } from '../../rnwMount.testSupport.js';
import { createHostApiStub, createSurfaceContext } from '../../surfaceFixture.testSupport.js';
import type { HappierLayoutChangeEvent } from '../portableTypes.js';

function DraftField() {
  const [value, setValue] = useState('Working draft');
  return <TextInput testID="draft" value={value} onChangeText={setValue} />;
}

describe('public Columns through React Native Web', () => {
  it('reflows its measured box without replacing a focused control or its value', () => {
    const context = createSurfaceContext();
    const mount = mountThroughReactNativeWeb(
      <PluginUiProvider hostApi={createHostApiStub(context)} context={context}>
        <Columns testID="columns" columns={2} minColumnWidth={320}>
          <Column testID="first"><DraftField /></Column>
          <Column><TextInput value="Other field" /></Column>
        </Columns>
      </PluginUiProvider>,
    );
    const box = mount.container.querySelector('[data-testid="columns"]');
    const input = mount.container.querySelector<HTMLInputElement>('[data-testid="draft"]')!;
    input.focus();
    input.setSelectionRange(3, 7);
    // RNW registers its platform measurement callback on the host element.
    const onLayout = (box as unknown as { __reactLayoutHandler: (event: HappierLayoutChangeEvent) => void }).__reactLayoutHandler;
    for (const width of [900, 400, 900]) {
      act(() => onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 200 } } }));
      expect(mount.container.querySelector('[data-testid="draft"]')).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('Working draft');
      expect([input.selectionStart, input.selectionEnd]).toEqual([3, 7]);
      const column = mount.container.querySelector<HTMLElement>('[data-testid="first"]')!;
      expect(column.parentElement?.style.width === '100%').toBe(width === 400);
    }
    mount.unmount();
  });
});
