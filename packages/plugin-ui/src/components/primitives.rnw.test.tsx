import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { mountThroughReactNativeWeb } from '../rnwMount.testSupport.js';
import { createHostApiStub, createSurfaceContext } from '../surfaceFixture.testSupport.js';

import {
  ItemGroup,
  List,
} from './index.js';
import { PluginUiProvider } from './PluginUiProvider.js';

function mountAuthorList(element: ReactNode) {
  const context = createSurfaceContext();
  return mountThroughReactNativeWeb(
    <PluginUiProvider hostApi={createHostApiStub(context)} context={context}>
      {element}
    </PluginUiProvider>,
  );
}

describe('List', () => {
  it('renders data through native list semantics, never package marker elements', () => {
    const mount = mountAuthorList(
      <List
        accessibilityLabel="Review findings"
        items={[
          { id: 'a', label: 'First finding' },
          { id: 'b', label: 'Second finding' },
        ]}
        keyForItem={(item) => item.id}
        renderItem={(item) => item.label}
      />,
    );

    expect(mount.container.querySelector('happier-plugin-list')).toBeNull();
    expect(mount.container.querySelector('happier-plugin-list-item')).toBeNull();

    const list = mount.container.querySelector('[role="list"]');
    expect(list).not.toBeNull();
    expect(list?.getAttribute('aria-label')).toBe('Review findings');
    expect(list?.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(list?.textContent).toContain('First finding');
    expect(list?.textContent).toContain('Second finding');
    // A raw text node is invalid beneath React Native's View. The list owner
    // must turn the convenient string `renderItem` result into a real Text host
    // rather than relying on RNW's accidental DOM tolerance.
    for (const item of list?.querySelectorAll('[role="listitem"]') ?? []) {
      expect(item.firstChild?.nodeType).not.toBe(Node.TEXT_NODE);
    }

    mount.unmount();
  });

  it('groups explicitly authored rows with one labelled section', () => {
    const mount = mountAuthorList(
      <List accessibilityLabel="Review findings">
        <List.Section title="Critical">
          <List.Item accessibilityLabel="One critical finding">First finding</List.Item>
          <List.Item>Second finding</List.Item>
        </List.Section>
      </List>,
    );

    expect(mount.container.querySelectorAll('[role="list"]')).toHaveLength(1);
    const section = mount.container.querySelector('[role="group"]');
    expect(section?.getAttribute('aria-label')).toBe('Critical');
    expect(section?.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(mount.container.querySelector('happier-plugin-list')).toBeNull();
    expect(mount.container.querySelector('happier-plugin-list-item')).toBeNull();

    mount.unmount();
  });

  it('paints a section title from the projected dark theme', () => {
    const context = createSurfaceContext({ colorScheme: 'dark' });
    const mount = mountThroughReactNativeWeb(
      <PluginUiProvider hostApi={createHostApiStub(context)} context={context}>
        <List accessibilityLabel="Review findings">
          <List.Section title="Critical">
            <List.Item>First finding</List.Item>
          </List.Section>
        </List>
      </PluginUiProvider>,
    );

    const section = mount.container.querySelector('[role="group"][aria-label="Critical"]');
    const title = Array.from(section?.querySelectorAll<HTMLElement>('[dir="auto"]') ?? [])
      .find((candidate) => candidate.textContent === 'Critical');
    expect(title, 'the shared section owner must render its visible title').toBeDefined();
    expect(title?.style.color.replace(/\s/gu, '')).toBe('rgb(240,240,240)');

    mount.unmount();
  });

  it('renders the standalone ItemGroup through the portable group owner', () => {
    const mount = mountAuthorList(
      <ItemGroup accessibilityRole="radiogroup" accessibilityLabel="Review scope">
        <List.Item>Files</List.Item>
      </ItemGroup>,
    );

    const group = mount.container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('Review scope');
    expect(group?.querySelectorAll('[role="listitem"]')).toHaveLength(1);

    mount.unmount();
  });
});
