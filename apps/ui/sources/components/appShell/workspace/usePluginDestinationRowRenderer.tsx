import * as React from 'react';
import { normalizePluginUiSubPathV1, type PluginUiDestinationReferenceV1 } from '@happier-dev/protocol/plugins/ui';
import { hrefForDestinationRef, useCompactAppDestinations } from '../destinations/compactAppDestinationCatalog';
import { WorkspaceDestinationRow } from './WorkspaceDestinationRow';

type DestinationRowInput = Omit<import('@/components/plugins/surfaces/pluginUiPrivatePresentationHost').PluginDestinationRowInput, 'destination'>
    & Readonly<{ destination: PluginUiDestinationReferenceV1 }>;

/** The public qualified page descriptor reaches the same catalog and workspace owner as shell rows. */
export function usePluginDestinationRowRenderer() {
    const catalog = useCompactAppDestinations();
    const pages = React.useMemo(() => new Map(catalog.flatMap(page => page.kind === 'plugin'
        && page.container === 'appPage' && page.availability === 'available' && page.activation === 'navigate'
        ? [[JSON.stringify([page.destination.pluginId, page.destination.localId]), page] as const] : [])), [catalog]);
    return React.useCallback((input: DestinationRowInput) => {
        const page = pages.get(JSON.stringify([input.destination.pluginId, input.destination.localId]));
        const subPath = normalizePluginUiSubPathV1(input.subPath ?? '');
        const href = page && subPath !== null ? hrefForDestinationRef(catalog, { kind: page.id, params: {
            ...page.destination, ...(subPath ? { subPath } : {}),
        } }) : null;
        if (!href) return input.children;
        if (!input.renderWithSecondaryActions) return <WorkspaceDestinationRow href={href}>{input.children}</WorkspaceDestinationRow>;
        const renderWithSecondaryActions = input.renderWithSecondaryActions;
        return <WorkspaceDestinationRow href={href} existingMenu>{actions => renderWithSecondaryActions({
            secondaryActions: actions.items.map(item => ({ id: item.id, label: item.title, disabled: item.disabled })),
            onSecondaryAction: id => { actions.select(id); },
        })}</WorkspaceDestinationRow>;
    }, [catalog, pages]);
}
