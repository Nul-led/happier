import * as React from 'react';
import type { PluginProjectionV2 } from '@happier-dev/protocol';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Modal } from '@/modal';
import type { PluginAccountAvailabilityReader } from '@/sync/domains/plugins/availability/reader';
import { t } from '@/text';

import {
    createPluginAccountReleaseSelectionController,
    type PluginAccountReleaseSelectionController,
    type PluginAccountReleaseSelectionControllerResult,
} from './pluginAccountReleaseSelectionController';

type ControllerLifetime = {
    controller: PluginAccountReleaseSelectionController;
    current: boolean;
};

function showResult(result: PluginAccountReleaseSelectionControllerResult): void {
    switch (result.kind) {
        case 'selected':
            Modal.alert(
                t('common.success'),
                t('settingsPlugins.accountReleaseSelection.selectedBody'),
            );
            return;
        case 'conflict':
            Modal.alert(
                t('settingsPlugins.accountReleaseSelection.conflictTitle'),
                t('settingsPlugins.accountReleaseSelection.conflictBody'),
            );
            return;
        case 'rejected':
            Modal.alert(
                t('settingsPlugins.accountReleaseSelection.rejectedTitle'),
                t('settingsPlugins.accountReleaseSelection.rejectedBody'),
            );
            return;
        case 'unavailable':
            Modal.alert(
                t('settingsPlugins.accountReleaseSelection.unavailableTitle'),
                t('settingsPlugins.accountReleaseSelection.unavailableBody'),
            );
            return;
        case 'cancelled':
            return;
    }
}

/**
 * Present-user Account release action. It intentionally has no machine
 * installation/trust authority: the controller asks Availability for the
 * exact release, and only its typed response may trigger preparation.
 */
export function PluginAccountReleaseSelectionSection(props: Readonly<{
    pluginId: string;
    version: string;
    reader: PluginAccountAvailabilityReader | null;
    /** The live raw daemon projection, if this Account action can use it. */
    projection: PluginProjectionV2 | null;
    daemon: Readonly<{
        serverId: string | null;
        serverIdentityId: string | null;
        machineId: string | null;
    }>;
    testID: string;
}>): React.ReactElement {
    const [pending, setPending] = React.useState(false);
    const [hostedStatus, setHostedStatus] = React.useState<ReturnType<PluginAccountReleaseSelectionController['readHostedArtifactStatus']>>('unavailable');
    const controllerLifetimeRef = React.useRef<ControllerLifetime | null>(null);

    React.useEffect(() => {
        const lifetime: ControllerLifetime = {
            controller: createPluginAccountReleaseSelectionController(),
            current: true,
        };
        controllerLifetimeRef.current = lifetime;
        return () => {
            lifetime.current = false;
            if (controllerLifetimeRef.current === lifetime) controllerLifetimeRef.current = null;
            lifetime.controller.retire();
        };
    }, []);

    React.useEffect(() => {
        const update = () => {
            const lifetime = controllerLifetimeRef.current;
            if (!lifetime?.current) return;
            setHostedStatus(lifetime.controller.readHostedArtifactStatus({
                pluginId: props.pluginId,
                reader: props.reader,
            }));
        };
        update();
        return props.reader?.subscribe(update);
    }, [props.pluginId, props.reader]);

    const runHostedAction = React.useCallback((action: (
        controller: PluginAccountReleaseSelectionController,
    ) => Promise<Readonly<{ kind: string }>>) => {
        const lifetime = controllerLifetimeRef.current;
        if (!lifetime || pending || lifetime.controller.isPending()) return;
        setPending(true);
        void action(lifetime.controller).then((result) => {
            if (!lifetime.current || controllerLifetimeRef.current !== lifetime) return;
            if (result.kind !== 'updated') {
                Modal.alert(t('common.error'), t('common.requestFailed'));
            }
        }).catch(() => {
            if (lifetime.current && controllerLifetimeRef.current === lifetime) {
                Modal.alert(t('common.error'), t('common.requestFailed'));
            }
        }).finally(() => {
            if (lifetime.current && controllerLifetimeRef.current === lifetime) setPending(false);
        });
    }, [pending]);

    const selectRelease = React.useCallback(() => {
        const lifetime = controllerLifetimeRef.current;
        if (!lifetime || pending || lifetime.controller.isPending()) return;
        setPending(true);
        void (async () => {
            try {
                const result = await lifetime.controller.select({
                    pluginId: props.pluginId,
                    version: props.version,
                    reader: props.reader,
                    projection: props.projection,
                    daemon: props.daemon,
                    isCurrent: () => lifetime.current && controllerLifetimeRef.current === lifetime,
                });
                if (lifetime.current && controllerLifetimeRef.current === lifetime) {
                    showResult(result);
                }
            } catch {
                if (lifetime.current && controllerLifetimeRef.current === lifetime) {
                    showResult(Object.freeze({ kind: 'unavailable' as const, code: 'target_release_unavailable' as const }));
                }
            } finally {
                if (lifetime.current && controllerLifetimeRef.current === lifetime) setPending(false);
            }
        })();
    }, [pending, props.daemon, props.pluginId, props.projection, props.reader, props.version]);

    return (
        <ItemGroup
            title={t('settingsPlugins.accountReleaseSelection.groupTitle')}
            footer={t('settingsPlugins.accountReleaseSelection.groupFooter')}
        >
            <Item
                testID={props.testID}
                title={t('settingsPlugins.accountReleaseSelection.entryTitle')}
                subtitle={t('settingsPlugins.accountReleaseSelection.entrySubtitle', { version: props.version })}
                onPress={selectRelease}
                disabled={pending}
                loading={pending}
                showChevron={false}
            />
            {hostedStatus !== 'unavailable' ? (
                <Item
                    testID={`${props.testID}.hosting`}
                    title={hostedStatus === 'notOptedIn' || hostedStatus === 'disabledHosted'
                        ? t('settingsPlugins.accountReleaseSelection.hostedEnableTitle')
                        : t('settingsPlugins.accountReleaseSelection.hostedDisableTitle')}
                    subtitle={hostedStatus === 'unsupported' || hostedStatus === 'unsupportedHosted'
                        ? t('common.unavailable')
                        : hostedStatus === 'hosted'
                        ? t('settingsPlugins.accountReleaseSelection.hostedStatusReady')
                        : hostedStatus === 'publicationPending'
                            ? t('settingsPlugins.accountReleaseSelection.hostedStatusPending')
                            : t('settingsPlugins.accountReleaseSelection.hostedStatusDisabled')}
                    onPress={() => runHostedAction((controller) => controller.setHostedArtifactsEnabled({
                        pluginId: props.pluginId,
                        reader: props.reader,
                        enabled: hostedStatus === 'notOptedIn' || hostedStatus === 'disabledHosted',
                    }))}
                    disabled={pending || hostedStatus === 'unsupported' || hostedStatus === 'unsupportedHosted'}
                    loading={pending}
                    showChevron={false}
                />
            ) : null}
            {hostedStatus === 'hosted' || hostedStatus === 'publicationPending' || hostedStatus === 'disabledHosted' || hostedStatus === 'unsupportedHosted' ? (
                <Item
                    testID={`${props.testID}.removeHosted`}
                    title={t('settingsPlugins.accountReleaseSelection.hostedRemoveTitle')}
                    subtitle={t('settingsPlugins.accountReleaseSelection.hostedRemoveBody')}
                    destructive
                    onPress={() => {
                        void Modal.confirm(t('settingsPlugins.accountReleaseSelection.hostedRemoveTitle'), t('settingsPlugins.accountReleaseSelection.hostedRemoveBody'), {
                            confirmText: t('common.remove'),
                            destructive: true,
                        }).then((confirmed) => {
                            if (confirmed) runHostedAction((controller) => controller.disableAndRemoveHostedArtifacts({
                                pluginId: props.pluginId,
                                reader: props.reader,
                            }));
                        });
                    }}
                    disabled={pending}
                    showChevron={false}
                />
            ) : null}
            {hostedStatus !== 'unavailable' ? (
                <Item
                    testID={`${props.testID}.clearCache`}
                    title={t('settingsPlugins.accountReleaseSelection.hostedClearCacheTitle')}
                    subtitle={t('settingsPlugins.accountReleaseSelection.hostedClearCacheBody')}
                    onPress={() => runHostedAction((controller) => controller.clearHostedArtifactCache({
                        pluginId: props.pluginId,
                        reader: props.reader,
                    }))}
                    disabled={pending}
                    showChevron={false}
                />
            ) : null}
        </ItemGroup>
    );
}
