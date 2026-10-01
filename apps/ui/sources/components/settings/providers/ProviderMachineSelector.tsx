import * as React from 'react';

import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { SafeIonicons } from '@/components/ui/icons/SafeIonicons';
import { t } from '@/text';
import { resolveMachineDisplayNames } from '@/utils/sessions/machineDisplayNames';

type ProviderMachineOption = Readonly<{
    id: string;
    active?: boolean | null;
    metadata?: Readonly<{ displayName?: string; host?: string }> | null;
}>;

export const ProviderMachineSelector = React.memo(function ProviderMachineSelector(props: Readonly<{
    machines: readonly ProviderMachineOption[];
    selectedId: string | null;
    onSelect: (machineId: string) => void;
}>) {
    const [open, setOpen] = React.useState(false);
    const items = React.useMemo<readonly DropdownMenuItem[]>(() => {
        const names = resolveMachineDisplayNames(props.machines);
        return props.machines.map((machine) => ({
        id: machine.id,
        title: names.get(machine.id) ?? machine.id,
        subtitle: machine.active ? t('settingsProviders.detail.machineOnline') : t('settingsProviders.detail.machineOffline'),
        }));
    }, [props.machines]);
    if (items.length <= 1) return null;
    return (
        <DropdownMenu
            open={open}
            onOpenChange={setOpen}
            variant="selectable"
            search={items.length >= 10}
            selectedId={props.selectedId}
            showCategoryTitles={false}
            rowKind="item"
            itemTrigger={{
                title: t('settingsProviders.detail.targetMachine'),
                subtitle: items.find((item) => item.id === props.selectedId)?.title,
                showSelectedDetail: false,
                showSelectedSubtitle: false,
            }}
            items={items}
            onSelect={props.onSelect}
        />
    );
});
