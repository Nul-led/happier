import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { describe, expect, it } from 'vitest';

import { mountThroughReactNativeWeb } from '../../rnwMount.testSupport.js';
import {
  HappierCollectionListGroupLabel,
  type HappierCollectionListHost,
  type HappierCollectionListTextRole,
} from '../collection/CollectionList.js';
import { HappierPageSheet, HappierPageSheetGroup, useHappierPageSection } from './PageSection.js';
import { HAPPIER_PAGE_METRICS } from './pageMetrics.js';

/**
 * The page-section sheet's structure inputs (unified-work lab W8/W9): the flat surface's row inset,
 * the section-level "no row dividers" switch, and the group boundary that draws one lighter,
 * content-width separator between groups — never above the first, never inside a group.
 */
const COLORS = {
  sheet: '#f1f2f3',
  sheetBorder: '#0a0b0c',
  rowDivider: '#070809',
  groupDivider: '#0b0c0d',
} as const;

function Row(props: Readonly<{ id: string; showDivider?: boolean }>) {
  // A probe row: it takes the sheet's row inset like a page row does, and says whether it was asked
  // to draw the hairline under it.
  const section = useHappierPageSection();
  return (
    <View testID={props.id} style={{ paddingLeft: section?.rowInsetPx, paddingRight: section?.rowInsetPx }}>
      <Text>{props.showDivider === true ? 'yes' : 'no'}</Text>
    </View>
  );
}

function separatorsIn(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="separator"]'));
}

function dividerFlags(root: Element, ids: readonly string[]): string[] {
  return ids.map((id) => root.querySelector(`[data-testid="${id}"]`)?.textContent ?? 'missing');
}

function mount(children: ReactNode) {
  return mountThroughReactNativeWeb(<View testID="root">{children}</View>);
}

describe('HappierPageSheet groups, row inset and row dividers', () => {
  it('lays a flat sheet out with its own row inset, no row hairlines, and one inset separator between groups', () => {
    const view = mount(
      <HappierPageSheet surface="none" colors={COLORS} rowInsetPx={9} rowDividers={false}>
        <HappierPageSheetGroup testID="group-a" header={<Text>When a turn ends</Text>}>
          <Row id="a1" />
          <Row id="a2" />
        </HappierPageSheetGroup>
        <HappierPageSheetGroup testID="group-b" header={<Text>When the session starts</Text>}>
          <Row id="b1" />
        </HappierPageSheetGroup>
        <HappierPageSheetGroup testID="group-c">
          <Row id="c1" />
        </HappierPageSheetGroup>
      </HappierPageSheet>,
    );
    const root = view.container.querySelector('[data-testid="root"]')!;

    expect(dividerFlags(root, ['a1', 'a2', 'b1', 'c1'])).toEqual(['no', 'no', 'no', 'no']);
    const separators = separatorsIn(root);
    // Above every group but the first: two for three groups.
    expect(separators).toHaveLength(2);
    for (const separator of separators) {
      expect(separator.style.backgroundColor).toBe('rgb(11, 12, 13)');
      // Content width: from the rows' text edge to their trailing edge, not the sheet's.
      expect(separator.style.marginLeft).toBe('9px');
      expect(separator.style.marginRight).toBe('9px');
    }
    // Each separator sits between two groups, never inside one.
    const groupB = root.querySelector('[data-testid="group-b"]')!;
    expect(groupB.contains(separators[0]!)).toBe(false);
    expect(separators[0]!.compareDocumentPosition(groupB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The header reads before its rows.
    expect(groupB.textContent?.indexOf('When the session starts')).toBe(0);
    // Rows take the sheet's inset instead of the page's.
    expect(root.querySelector<HTMLElement>('[data-testid="a1"]')!.style.paddingLeft).toBe('9px');
    // No sheet chrome on the flat surface.
    expect(Array.from(root.querySelectorAll<HTMLElement>('div')).some((element) => element.style.borderTopLeftRadius === '14px'))
      .toBe(false);
    view.unmount();
  });

  it('keeps row hairlines inside each group on the carded sheet and starts every later group with the separator', () => {
    const view = mount(
      <HappierPageSheet colors={COLORS}>
        <HappierPageSheetGroup>
          <Row id="a1" />
          <Row id="a2" />
        </HappierPageSheetGroup>
        <HappierPageSheetGroup>
          <Row id="b1" />
          <Row id="b2" />
        </HappierPageSheetGroup>
      </HappierPageSheet>,
    );
    const root = view.container.querySelector('[data-testid="root"]')!;

    // A group's last row draws no hairline: the group separator replaces it.
    expect(dividerFlags(root, ['a1', 'a2', 'b1', 'b2'])).toEqual(['yes', 'no', 'yes', 'no']);
    const separators = separatorsIn(root);
    expect(separators).toHaveLength(1);
    expect(separators[0]!.style.marginLeft).toBe(`${HAPPIER_PAGE_METRICS.rowPaddingHorizontalPx}px`);
    expect(root.querySelector<HTMLElement>('[data-testid="a1"]')!.style.paddingLeft)
      .toBe(`${HAPPIER_PAGE_METRICS.rowPaddingHorizontalPx}px`);
    view.unmount();
  });

  it('keeps an ungrouped sheet exactly as before: hairlines between rows, none after the last, no group separator', () => {
    const view = mount(
      <HappierPageSheet colors={COLORS}>
        <Row id="r1" />
        <Row id="r2" />
        <Row id="r3" showDivider={false} />
      </HappierPageSheet>,
    );
    const root = view.container.querySelector('[data-testid="root"]')!;
    expect(dividerFlags(root, ['r1', 'r2', 'r3'])).toEqual(['yes', 'yes', 'no']);
    expect(separatorsIn(root)).toHaveLength(0);
    view.unmount();
  });

  it('draws a group label inside a sheet as the group sub-heading, on the rows’ inset', () => {
    const roles: HappierCollectionListTextRole[] = [];
    const host: HappierCollectionListHost = {
      Text: (props) => {
        roles.push(props.role);
        return <Text>{props.children}</Text>;
      },
      Scroller: (props) => <View>{props.children}</View>,
      SearchField: () => null,
      surfaceStyle: null,
    };
    const view = mount(
      <>
        <HappierCollectionListGroupLabel host={host} title="Built-in" />
        <HappierPageSheet surface="none" colors={COLORS} rowInsetPx={9} rowDividers={false}>
          <HappierPageSheetGroup header={<HappierCollectionListGroupLabel host={host} title="When a turn ends" count={2} />}>
            <Row id="a1" />
          </HappierPageSheetGroup>
        </HappierPageSheet>
      </>,
    );
    const root = view.container.querySelector('[data-testid="root"]')!;

    // In a navigation column the label stays the quiet group title; in a sheet it is a heading.
    expect(roles).toEqual(['groupTitle', 'groupHeading', 'groupCount']);
    const labels = Array.from(root.querySelectorAll<HTMLElement>('[role="heading"]'));
    expect(labels).toHaveLength(2);
    expect(labels[1]!.style.paddingLeft).toBe('9px');
    expect(labels[1]!.style.paddingRight).toBe('9px');
    view.unmount();
  });
});
