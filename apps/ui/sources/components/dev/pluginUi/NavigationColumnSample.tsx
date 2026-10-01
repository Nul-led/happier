import * as React from 'react';
import { NavigationList } from '@happier-dev/plugin-ui';

import { Icon } from '@/components/ui/icons/Icon';
import {
    CollectionList,
    CollectionListGroupLabel,
    CollectionNavigationRow,
} from '@/components/ui/lists/collection/CollectionList';

// The same glyph in each half: core's registry name and the plugin vocabulary token.
const VIEWS = [
    { id: 'review', title: 'Needs my review', coreIcon: 'git-pull-request', pluginIcon: 'change-open' },
    { id: 'mine', title: 'Opened by me', coreIcon: 'eye', pluginIcon: 'preview' },
    { id: 'failing', title: 'Checks failing', coreIcon: 'warning', pluginIcon: 'warning' },
] as const;

/**
 * The same navigation column twice, for the rhythm side-by-side (shell extensibility O4): Happier
 * core's column (the Settings/Plugins columns' binding) and a plugin's public `NavigationList`. Each
 * lies on the shell's plane, painted by the caller.
 */
export function CoreNavigationColumnSample() {
    const [open, setOpen] = React.useState<string>('review');
    return (
        <CollectionList testID="dev-navigation-column-core" surface="plane" title="Views" count={VIEWS.length}>
            <CollectionNavigationRow testID="dev-core-all" title="All pull requests" icon={<Icon name="globe" />} selected={open === 'all'} onPress={() => setOpen('all')} />
            <CollectionListGroupLabel title="Saved" count={VIEWS.length} />
            {VIEWS.map((view) => (
                <CollectionNavigationRow
                    key={view.id}
                    testID={`dev-core-${view.id}`}
                    title={view.title}
                    icon={<Icon name={view.coreIcon} />}
                    selected={open === view.id}
                    onPress={() => setOpen(view.id)}
                />
            ))}
        </CollectionList>
    );
}

/** The plugin half: public components only, mounted through the plugin surface entry. */
export function PluginNavigationColumnSample() {
    const [open, setOpen] = React.useState<string>('review');
    return (
        <NavigationList testID="dev-navigation-column-plugin" title="Views" count={VIEWS.length}>
            <NavigationList.Row testID="dev-plugin-all" title="All pull requests" icon="globe" selected={open === 'all'} onPress={() => setOpen('all')} />
            <NavigationList.Group title="Saved" count={VIEWS.length}>
                {VIEWS.map((view) => (
                    <NavigationList.Row
                        key={view.id}
                        testID={`dev-plugin-${view.id}`}
                        title={view.title}
                        icon={view.pluginIcon}
                        selected={open === view.id}
                        onPress={() => setOpen(view.id)}
                    />
                ))}
            </NavigationList.Group>
        </NavigationList>
    );
}
