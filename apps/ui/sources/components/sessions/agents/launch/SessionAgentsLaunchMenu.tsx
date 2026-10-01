import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import type { ExecutionRunIntent } from '@/components/sessions/runs/launcher/executionRunLauncherModel';
import {
    useWorkflowDefinitionLibrary,
    type WorkflowDefinitionLibrary,
} from '@/components/workflows/library/workflowLibraryReads';
import { t, tLoose } from '@/text';

import { SESSION_STARTABLE_BUILTIN_WORKFLOWS } from './useSessionBuiltinWorkflowStart';
import type { SessionAgentLauncher } from './useSessionAgentLauncher';

const INTENT_COPY = {
    review: { icon: 'shield-check', title: 'executionRuns.newRun.intents.review', subtitle: 'sessionAgentActivity.roster.launch.reviewDescription' },
    plan: { icon: 'list-checks', title: 'executionRuns.newRun.intents.plan', subtitle: 'sessionAgentActivity.roster.launch.planDescription' },
    delegate: { icon: 'arrow-elbow-down-right', title: 'executionRuns.newRun.intents.delegate', subtitle: 'sessionAgentActivity.roster.launch.delegateDescription' },
} as const satisfies Record<ExecutionRunIntent, { icon: IconName; title: string; subtitle: string }>;

const WORKFLOW_ITEM_PREFIX = 'workflow:';
const BUILTIN_ITEM_PREFIX = 'builtin:';
const ALL_WORKFLOWS_ITEM_ID = 'workflow-all';
const LIBRARY_STATUS_ITEM_ID = 'workflow-library-status';
/** Second opinion is ORC's role on a review start (INT §6 I4); no new run intent. */
const SECOND_OPINION_ROLE_ID = 'second_opinion';

type LibraryView = Pick<WorkflowDefinitionLibrary, 'status' | 'definitions' | 'hasMore' | 'loadMoreFailed'>;

/**
 * FIN's workflow library (`useWorkflowDefinitionLibrary`: Account-scoped, paged, invalidated on
 * delete), mounted only while the "+" is open so an unopened menu issues no read. While open it
 * pages through the owner's own cursor so search and selection reach every saved workflow; closing
 * mid-read leaves the read with its owner, and reopening shows what it settled. Nothing is copied or
 * cached here.
 */
const WorkflowLibraryWhileOpen = React.memo(function WorkflowLibraryWhileOpen(props: Readonly<{
    onChange: (view: LibraryView) => void;
}>) {
    const { status, definitions, hasMore, loadingMore, loadMoreFailed, loadMore } = useWorkflowDefinitionLibrary();
    const { onChange } = props;
    React.useEffect(() => {
        onChange({ status, definitions, hasMore, loadMoreFailed });
    }, [definitions, hasMore, loadMoreFailed, onChange, status]);
    React.useEffect(() => {
        if (status === 'loaded' && hasMore && !loadingMore && !loadMoreFailed) loadMore();
    }, [hasMore, loadMore, loadMoreFailed, loadingMore, status]);
    return null;
});

/**
 * The Work tab's "+" (lab `convo-W1`/`W4`, phone `P2`): everything that can start from here, in one
 * menu. A new agent conversation; the asks this Session's backends take (Review · Plan · Delegate,
 * and Second opinion: a review run by ORC's `second_opinion` role), each opening the composer-first
 * start; a built-in workflow through FIN's run start, or a saved one through FIN's run entry; a trigger in this
 * Session's Triggers section; the Agent's own launcher (a Claude team) when it contributes one; and
 * Advanced (several agents, permissions, profile). When agents cannot start here those rows are not
 * drawn; the pane says why instead.
 */
export const SessionAgentsLaunchMenu = React.memo((props: Readonly<{
    launcher: SessionAgentLauncher;
    /** Opens this Session's Triggers section; absent while that section is not mounted here. */
    onAddTrigger?: (() => void) | null;
    /** Opens this Session's Goal control (FIN 04's one entry); absent where the session can't hold a goal. */
    onKeepGoing?: (() => void) | null;
    testID?: string;
}>) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [open, setOpen] = React.useState(false);
    const { launcher, onAddTrigger, onKeepGoing } = props;
    const canRun = launcher.unavailableReason === null;
    const iconColor = theme.colors.text.secondary;
    const [workflowLibrary, setWorkflowLibrary] = React.useState<LibraryView | null>(null);

    const items = React.useMemo((): readonly DropdownMenuItem[] => {
        const result: DropdownMenuItem[] = [];
        const askSection = t('agentStart.menu.askSection');
        if (canRun) {
            result.push({
                id: 'conversation',
                testID: 'session-agents-launch:conversation',
                title: t('session.subagents.panel.newAgentConversation'),
                subtitle: t('sessionAgentActivity.roster.launch.conversationDescription'),
                icon: <Icon name="chat-circle" size={16} color={iconColor} />,
            });
            for (const intent of launcher.intents) {
                const copy = INTENT_COPY[intent];
                result.push({
                    id: intent,
                    testID: `session-agents-launch:${intent}`,
                    category: askSection,
                    title: t(copy.title),
                    subtitle: t(copy.subtitle),
                    icon: <Icon name={copy.icon} size={16} color={iconColor} />,
                });
            }
            if (launcher.intents.includes('review')) {
                result.push({
                    id: 'second-opinion',
                    testID: 'session-agents-launch:second-opinion',
                    category: askSection,
                    title: t('agentStart.menu.secondOpinionTitle'),
                    subtitle: t('agentStart.menu.secondOpinionSubtitle'),
                    icon: <Icon name="checks" size={16} color={iconColor} />,
                });
            }
            if (onKeepGoing) {
                // Lab `convo-W1`: the Goal control attaches the built-in; the menu only opens it.
                result.push({
                    id: 'keep-going',
                    testID: 'session-agents-launch:keep-going',
                    category: askSection,
                    title: t('agentStart.menu.keepGoingTitle'),
                    subtitle: t('agentStart.menu.keepGoingSubtitle'),
                    icon: <Icon name="target" size={16} color={iconColor} />,
                });
            }
        }
        const builtInSection = t('agentStart.menu.builtIn');
        const librarySection = t('agentStart.menu.yourLibrary');
        const workflowIcon = <Icon name="tree-structure" size={16} color={iconColor} />;
        const workflowItems: DropdownMenuItem[] = SESSION_STARTABLE_BUILTIN_WORKFLOWS.map((entry) => ({
            id: `${BUILTIN_ITEM_PREFIX}${entry.id}`,
            testID: `session-agents-launch:${entry.id}`,
            category: builtInSection,
            title: tLoose(entry.titleKey),
            subtitle: tLoose(entry.descriptionKey),
            icon: workflowIcon,
        }));
        // Last-known rows stay while the owner refreshes or after a failed refresh.
        for (const definition of workflowLibrary?.definitions ?? []) {
            const description = definition.metadata.description?.trim();
            workflowItems.push({
                id: `${WORKFLOW_ITEM_PREFIX}${definition.definitionId}`,
                testID: `session-agents-launch:workflow:${definition.definitionId}`,
                category: librarySection,
                title: definition.metadata.title,
                ...(description ? { subtitle: description } : {}),
                icon: workflowIcon,
            });
        }
        // An unread, failed or empty library says so in its own section, never as an empty list.
        const libraryStatus = workflowLibrary !== null && workflowLibrary.definitions.length > 0
            ? null
            : workflowLibrary?.status === 'loaded'
                ? t('agentStart.menu.noWorkflows')
                : workflowLibrary?.status === 'failed' ? t('common.unavailable') : t('common.loading');
        if (libraryStatus !== null) {
            workflowItems.push({ id: LIBRARY_STATUS_ITEM_ID, category: librarySection, title: libraryStatus, disabled: true });
        }
        if (workflowLibrary?.hasMore && workflowLibrary.loadMoreFailed) {
            // A later page could not be read: the Workflows destination has the rest (and its Retry).
            workflowItems.push({
                id: ALL_WORKFLOWS_ITEM_ID,
                testID: 'session-agents-launch:workflow-all',
                category: librarySection,
                title: t('agentStart.menu.allWorkflows'),
            });
        } else if (workflowLibrary?.hasMore && workflowLibrary.definitions.length > 0) {
            // The next page is on its way; say so rather than imply the list is complete.
            workflowItems.push({ id: LIBRARY_STATUS_ITEM_ID, category: librarySection, title: t('common.loading'), disabled: true });
        }
        result.push({
            id: 'run-workflow',
            testID: 'session-agents-launch:run-workflow',
            title: t('agentStart.menu.runWorkflowTitle'),
            subtitle: t('agentStart.menu.runWorkflowSubtitle'),
            icon: <Icon name="tree-structure" size={16} color={iconColor} />,
            submenu: {
                items: workflowItems,
                search: true,
                searchPlaceholder: t('agentStart.menu.searchWorkflows'),
                emptyLabel: t('agentStart.menu.noWorkflows'),
                maxWidthCap: 420,
            },
        });
        if (onAddTrigger) {
            result.push({
                id: 'add-trigger',
                testID: 'session-agents-launch:add-trigger',
                title: t('agentStart.menu.addTriggerTitle'),
                subtitle: t('agentStart.menu.addTriggerSubtitle'),
                icon: <Icon name="lightning" size={16} color={iconColor} />,
            });
        }
        if (launcher.providerLaunch) {
            result.push({
                id: 'provider',
                testID: 'session-agents-launch:provider',
                title: launcher.providerLaunch.title,
                ...(launcher.providerLaunch.subtitle ? { subtitle: launcher.providerLaunch.subtitle } : {}),
                icon: <Icon name="users" size={16} color={iconColor} />,
            });
        }
        if (canRun) {
            result.push({
                id: 'advanced',
                testID: 'session-agents-launch:advanced',
                title: t('agentStart.menu.advancedTitle'),
                subtitle: t('agentStart.menu.advancedSubtitle'),
                icon: <Icon name="sliders-horizontal" size={16} color={iconColor} />,
            });
        }
        return result;
    }, [canRun, iconColor, launcher.intents, launcher.providerLaunch, onAddTrigger, onKeepGoing, workflowLibrary]);

    const select = React.useCallback((itemId: string) => {
        setOpen(false);
        if (itemId.startsWith(BUILTIN_ITEM_PREFIX)) {
            // FIN's run start, asked from this session's machine and folder.
            launcher.startBuiltinWorkflow(itemId.slice(BUILTIN_ITEM_PREFIX.length));
            return;
        }
        if (itemId.startsWith(WORKFLOW_ITEM_PREFIX)) {
            // FIN's run entry: the saved workflow's page opens on its Run, which asks its inputs.
            const definitionId = itemId.slice(WORKFLOW_ITEM_PREFIX.length);
            router.push({ pathname: '/workflows/[id]', params: { id: definitionId, intent: 'run' } } as never);
            return;
        }
        if (itemId === 'conversation') launcher.openConversation();
        else if (itemId === 'advanced') launcher.openRun();
        else if (itemId === 'provider') launcher.providerLaunch?.open();
        else if (itemId === 'add-trigger') onAddTrigger?.();
        else if (itemId === 'keep-going') onKeepGoing?.();
        else if (itemId === 'second-opinion') {
            launcher.openRun('review', { roleId: SECOND_OPINION_ROLE_ID, title: t('agentStart.menu.secondOpinionTitle') });
        }
        // The rest of the library lives in the Workflows destination.
        else if (itemId === 'run-workflow' || itemId === ALL_WORKFLOWS_ITEM_ID) router.push('/workflows' as never);
        else if (itemId === 'review' || itemId === 'plan' || itemId === 'delegate') launcher.openRun(itemId);
    }, [launcher, onAddTrigger, onKeepGoing, router]);

    if (items.length === 0) return null;

    return (
        <>
        {open ? <WorkflowLibraryWhileOpen onChange={setWorkflowLibrary} /> : null}
        <DropdownMenu
            testID={props.testID ?? 'session-agents-launch-menu'}
            open={open}
            onOpenChange={setOpen}
            items={items}
            onSelect={select}
            matchTriggerWidth={false}
            showCategoryTitles
            placement="bottom"
            trigger={({ open: isOpen, toggle }) => (
                <IconButton
                    testID="session-agents-launch-button"
                    iconName="plus"
                    variant="plain"
                    selected={isOpen}
                    accessibilityLabel={t('sessionAgentActivity.roster.launch.menuA11y')}
                    tooltip={t('sessionAgentActivity.roster.launch.menuA11y')}
                    onPress={toggle}
                />
            )}
        />
        </>
    );
});
