import * as React from 'react';
import type { SystemTaskResult } from '@happier-dev/protocol';

import { getDefaultSystemTaskRunner, useSystemTaskSnapshot } from '@/components/systemTasks';
import { buildLocalDaemonServiceSystemTaskSpec } from '@/components/systemTasks/specs/localControl/buildLocalDaemonServiceSystemTaskSpec';
import { isSystemTaskBridgeUnavailableError, readSystemTaskStartErrorMessage } from '@/components/systemTasks/systemTaskStartError';
import type { SystemTaskRunner } from '@/components/systemTasks/types';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';

type CliPathExposureTaskKind = 'cli.pathExposure.ensure.v1' | 'cli.pathExposure.remove.v1';

function readTaskOutcome(kind: CliPathExposureTaskKind, result: SystemTaskResult): string {
    if (!result.ok) {
        const message = typeof result.error?.message === 'string' ? result.error.message.trim() : '';
        return message || t('settings.systemTaskStartFailed');
    }
    const data = (result.data ?? {}) as Record<string, unknown>;
    if (kind === 'cli.pathExposure.remove.v1') {
        return data.removed === true ? t('machine.cliPath.removed') : t('machine.cliPath.nothingToRemove');
    }
    if (data.changed !== true) {
        return t('machine.cliPath.alreadyPresent');
    }
    return typeof data.shellReloadHint === 'string' && data.shellReloadHint.trim()
        ? data.shellReloadHint.trim()
        : t('machine.cliPath.added');
}

/**
 * Whether the owner has just proven this computer has no Happier-created PATH entry left, so
 * removal has nothing to offer. Both facts come from the owner's own result — the UI never
 * re-derives which entry Happier may touch (INV5). `changed: false` is deliberately not one of
 * them: an entry that is already present may be the shell installer's, which removal never claims.
 */
function readDesktopEntryAbsent(kind: CliPathExposureTaskKind, result: SystemTaskResult): boolean | null {
    if (!result.ok) {
        return null;
    }
    if (kind === 'cli.pathExposure.remove.v1') {
        return true;
    }
    return (result.data as Record<string, unknown> | undefined)?.changed === true ? false : null;
}

/**
 * Settings repair action for R6/INV5. PATH exposure is ancillary to setup: when the automatic
 * attempt during setup fails (read-only profile, unsupported shell) it is reported quietly and
 * this is where the user retries it — or undoes what Happier added.
 */
export const LocalCliPathExposureSection = React.memo(function LocalCliPathExposureSection(props: Readonly<{
    runner?: SystemTaskRunner;
}>) {
    const runner = props.runner ?? getDefaultSystemTaskRunner();
    const [activeTask, setActiveTask] = React.useState<Readonly<{ kind: CliPathExposureTaskKind; taskId: string }> | null>(null);
    const [startErrorMessage, setStartErrorMessage] = React.useState<string | null>(null);
    const [desktopEntryAbsent, setDesktopEntryAbsent] = React.useState(false);
    const snapshot = useSystemTaskSnapshot(runner, activeTask?.taskId ?? null);
    const result = snapshot?.result ?? null;
    const isUnavailable = runner.mode === 'unavailable';
    const isBusy = activeTask != null && result == null;

    const handledResultTaskIdRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!activeTask || !result || handledResultTaskIdRef.current === activeTask.taskId) {
            return;
        }
        handledResultTaskIdRef.current = activeTask.taskId;
        const absent = readDesktopEntryAbsent(activeTask.kind, result);
        if (absent !== null) {
            setDesktopEntryAbsent(absent);
        }
    }, [activeTask, result]);

    const startTask = React.useCallback(async (kind: CliPathExposureTaskKind) => {
        if (isUnavailable) {
            return;
        }
        try {
            const taskId = await runner.start(buildLocalDaemonServiceSystemTaskSpec(kind));
            setStartErrorMessage(null);
            setActiveTask({ kind, taskId });
        } catch (error) {
            setActiveTask(null);
            setStartErrorMessage(isSystemTaskBridgeUnavailableError(error)
                ? t('settings.systemTaskBridgeUnavailable')
                : (readSystemTaskStartErrorMessage(error) ?? t('settings.systemTaskStartFailed')));
        }
    }, [isUnavailable, runner]);

    const statusSubtitle = isUnavailable
        ? t('settings.systemTaskBridgeUnavailable')
        : startErrorMessage
            ?? (isBusy ? t('machine.cliPath.working') : null)
            ?? (activeTask && result ? readTaskOutcome(activeTask.kind, result) : null);

    return (
        <ItemGroup title={t('machine.cliPath.title')} footer={t('machine.cliPath.footer')}>
            {statusSubtitle ? (
                <Item
                    testID="settings.localCliPath.status"
                    title={t('machine.status')}
                    subtitle={statusSubtitle}
                    subtitleLines={0}
                    accessibilityLiveRegion="polite"
                    showChevron={false}
                    mode="info"
                />
            ) : null}
            <Item
                testID="settings.localCliPath.add"
                title={t('machine.cliPath.addTitle')}
                subtitle={t('machine.cliPath.addSubtitle')}
                onPress={() => {
                    void startTask('cli.pathExposure.ensure.v1');
                }}
                loading={isBusy && activeTask?.kind === 'cli.pathExposure.ensure.v1'}
                disabled={isUnavailable || isBusy}
            />
            <Item
                testID="settings.localCliPath.remove"
                title={t('machine.cliPath.removeTitle')}
                subtitle={t('machine.cliPath.removeSubtitle')}
                onPress={() => {
                    void startTask('cli.pathExposure.remove.v1');
                }}
                loading={isBusy && activeTask?.kind === 'cli.pathExposure.remove.v1'}
                disabled={isUnavailable || isBusy || desktopEntryAbsent}
            />
        </ItemGroup>
    );
});
