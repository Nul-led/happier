import * as React from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import type { PopoverAnchor } from '@/components/ui/popover';
import { encodeWorkspaceDragData } from './workspaceDragData';
import { resolveWorkspaceOpenModeFromPointer, useWorkspaceOpenActions } from './useWorkspaceOpenActions';

type WorkspaceDestinationRowProps = Readonly<{
    href: string | null;
    children: React.ReactNode | ((actions: ReturnType<typeof useWorkspaceOpenActions>) => React.ReactNode);
    style?: StyleProp<ViewStyle>;
    /** Rows with an existing menu already include useWorkspaceOpenActions.items there. */
    existingMenu?: boolean;
}>;

/** Destination gestures share one owner, without replacing the row's normal activation or anatomy. */
export function WorkspaceDestinationRow(props: WorkspaceDestinationRowProps) {
    if (!props.href && typeof props.children !== 'function') return props.style ? <View style={props.style}>{props.children}</View> : <>{props.children}</>;
    return <WorkspaceDestinationRowDestination {...props} />;
}

function WorkspaceDestinationRowDestination(props: WorkspaceDestinationRowProps) {
    const actions = useWorkspaceOpenActions(props.href);
    const [anchor, setAnchor] = React.useState<PopoverAnchor | null>(null);
    const latest = React.useRef({ actions, props });
    latest.current = { actions, props };
    const detach = React.useRef<(() => void) | null>(null);
    const host = React.useRef<HTMLElement | null>(null);
    const enabled = actions.items.length > 0;
    React.useEffect(() => {
        host.current?.setAttribute('draggable', enabled ? 'true' : 'false');
    }, [enabled]);
    React.useEffect(() => () => detach.current?.(), []);
    const attach = React.useCallback((node: unknown) => {
        detach.current?.();
        detach.current = null;
        host.current = null;
        if (Platform.OS !== 'web') return;
        const element = node as HTMLElement | null;
        if (!element?.addEventListener) return;
        host.current = element;
        element.setAttribute('draggable', latest.current.actions.items.length > 0 ? 'true' : 'false');
        // A row's secondary controls keep their own actions (disclosure, selection, pin, overflow).
        const primaryControlSelector = 'button, [role="button"], [role="tab"], [role="treeitem"], [role="option"], [role="menuitem"], a[href], [role="link"]';
        const secondaryControl = (event: Event) => {
            const target = event.target as Element | null;
            const control = target?.closest?.(`${primaryControlSelector}, input, [role="checkbox"]`);
            return control !== null && control !== undefined
                && control !== element.querySelector(primaryControlSelector);
        };
        const pointer = (event: Event) => {
            if (event.defaultPrevented || secondaryControl(event)) return;
            const mode = resolveWorkspaceOpenModeFromPointer(event);
            if (mode && latest.current.actions.open(mode)) {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        const context = (event: MouseEvent) => {
            if (latest.current.props.existingMenu || !latest.current.actions.items.length || secondaryControl(event)) return;
            event.preventDefault();
            event.stopPropagation();
            setAnchor({ kind: 'rect', rect: { left: event.clientX, top: event.clientY, height: 1 }, coordinateSpace: 'window' });
        };
        const drag = (event: DragEvent) => {
            const { href } = latest.current.props;
            if (!href || !latest.current.actions.items.length || !event.dataTransfer || secondaryControl(event)) return;
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData('text/plain', encodeWorkspaceDragData({ kind: 'href', href }));
            event.stopPropagation();
        };
        element.addEventListener('click', pointer, true);
        element.addEventListener('auxclick', pointer, true);
        element.addEventListener('contextmenu', context);
        element.addEventListener('dragstart', drag);
        detach.current = () => {
            element.removeEventListener('click', pointer, true);
            element.removeEventListener('auxclick', pointer, true);
            element.removeEventListener('contextmenu', context);
            element.removeEventListener('dragstart', drag);
        };
    }, []);
    return <View ref={attach} style={props.style}>
        {typeof props.children === 'function' ? props.children(actions) : props.children}
        {!props.existingMenu && anchor !== null ? <DropdownMenu
            open={anchor !== null}
            onOpenChange={(open) => { if (!open) setAnchor(null); }}
            popoverAnchor={anchor ?? undefined}
            items={actions.items}
            onSelect={(id) => { actions.select(id); setAnchor(null); }}
            placement="bottom"
            variant="slim"
            matchTriggerWidth={false}
            popoverPortalWebTarget="body"
            trigger={() => null}
        /> : null}
    </View>;
}
