import * as React from 'react';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';

type ConnectionTargetListProps = Readonly<{
    title: string;
    accessibilityLabel: string;
    actions: ReadonlyArray<{
        id: string;
        label: string;
        accessibilityLabel?: string;
        subtitle?: string;
        icon?: React.ReactNode;
        right?: React.ReactNode;
        selected?: boolean;
        disabled?: boolean;
        onPress: () => void;
    }>;
}>;

export function ConnectionTargetList(props: ConnectionTargetListProps) {
    if (props.actions.length === 0) return null;
    return (
        <ItemGroup
            title={props.title}
            accessibilityRole="radiogroup"
            accessibilityLabel={props.accessibilityLabel}
            selectableItemCountOverride={props.actions.length}
        >
            {props.actions.map((action) => (
                <Item
                    key={action.id}
                    title={action.label}
                    subtitle={action.subtitle}
                    icon={action.icon}
                    rightElement={action.right}
                    selected={action.selected}
                    disabled={action.disabled}
                    onPress={action.onPress}
                    accessibilityRole="radio"
                    accessibilityLabel={action.accessibilityLabel}
                    showChevron={false}
                    density="cozy"
                />
            ))}
        </ItemGroup>
    );
}
