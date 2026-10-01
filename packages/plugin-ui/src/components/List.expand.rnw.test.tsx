import { act, useState } from 'react';
import { describe, expect, it } from 'vitest';

import { mountThroughReactNativeWeb } from '../rnwMount.testSupport.js';
import { createHostApiStub, createSurfaceContext } from '../surfaceFixture.testSupport.js';
import { List } from './List.js';
import { PluginUiProvider } from './PluginUiProvider.js';
import { Text } from './Text.js';

/**
 * Plugin tabs round 2 (XP / PP): a row opens in place. Pressing it shows what it is to this session under its
 * text, with its actions at the bottom; pressing it again folds it. The body is the same disclosure owner the
 * Collection peek and the host's `ExpandableItem` use.
 */
function ExpandableRow() {
  const [expanded, setExpanded] = useState(false);
  return (
    <List accessibilityLabel="Conversations">
      <List.Item
        testID="conversation-row"
        title="happier-dev"
        subtitle="Discord · Happier Labs"
        expanded={expanded}
        expandedContent={<Text testID="conversation-peek" value="Hears messages addressed to the bot" />}
        onPress={() => setExpanded((current) => !current)}
      />
    </List>
  );
}

function mount() {
  const context = createSurfaceContext();
  return mountThroughReactNativeWeb(
    <PluginUiProvider hostApi={createHostApiStub(context)} context={context}>
      <ExpandableRow />
    </PluginUiProvider>,
  );
}

describe('plugin-ui List.Item expand in place', () => {
  it('opens its body under the row on press and folds it again, saying so to assistive technology', () => {
    const view = mount();
    const row = () => view.container.querySelector<HTMLElement>('[data-testid="conversation-row"] [role="button"], [role="button"][data-testid="conversation-row"]');
    expect(row(), 'the row is a real pressable').not.toBeNull();
    expect(row()?.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.querySelector('[data-testid="conversation-peek"]')).toBeNull();

    act(() => row()!.click());
    expect(row()?.getAttribute('aria-expanded')).toBe('true');
    expect(view.container.querySelector('[data-testid="conversation-peek"]')?.textContent)
      .toBe('Hears messages addressed to the bot');

    act(() => row()!.click());
    expect(row()?.getAttribute('aria-expanded')).toBe('false');
    view.unmount();
  });
});
