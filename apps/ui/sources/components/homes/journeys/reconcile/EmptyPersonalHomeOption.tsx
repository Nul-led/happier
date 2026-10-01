import * as React from 'react';

import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';
import { t } from '@/text';

import { useEmptyPersonalHomeRemoval, type EmptyPersonalHomeRemoval } from '../useEmptyPersonalHomeRemoval';

/**
 * The choice to remove the empty Personal Home when the sheet commits (on by default), and what that
 * commit runs. `removal` is null — and the row absent — unless the Home itself said it is empty.
 */
export function useEmptyPersonalHomeChoice(personal: ServerProfile | null): Readonly<{
    removal: EmptyPersonalHomeRemoval | null;
    remove: boolean;
    setRemove: (next: boolean) => void;
    /** Runs the removal when it is offered and chosen; safe to call either way. */
    commit: () => Promise<void>;
}> {
    const removal = useEmptyPersonalHomeRemoval(personal);
    const [remove, setRemove] = React.useState(true);
    const commit = React.useCallback(async () => {
        if (removal && remove) await removal.remove();
    }, [remove, removal]);
    return { removal, remove, setRemove, commit };
}

/** "Remove the empty Personal Home": shown only when the Home said it is empty. */
export function EmptyPersonalHomeOption(props: Readonly<{
    choice: ReturnType<typeof useEmptyPersonalHomeChoice>;
    detail: string;
}>) {
    const { choice } = props;
    if (!choice.removal) return null;
    return (
        <ItemGroup>
            <Item
                testID="homes-journeys.remove-empty-personal-home"
                title={t('homesJourneys.removeEmptyPersonalHome')}
                subtitle={props.detail}
                subtitleLines={0}
                showChevron={false}
                rightElement={(
                    <Switch
                        value={choice.remove}
                        onValueChange={choice.setRemove}
                        accessibilityLabel={t('homesJourneys.removeEmptyPersonalHome')}
                    />
                )}
            />
        </ItemGroup>
    );
}
