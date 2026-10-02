import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import type { SelectionListFilter, SelectionListInputBehavior } from '@/components/ui/selectionList';
import { t } from '@/text';

/**
 * The palette's Terminals scope token (terminal lab B4): the same scope chip as the Home chip, on
 * while Search is narrowed to one session's terminals. Its × — or ⌫ on an empty field — drops the
 * scope back to searching everything.
 */
export function useTerminalJumpScopeChrome(active: boolean, onLeave: () => void): Readonly<{
    filters: ReadonlyArray<SelectionListFilter> | undefined;
    inputBehavior: SelectionListInputBehavior | undefined;
}> {
    const { theme } = useUnistyles();
    const leave = React.useRef(onLeave);
    leave.current = onLeave;
    const filters = React.useMemo<ReadonlyArray<SelectionListFilter> | undefined>(() => active ? [{
        id: 'terminals',
        label: t('terminalWorkspace.jump.scope'),
        valueLabel: t('terminalWorkspace.jump.scope'),
        icon: <Icon name="terminal" size={12} color={theme.colors.text.secondary} />,
        onClear: () => leave.current(),
        clearAccessibilityLabel: t('terminalWorkspace.jump.clearScopeA11y'),
        testID: 'universal-search:terminals-scope',
    }] : undefined, [active, theme.colors.text.secondary]);
    const inputBehavior = React.useMemo<SelectionListInputBehavior | undefined>(() => active ? {
        onBackspaceAtEnd: (input) => {
            if (input.length > 0) return null;
            leave.current();
            return '';
        },
    } : undefined, [active]);
    return { filters, inputBehavior };
}
