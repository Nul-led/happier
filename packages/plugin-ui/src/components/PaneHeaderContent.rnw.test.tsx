import { act, useSyncExternalStore, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  PluginUiPaneHeaderHost,
  PluginUiPaneHeaderPresentation,
  PluginUiPresentationHost,
} from '../presentationHost/context.js';
import { mountThroughReactNativeWeb } from '../rnwMount.testSupport.js';
import { createHostApiStub, createSurfaceContext } from '../surfaceFixture.testSupport.js';
import { Avatar } from './Avatar.js';
import { Button } from './Button.js';
import { Menu } from './Overlay.js';
import { PaneHeaderContent } from './PaneHeaderContent.js';
import { PluginUiProviderInternal, usePluginTranslation } from './PluginUiProvider.js';

/**
 * Plugin tabs round 2 (HP): a plugin session tab puts its "+" and its one live fact in the pane header the host
 * already draws for its own tabs (Agents' "+"), never in a header of its own. The host draws that header OUTSIDE
 * the plugin's React tree, so the actions keep the plugin's context through the surface bridge.
 */
function createHeaderHost() {
  let published: PluginUiPaneHeaderPresentation | null = null;
  const listeners = new Set<() => void>();
  function Publisher(props: Readonly<{ input: PluginUiPaneHeaderPresentation }>) {
    published = props.input;
    queueMicrotask(() => listeners.forEach((listener) => listener()));
    return null;
  }
  const binding: PluginUiPaneHeaderHost = {
    renderPaneHeader: (input) => <Publisher input={input} />,
  };
  function HostHeader() {
    const input = useSyncExternalStore(
      (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      () => published,
    );
    if (!input) return null;
    return (
      <div data-testid="host-header">
        <span data-testid="host-header-line">{(input.line ?? []).map((part) => typeof part === 'string' ? part : part.text).join(' · ')}</span>
        {input.actions}
      </div>
    );
  }
  return { binding, HostHeader, read: () => published };
}

function TranslatedAction(props: Readonly<{ onPress: () => void }>) {
  const translate = usePluginTranslation();
  return <Button testID="header-plus" title={translate('probe.link', 'Link a conversation')} onPress={props.onPress} />;
}

function mount(children: ReactNode, header: ReturnType<typeof createHeaderHost> | null, extra: Partial<PluginUiPresentationHost> = {}) {
  const context = createSurfaceContext();
  const presentationHost = {
    renderMarkdown: () => null,
    renderPopover: () => null,
    renderIcon: () => null,
    ...(header ? { paneHeader: header.binding } : {}),
    ...extra,
  } as unknown as PluginUiPresentationHost;
  const HostHeader = header?.HostHeader ?? (() => null);
  return mountThroughReactNativeWeb(
    <>
      <HostHeader />
      <PluginUiProviderInternal hostApi={createHostApiStub(context)} context={context} presentationHost={presentationHost}>
        {children}
      </PluginUiProviderInternal>
    </>,
  );
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

describe('PaneHeaderContent (host pane header binding)', () => {
  it('publishes fresh attention facts when the count changes', async () => {
    const header = createHeaderHost();
    const context = createSurfaceContext();
    const wrap = (count: number) => (
      <PluginUiProviderInternal hostApi={createHostApiStub(context)} context={context} presentationHost={{
        renderMarkdown: () => null,
        renderCodeBlock: () => null,
        renderPopover: () => null,
        renderIcon: () => null,
        paneHeader: header.binding,
      }}>
        <PaneHeaderContent line={[{ text: `${count} needs you`, attention: true }]} />
      </PluginUiProviderInternal>
    );
    const view = mountThroughReactNativeWeb(wrap(1));
    await flush();
    await view.render(wrap(2));
    await flush();
    expect(header.read()?.line).toEqual([{ text: '2 needs you', attention: true }]);
    view.unmount();
  });
  it('puts the live fact and the actions in the host pane header, with the plugin context intact', async () => {
    const header = createHeaderHost();
    const onPress = vi.fn();
    const view = mount(
      <PaneHeaderContent line={['1 needs you']} actions={<TranslatedAction onPress={onPress} />} />,
      header,
    );
    await flush();

    const hostHeader = view.container.querySelector('[data-testid="host-header"]');
    expect(hostHeader?.querySelector('[data-testid="host-header-line"]')?.textContent).toBe('1 needs you');
    const plus = hostHeader?.querySelector<HTMLElement>('[data-testid="header-plus"]');
    expect(plus?.textContent).toContain('Link a conversation');
    act(() => plus!.click());
    expect(onPress).toHaveBeenCalledTimes(1);
    // Nothing is drawn in the tab itself.
    expect(view.container.querySelectorAll('[data-testid="header-plus"]')).toHaveLength(1);
    view.unmount();
  });

  it('draws nothing where the host placed the surface under no pane header', async () => {
    const view = mount(<PaneHeaderContent line={['2 live']} actions={<TranslatedAction onPress={() => undefined} />} />, null);
    await flush();
    expect(view.container.querySelector('[data-testid="header-plus"]')).toBeNull();
    expect(view.container.textContent).not.toContain('2 live');
    view.unmount();
  });
});

describe('Avatar (host person mark)', () => {
  it('draws the host avatar for a person by name, and a monogram without one', async () => {
    const renderAvatar = vi.fn((input: Readonly<{ name: string; size: number }>) => (
      <span data-testid="host-avatar">{`${input.name}@${input.size}`}</span>
    ));
    const hosted = mount(<Avatar name="Ana Silva" size="small" />, null, { renderAvatar } as Partial<PluginUiPresentationHost>);
    await flush();
    expect(hosted.container.querySelector('[data-testid="host-avatar"]')?.textContent).toBe('Ana Silva@16');
    hosted.unmount();

    const bare = mount(<Avatar name="Ana Silva" size="small" testID="bare-avatar" />, null);
    await flush();
    const mark = bare.container.querySelector('[data-testid="bare-avatar"]');
    expect(mark?.textContent).toBe('A');
    expect(mark?.getAttribute('aria-label')).toBe('Ana Silva');
    bare.unmount();
  });
});

describe('Menu with an icon trigger (the header "+")', () => {
  it('draws the trigger as the named glyph, keeps its accessible name, and still opens the menu', async () => {
    const icons: string[] = [];
    const renderIcon = (input: Readonly<{ name: string; accessibilityLabel?: string }>) => {
      icons.push(input.name);
      return <span data-testid="host-icon">{input.name}</span>;
    };
    const onOpenChange = vi.fn();
    const view = mount(
      <Menu
        open={false}
        onOpenChange={onOpenChange}
        trigger="Link a conversation"
        triggerIcon="add"
        triggerAccessibilityLabel="Link a conversation"
        items={[{ id: 'bot-1', label: '@happier_ops_bot' }]}
        onSelect={() => undefined}
      />,
      null,
      { renderIcon } as Partial<PluginUiPresentationHost>,
    );
    await flush();
    const trigger = view.container.querySelector<HTMLElement>('[aria-label="Link a conversation"]');
    expect(trigger).not.toBeNull();
    expect(icons).toContain('add');
    // The glyph replaces the visible text: the trigger is an icon button, named for assistive technology.
    expect(trigger?.textContent).toBe('add');
    act(() => trigger!.click());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    view.unmount();
  });
});
