import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { ComputerAccessV1, ComputerSelectedTargetResponseV1 } from '@happier-dev/protocol';

import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import type { CustomModalChromeConfig, CustomModalInjectedProps } from '@/modal/types';
import {
    createComputerControlClient,
    type ComputerActionExecute,
    type ComputerSessionScope,
} from '@/sync/domains/computer/computerControlClient';
import { createFrontDoorActionExecute } from '@/sync/ops/actions/frontDoorRuntimeActionExecutor';
import { isActionApprovalRequiredInState } from '@/sync/domains/settings/actionsSettings';
import { getStorage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { useDeviceType } from '@/utils/platform/responsive';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import {
    ComputerTargetPicker,
    computerTargetKey,
    resolveSuggestedTargetKey,
    type ComputerTargetEntry,
    type ComputerTargetPickerState,
} from './ComputerTargetPicker';
import type { ComputerOpenSettingsState } from './ComputerPermissionCard';

const stylesheet = StyleSheet.create((theme) => ({
    machine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: theme.colors.surface.inset,
    },
    machineText: {
        ...Typography.rowMeta(),
        color: theme.colors.text.primary,
    },
}));

/** The machine the request names, as identity (not a switch: the Session's request fixes the machine). */
function MachineIdentity(props: Readonly<{ name: string }>): React.ReactElement {
    const { theme } = useUnistyles();
    return (
        <View style={stylesheet.machine} accessibilityLabel={props.name} testID="computer-target-picker-machine">
            <Icon name="laptop" size={ICON_SIZE.sm} color={theme.colors.text.secondary} />
            <Text style={stylesheet.machineText} numberOfLines={1}>{props.name}</Text>
        </View>
    );
}

/** The picker's card: the act as title, the promise as subtitle, the machine as identity. */
export function computerTargetPickerChrome(params: Readonly<{ agentName: string; machineName: string; purpose?: string | null }>): CustomModalChromeConfig {
    const promise = t('computerUse.picker.description', { agent: params.agentName });
    return {
        kind: 'card',
        testID: 'computer-target-picker-modal',
        title: t('computerUse.picker.title', { agent: params.agentName }),
        // For which Session (and where), then the promise (lab TP).
        subtitle: params.purpose ? `${params.purpose} ${promise}` : promise,
        actions: <MachineIdentity name={params.machineName} />,
        dimensions: { width: 560, maxHeightRatio: 0.9, size: 'md' },
        // A phone gets the lab's bottom sheet, in thumb reach.
        phonePresentation: 'sheet',
    };
}

type PickerModalProps = CustomModalInjectedProps & Readonly<{
    scope: ComputerSessionScope;
    agentName: string;
    machineName: string;
    currentTargetKey: string | null;
    access?: ComputerAccessV1;
    /** The agent's suggestion while approving its `computer.target.select` (W15 `requestedTarget`). */
    requestedTarget?: string | null;
    /**
     * Approval mode: the pick goes back to the approval (W15 `approval.request.decide.computerTarget`)
     * instead of being shared directly; approving is what shares it, with the agent's provenance.
     */
    onChosen?: (entry: ComputerTargetEntry, access: ComputerAccessV1) => void;
    /** The request cannot be served here (another machine than the Session's): show why, list nothing. */
    refusalCode?: string;
    execute?: ComputerActionExecute;
    onSelected: (selection: ComputerSelectedTargetResponseV1) => void;
    onStoppedSharing?: () => void;
}>;

let frontDoorExecute: ComputerActionExecute | null = null;

/** The picker's data leaf: the machine's own list, the share, and the permission pane, all through W7's owner. */
export function ComputerTargetPickerModal(props: PickerModalProps): React.ReactElement {
    const execute = props.execute ?? (frontDoorExecute ??= createFrontDoorActionExecute());
    const { serverId, sessionId, machineId } = props.scope;
    const client = React.useMemo(
        () => createComputerControlClient({ serverId, sessionId, machineId }, execute),
        [execute, machineId, serverId, sessionId],
    );
    const [state, setState] = React.useState<ComputerTargetPickerState>(
        props.refusalCode ? { kind: 'failed', code: props.refusalCode } : { kind: 'loading' });
    const [selectedKey, setSelectedKey] = React.useState<string | null>(props.currentTargetKey);
    const [access, setAccess] = React.useState<ComputerAccessV1>(props.access ?? 'use');
    const [suggestedKey, setSuggestedKey] = React.useState<string | null>(null);
    const [sharing, setSharing] = React.useState(false);
    const [noticeCode, setNoticeCode] = React.useState<string | null>(null);
    const [openSettings, setOpenSettings] = React.useState<ComputerOpenSettingsState>('idle');
    const [attempt, setAttempt] = React.useState(0);

    const refusalCode = props.refusalCode;
    const requestedTarget = props.requestedTarget ?? null;
    React.useEffect(() => {
        if (refusalCode) return undefined;
        let current = true;
        // Keep what is on screen while re-reading (Check again): never flash the loading state over a list.
        setState((previous) => (previous.kind === 'ready' ? previous : { kind: 'loading' }));
        void client.listTargets().then((result) => {
            if (!current) return;
            setState(result.ok
                ? { kind: 'ready', targets: result.value.targets, grants: result.value.grants, displays: result.value.displays }
                : { kind: 'failed', code: result.code });
            if (result.ok) {
                // The agent's suggestion starts chosen (and marked) until the person picks another.
                const suggested = resolveSuggestedTargetKey(result.value.targets, requestedTarget);
                setSuggestedKey(suggested);
                if (suggested) setSelectedKey((current) => current ?? suggested);
            }
        });
        return () => { current = false; };
    }, [attempt, client, refusalCode, requestedTarget]);

    const retry = React.useCallback(() => setAttempt((value) => value + 1), []);
    // The person's own Ask-first preferences for the agent (the existing Actions approval owner).
    const asksBeforeScreenshots = getStorage()((current) => isActionApprovalRequiredInState(current, 'computer.capture', { surface: 'agent' }));
    const asksBeforeInput = getStorage()((current) => isActionApprovalRequiredInState(current, 'computer.input', { surface: 'agent' }));
    const policy = React.useMemo(() => ({ asksBeforeScreenshots, asksBeforeInput }), [asksBeforeInput, asksBeforeScreenshots]);
    const router = useRouter();
    const compact = useDeviceType() === 'phone';
    const changePolicy = React.useCallback(() => {
        props.onClose();
        router.push('/settings/actions');
    }, [props, router]);
    const { onClose, onSelected, onStoppedSharing, onChosen } = props;
    const share = React.useCallback(() => {
        if (state.kind !== 'ready') return;
        const chosen = state.targets.find((entry) => computerTargetKey(entry.target) === selectedKey);
        if (!chosen) return;
        if (onChosen) {
            onChosen(chosen, access);
            onClose();
            return;
        }
        setSharing(true);
        setNoticeCode(null);
        void client.selectTarget(chosen.target, access).then((result) => {
            setSharing(false);
            if (result.ok) {
                onSelected(result.value);
                onClose();
                return;
            }
            setNoticeCode(result.code);
            if (result.code === 'computer_target_not_available') retry();
        });
    }, [access, client, onChosen, onClose, onSelected, retry, selectedKey, state]);
    const stopSharing = React.useCallback(() => {
        void client.stopSharing().then((result) => {
            if (result.ok && result.value.status === 'dispatched') {
                onStoppedSharing?.();
                onClose();
                return;
            }
            setNoticeCode(result.ok ? (result.value.status === 'failed' ? result.value.code : 'control_not_drained') : result.code);
        });
    }, [client, onClose, onStoppedSharing]);
    const requestSettings = React.useCallback((permission: 'capture' | 'input') => {
        setOpenSettings('opening');
        void client.openSettings(permission).then((result) => {
            setOpenSettings(result.ok && result.value.status === 'dispatched' ? 'opened' : 'failed');
        });
    }, [client]);

    return (
        <ComputerTargetPicker
            machineName={props.machineName}
            state={state}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            access={access}
            onAccessChange={setAccess}
            sharing={sharing}
            noticeCode={noticeCode}
            canStopSharing={props.currentTargetKey !== null}
            onShare={share}
            onStopSharing={stopSharing}
            onCancel={onClose}
            onRetry={retry}
            onOpenSettings={requestSettings}
            openSettings={openSettings}
            agentName={props.agentName}
            policy={policy}
            onChangePolicy={changePolicy}
            compact={compact}
            suggestedKey={suggestedKey}
        />
    );
}

/**
 * Open the one target picker (lab `computer` TP): from the first consent, from an agent's
 * `target_selection_required` result, or from the viewer's Change window.
 */
export function showComputerTargetPicker(params: Readonly<{
    scope: ComputerSessionScope;
    agentName: string;
    machineName: string;
    /** "For “<session>” in <project>." */
    purpose?: string | null;
    currentTargetKey?: string | null;
    access?: ComputerAccessV1;
    refusalCode?: string;
    requestedTarget?: string | null;
    onChosen?: (entry: ComputerTargetEntry, access: ComputerAccessV1) => void;
    onSelected: (selection: ComputerSelectedTargetResponseV1) => void;
    onStoppedSharing?: () => void;
}>): void {
    Modal.show({
        component: ComputerTargetPickerModal,
        props: {
            scope: params.scope,
            agentName: params.agentName,
            machineName: params.machineName,
            currentTargetKey: params.currentTargetKey ?? null,
            access: params.access,
            ...(params.refusalCode ? { refusalCode: params.refusalCode } : {}),
            ...(params.requestedTarget ? { requestedTarget: params.requestedTarget } : {}),
            ...(params.onChosen ? { onChosen: params.onChosen } : {}),
            onSelected: params.onSelected,
            ...(params.onStoppedSharing ? { onStoppedSharing: params.onStoppedSharing } : {}),
        },
        chrome: computerTargetPickerChrome({ agentName: params.agentName, machineName: params.machineName, purpose: params.purpose }),
        closeOnBackdrop: true,
    });
}
