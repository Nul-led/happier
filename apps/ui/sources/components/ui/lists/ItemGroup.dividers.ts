import * as React from 'react';
import { HappierPageSheetGroup } from '@happier-dev/plugin-ui/presentation';
import { ItemGroupRowPositionProvider, type ItemGroupRowPosition } from './ItemGroupRowPosition';

type DividerChildProps = {
    showDivider?: boolean;
};

type FragmentProps = {
    children?: React.ReactNode;
};

export type ItemGroupVirtualizedSegment = Readonly<{
    first: boolean;
    last: boolean;
}>;

/**
 * Flattens an ItemGroup's children to the renderable element rows, splicing
 * fragments into the sequence and dropping primitives (whitespace/`0`) that
 * would otherwise become invalid `View` text nodes. Shared by both row-position
 * owners below so a fragment counts identically in either layout.
 */
export function flattenItemGroupElementChildren(node: React.ReactNode, keyPrefix = ''): React.ReactElement[] {
    return React.Children.toArray(node).reduce<React.ReactElement[]>((rows, child) => {
        if (!React.isValidElement(child)) return rows;
        if (child.type === React.Fragment) {
            const fragment = child as React.ReactElement<FragmentProps>;
            // A fragment's rows are keyed under the fragment, so they never collide with their siblings'.
            rows.push(...flattenItemGroupElementChildren(fragment.props.children, `${keyPrefix}${String(fragment.key)}`));
            return rows;
        }
        rows.push(keyPrefix === '' ? child : React.cloneElement(child, { key: `${keyPrefix}${String(child.key)}` }));
        return rows;
    }, []);
}

export function withItemGroupDividers(
    children: React.ReactNode,
    virtualizedSegment?: ItemGroupVirtualizedSegment,
): React.ReactNode {
    const stripNonElementChildren = (node: React.ReactNode): React.ReactNode => {
        return React.Children.map(node, (child) => {
            if (!React.isValidElement(child)) {
                return null;
            }
            if (child.type === React.Fragment) {
                const fragment = child as React.ReactElement<FragmentProps>;
                return React.cloneElement(fragment, {}, stripNonElementChildren(fragment.props.children));
            }
            return child;
        });
    };

    const countNonFragmentElements = (node: React.ReactNode): number => {
        return React.Children.toArray(node).reduce<number>((count, child) => {
            if (!React.isValidElement(child)) {
                return count;
            }
            if (child.type === React.Fragment) {
                const fragment = child as React.ReactElement<FragmentProps>;
                return count + countNonFragmentElements(fragment.props.children);
            }
            return count + 1;
        }, 0);
    };

    const total = countNonFragmentElements(children);
    if (total === 0) return null;

    const elementChildren = stripNonElementChildren(children);

    let index = 0;
    const apply = (node: React.ReactNode): React.ReactNode => {
        return React.Children.map(node, (child) => {
            if (!React.isValidElement(child)) {
                return child;
            }
            if (child.type === React.Fragment) {
                const fragment = child as React.ReactElement<FragmentProps>;
                return React.cloneElement(fragment, {}, apply(fragment.props.children));
            }

            const isFirst = index === 0 && virtualizedSegment?.first !== false;
            const isLast = index === total - 1 && virtualizedSegment?.last !== false;
            index += 1;

            const element = child as React.ReactElement<DividerChildProps>;
            const showDivider = !isLast && element.props.showDivider !== false;
            const wrapperKey = element.key ?? `row-${index - 1}`;
            return React.createElement(
                ItemGroupRowPositionProvider,
                { key: wrapperKey as any, value: { isFirst, isLast } },
                React.cloneElement(element, { showDivider }),
            );
        });
    };

    return apply(elementChildren);
}

type ItemGroupSheetRowProps = Readonly<{
    position: ItemGroupRowPosition;
    /** The section goes on in the next virtualized chunk, so this chunk's last row keeps its hairline. */
    continuesAfter: boolean;
    /** The sheet's decision (`HappierPageSheet`); until the sheet sets it, the row's own opt-out. */
    showDivider?: boolean;
    children: React.ReactElement<DividerChildProps>;
}>;

function ItemGroupSheetRow(props: ItemGroupSheetRowProps) {
    const row = props.children;
    const showDivider = props.showDivider === true || (props.continuesAfter && row.props.showDivider !== false);
    return React.createElement(
        ItemGroupRowPositionProvider,
        { value: props.position },
        React.cloneElement(row, { showDivider }),
    );
}

function isSheetGroup(element: React.ReactElement): element is React.ReactElement<FragmentProps> {
    return element.type === HappierPageSheetGroup;
}

/**
 * A page section's rows, ready for `HappierPageSheet`: the sheet decides the hairlines and lays out its
 * `HappierPageSheetGroup`s; this adds what a core section owes on top of it. Each row learns its
 * position in the section (a highlighted first or last row follows the sheet's corners), and a
 * virtualized chunk that the section continues past keeps the hairline under its last row.
 */
export function withItemGroupSheetRows(
    children: React.ReactNode,
    virtualizedSegment?: ItemGroupVirtualizedSegment,
): React.ReactNode {
    const entries = flattenItemGroupElementChildren(children);
    const rowsOf = (entry: React.ReactElement) => (isSheetGroup(entry)
        ? flattenItemGroupElementChildren(entry.props.children)
        : [entry]);
    const total = entries.reduce((count, entry) => count + rowsOf(entry).length, 0);
    let index = 0;
    const position = (row: React.ReactElement) => {
        const lastInChunk = index === total - 1;
        const element = React.createElement(ItemGroupSheetRow, {
            key: row.key,
            position: {
                isFirst: index === 0 && virtualizedSegment?.first !== false,
                isLast: lastInChunk && virtualizedSegment?.last !== false,
            },
            continuesAfter: lastInChunk && virtualizedSegment?.last === false,
            showDivider: (row.props as DividerChildProps).showDivider,
            children: row as React.ReactElement<DividerChildProps>,
        });
        index += 1;
        return element;
    };
    return entries.map((entry) => (isSheetGroup(entry)
        ? React.cloneElement(entry, undefined, ...rowsOf(entry).map(position))
        : position(entry)));
}
