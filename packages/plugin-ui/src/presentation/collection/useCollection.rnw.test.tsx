import { act, useState, type ReactElement } from 'react';
import { Text } from 'react-native';
import { describe, expect, it } from 'vitest';

import { mountThroughReactNativeWeb } from '../../rnwMount.testSupport.js';
import type { HappierLayoutChangeEvent } from '../portableTypes.js';
import {
  createHappierCollectionDraftTitleStore,
  createHappierCollectionVisitMemory,
} from './collectionModel.js';
import { useHappierCollectionLayout } from './collectionLayout.js';
import { HappierListDetailLayout } from './ListDetailLayout.js';
import { useHappierCollection, useHappierCollectionVisit, type HappierCollectionModel } from './useCollection.js';

type Thing = Readonly<{ id: string }>;
const things: readonly Thing[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const keyOf = (thing: Thing) => thing.id;

function measure(container: HTMLElement, testID: string, width: number) {
  const box = container.querySelector(`[data-testid="${testID}"]`);
  const onLayout = (box as unknown as { __reactLayoutHandler: (event: HappierLayoutChangeEvent) => void })
    .__reactLayoutHandler;
  act(() => onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 600 } } }));
}

describe('Collection layout mode', () => {
  it('is published by the split geometry itself, so a detail page reads each mode in the render that measured it', () => {
    const modes: Array<string | null> = [];
    function DetailIndex(): ReactElement {
      const layout = useHappierCollectionLayout();
      modes.push(layout?.mode ?? null);
      return <Text>{layout?.mode ?? 'outside'}</Text>;
    }
    const mount = mountThroughReactNativeWeb(
      <>
        <DetailIndex />
        <HappierListDetailLayout
          testID="layout"
          list={null}
          detail={<DetailIndex />}
          detailActive
          minListWidth={272}
          minDetailWidth={480}
          preferredListRatio={0}
        />
      </>,
    );
    // Outside a collection there is no mode at all.
    expect(modes[0]).toBeNull();
    expect(modes.slice(1)).toEqual(['measuring']);

    modes.length = 0;
    measure(mount.container, 'layout', 1280);
    // One render per measured change: no `measuring` frame committed after the width is known.
    expect(modes).toEqual(['split']);

    // A resize that keeps the mode re-renders no reader.
    modes.length = 0;
    measure(mount.container, 'layout', 1300);
    expect(modes).toEqual([]);

    modes.length = 0;
    measure(mount.container, 'layout', 390);
    expect(modes).toEqual(['stacked']);
    mount.unmount();
  });
});

type Probe = { current: HappierCollectionModel<Thing> | null };

function Harness(props: Readonly<{
  probe: Probe;
  openKey: string | null;
  onOpenChange: (key: string | null) => void;
  memory?: ReturnType<typeof createHappierCollectionVisitMemory<string>>;
  ready?: boolean;
  draft?: Readonly<{ key: string; placeholder: string; titles: ReturnType<typeof createHappierCollectionDraftTitleStore> }> | null;
  expandable?: boolean;
}>): ReactElement {
  const model = useHappierCollection({
    items: things,
    keyOf,
    openKey: props.openKey,
    onOpenChange: props.onOpenChange,
    ...(props.expandable ? { expandable: true } : {}),
    ...(props.memory ? { initialSelection: { memory: props.memory, ready: props.ready ?? true } } : {}),
    ...(props.draft ? { draft: props.draft } : {}),
  });
  props.probe.current = model;
  return <Text>{model.openKey ?? 'none'}</Text>;
}

describe('useHappierCollectionVisit', () => {
  it('records the item a route opens, once per item, and ignores routes that open nothing', async () => {
    const recorded: string[] = [];
    const record = (visit: string) => { recorded.push(visit); };
    function Layout(props: Readonly<{ visit: string | null }>) {
      useHappierCollectionVisit(record, props.visit, (visit) => visit);
      return null;
    }
    const mount = mountThroughReactNativeWeb(<Layout visit={null} />);
    expect(recorded).toEqual([]);
    await mount.render(<Layout visit="b" />);
    await mount.render(<Layout visit="b" />);
    await mount.render(<Layout visit={null} />);
    await mount.render(<Layout visit="c" />);
    expect(recorded).toEqual(['b', 'c']);
    mount.unmount();
  });
});

describe('useHappierCollection', () => {
  it('leaves the open item to the route: open() asks, and only a new openKey changes it and records the visit', async () => {
    const probe: Probe = { current: null };
    const memory = createHappierCollectionVisitMemory<string>();
    const asked: Array<string | null> = [];
    const mount = mountThroughReactNativeWeb(
      <Harness probe={probe} openKey={null} onOpenChange={(key) => asked.push(key)} memory={memory} />,
    );
    act(() => probe.current!.actions.open('b'));
    expect(asked).toEqual(['b']);
    expect(probe.current!.openKey).toBeNull();
    expect(memory.read()).toBeNull();

    await mount.render(<Harness probe={probe} openKey="b" onOpenChange={(key) => asked.push(key)} memory={memory} />);
    expect(probe.current!.openKey).toBe('b');
    expect(memory.read()).toBe('b');

    act(() => probe.current!.actions.close());
    expect(asked).toEqual(['b', null]);
    mount.unmount();
  });

  it('lands on the last visited item beside a detail, never while stacked or before the items are known', async () => {
    const probe: Probe = { current: null };
    const memory = createHappierCollectionVisitMemory<string>();
    memory.record('c');
    function Wide(props: Readonly<{ ready: boolean }>) {
      return (
        <HappierListDetailLayout
          testID="layout"
          list={null}
          detail={<Harness probe={probe} openKey={null} onOpenChange={() => {}} memory={memory} ready={props.ready} />}
          detailActive
          minListWidth={272}
          minDetailWidth={480}
          preferredListRatio={0}
        />
      );
    }
    const mount = mountThroughReactNativeWeb(<Wide ready={false} />);
    expect(probe.current!.landingKey).toBeNull();
    measure(mount.container, 'layout', 1280);
    expect(probe.current!.landingKey).toBeNull();
    await mount.render(<Wide ready />);
    expect(probe.current!.landingKey).toBe('c');

    memory.record('gone');
    await mount.render(<Wide ready />);
    expect(probe.current!.landingKey).toBe('a');

    measure(mount.container, 'layout', 390);
    expect(probe.current!.landingKey).toBeNull();
    mount.unmount();
  });

  it('treats an open draft as a first-class item: listed first, open, and titled as it is typed', async () => {
    const probe: Probe = { current: null };
    const titles = createHappierCollectionDraftTitleStore();
    const draft = { key: 'draft:new', placeholder: 'New thing', titles };
    const mount = mountThroughReactNativeWeb(
      <Harness probe={probe} openKey="draft:new" onOpenChange={() => {}} draft={draft} />,
    );
    expect(probe.current!.keys).toEqual(['draft:new', 'a', 'b', 'c']);
    expect(probe.current!.draft).toEqual({ key: 'draft:new', placeholder: 'New thing', titles, open: true });

    let draftRenders = 0;
    function DraftTitle() {
      draftRenders += 1;
      return <Text testID="draft-title">{titles.useTitle() || 'New thing'}</Text>;
    }
    await mount.render(
      <>
        <Harness probe={probe} openKey="draft:new" onOpenChange={() => {}} draft={draft} />
        <DraftTitle />
      </>,
    );
    const rendersBefore = draftRenders;
    act(() => titles.publish('Build box'));
    expect(mount.container.querySelector('[data-testid="draft-title"]')?.textContent).toBe('Build box');
    expect(draftRenders).toBe(rendersBefore + 1);
    mount.unmount();
  });

  it('dispatches the list keys: arrows move focus only, Enter opens, Space peeks where allowed, Esc closes', async () => {
    const probe: Probe = { current: null };
    const asked: Array<string | null> = [];
    function Stateful() {
      const [openKey, setOpenKey] = useState<string | null>('a');
      return (
        <Harness
          probe={probe}
          openKey={openKey}
          expandable
          onOpenChange={(key) => { asked.push(key); setOpenKey(key); }}
        />
      );
    }
    const mount = mountThroughReactNativeWeb(<Stateful />);
    act(() => { expect(probe.current!.actions.handleKey('ArrowDown')).toBe(true); });
    expect(probe.current!.focusKey).toBe('b');
    expect(asked).toEqual([]);

    act(() => { probe.current!.actions.handleKey(' '); });
    expect([...probe.current!.expanded]).toEqual(['b']);

    act(() => { probe.current!.actions.handleKey('Enter'); });
    expect(probe.current!.openKey).toBe('b');

    act(() => { probe.current!.actions.handleKey('Escape'); });
    expect(probe.current!.openKey).toBeNull();
    expect(asked).toEqual(['b', null]);
    expect(probe.current!.actions.handleKey('x')).toBe(false);
    mount.unmount();
  });
});
