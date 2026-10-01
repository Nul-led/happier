import { useSessionTranscriptSource } from '@/components/sessions/transcript/source/SessionTranscriptSourceContext';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { Metadata } from '@happier-dev/session-core/state';
import type { PendingPermissionRequest } from '@/utils/sessions/sessionUtils';

import { Text } from '@/components/ui/text/Text';
import { PermissionFooter } from '@/components/tools/shell/permissions/PermissionFooter';
import type { PermissionToolCallMessageLocation } from '@/utils/sessions/permissions/permissionToolCallLocationTypes';
import { buildPermissionToolCallRoute, canOpenPermissionToolCallRoute } from '@/utils/sessions/permissions/buildPermissionToolCallRoute';
import { t } from '@/text';
import { buildPermissionPromptModel } from '@/components/tools/shell/permissions/presentation/buildPermissionPromptModel';
import { useSetting } from '@/sync/domains/state/storage';
import { resolveToolViewDetailLevel } from '@/components/tools/normalization/policy/resolveToolViewDetailLevel';
import { ToolInlineBody } from '@/components/tools/shell/views/ToolInlineBody';
import { navigateWithBlurOnWeb } from '@/utils/platform/navigateWithBlurOnWeb';
import {
    resolveToolViewDetailLevelDefaultForChromeMode,
    type ToolViewDetailLevelSetting,
} from '@/components/tools/normalization/policy/resolveToolViewDetailDefaultsForChromeMode';
import { isGenericSubAgentToolName } from '@happier-dev/protocol/tools/v2';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { Icon } from '@/components/ui/icons/Icon';
import type { PromptResponseOrigin } from './executionRunPromptResponseTarget';
import type { TranscriptPermissionDisabledReason } from '@/utils/sessions/deriveTranscriptInteraction';

const PROMPT_CARD_HORIZONTAL_PADDING = 12;
const PROMPT_CARD_ICON_SIZE = 18;
const PROMPT_CARD_ICON_TEXT_GAP = 6;
const PROMPT_CARD_TEXT_COLUMN_START =
    PROMPT_CARD_HORIZONTAL_PADDING + PROMPT_CARD_ICON_SIZE + PROMPT_CARD_ICON_TEXT_GAP;

export const PermissionPromptCard = React.memo(function PermissionPromptCard(props: PromptResponseOrigin & {
    request: PendingPermissionRequest;
    location: PermissionToolCallMessageLocation | null;
    serverId?: string;
    metadata: Metadata | null;
    canApprovePermissions: boolean;
    disabledReason?: TranscriptPermissionDisabledReason;
    chrome?: 'card' | 'inline';
}) {
    const { theme } = useUnistyles();
    const transcriptSource = useSessionTranscriptSource();
    const minimumInteractiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);

    const toolViewDetailLevelDefault = useSetting('toolViewDetailLevelDefault');
    const toolViewDetailLevelDefaultLocalControl = useSetting('toolViewDetailLevelDefaultLocalControl');
    const toolViewDetailLevelByToolName = useSetting('toolViewDetailLevelByToolName');

    const model = React.useMemo(() => {
        return buildPermissionPromptModel({ request: props.request, metadata: props.metadata, nowMs: Date.now() });
    }, [props.metadata, props.request]);
    const headerText = model.headerText;

    const onViewTool = React.useCallback(() => {
        if (props.sessionId === undefined) return;
        const sessionId = props.sessionId;
        navigateWithBlurOnWeb(() => {
            transcriptSource.navigate?.(buildPermissionToolCallRoute({ sessionId, serverId: props.serverId, location: props.location }));
        });
    }, [props.location, props.sessionId, props.serverId, transcriptSource]);
    // A tool-call route is a Session transcript location; an Execution Run has none.
    const canOpenToolRoute = transcriptSource.navigate !== null && props.sessionId !== undefined && canOpenPermissionToolCallRoute(props.location);

    const previewDetailLevel = React.useMemo(() => {
        const normalizedToolViewDetailLevelDefaultSetting: ToolViewDetailLevelSetting =
            toolViewDetailLevelDefault === 'default' ||
            toolViewDetailLevelDefault === 'title' ||
            toolViewDetailLevelDefault === 'compact' ||
            toolViewDetailLevelDefault === 'summary' ||
            toolViewDetailLevelDefault === 'full'
                ? toolViewDetailLevelDefault
                : 'default';
        const resolvedDetailLevelDefault = resolveToolViewDetailLevelDefaultForChromeMode({
            chromeMode: 'cards',
            setting: normalizedToolViewDetailLevelDefaultSetting,
        });

        return resolveToolViewDetailLevel({
            toolName: headerText.normalizedToolName,
            toolInput: model.tool.input,
            detailLevelDefault: resolvedDetailLevelDefault,
            detailLevelDefaultLocalControl: toolViewDetailLevelDefaultLocalControl,
            detailLevelByToolName: toolViewDetailLevelByToolName as any,
        });
    }, [
        headerText.normalizedToolName,
        model.tool.input,
        toolViewDetailLevelByToolName,
        toolViewDetailLevelDefault,
        toolViewDetailLevelDefaultLocalControl,
    ]);
    const inlineDetailLevel =
        isGenericSubAgentToolName(headerText.normalizedToolName) && previewDetailLevel === 'full'
            ? 'summary'
            : previewDetailLevel;
    const isPreviewVisible = inlineDetailLevel !== 'title' && inlineDetailLevel !== 'compact';

    const effectiveSubtitle = React.useMemo(() => {
        const subtitle = headerText.subtitle;
        if (!subtitle) return null;
        if (!isPreviewVisible) return subtitle;
        const normalizedLower = headerText.normalizedToolName.trim().toLowerCase();
        const isShellTool = normalizedLower === 'bash' || normalizedLower === 'execute' || normalizedLower === 'shell' || normalizedLower === 'codexbash';
        return isShellTool ? null : subtitle;
    }, [headerText.normalizedToolName, headerText.subtitle, isPreviewVisible]);

    const [headerActions, setHeaderActions] = React.useState<React.ReactNode | null>(null);
    const chrome = props.chrome ?? 'card';

    if (props.disabledReason === 'inactive') {
        return null;
    }

    return (
        <View testID="permission-prompt-card" style={[styles.container, chrome === 'inline' ? styles.containerInline : null]}>
            <View style={styles.header}>
                <View style={styles.icon}>
                    <Icon name="lock" size={16} color={theme.colors.state.neutral.foreground} />
                </View>
                <View style={styles.headerText}>
                    <Text style={styles.title} numberOfLines={1}>
                        {headerText.title}
                    </Text>
                    {effectiveSubtitle ? (
                        <Text style={styles.subtitle} numberOfLines={2}>
                            {effectiveSubtitle}
                        </Text>
                    ) : null}
                </View>
                {headerActions ? <View style={styles.headerActions}>{headerActions}</View> : null}
                {canOpenToolRoute ? (
                    <Pressable
                        testID="permission-prompt-view-tool"
                        onPress={onViewTool}
                        accessibilityRole="button"
                        accessibilityLabel={t('toolView.open')}
                        style={({ pressed }) => [
                            styles.viewButton,
                            {
                                minWidth: minimumInteractiveTargetSize,
                                minHeight: minimumInteractiveTargetSize,
                            },
                            pressed && styles.viewButtonPressed,
                        ]}
                    >
                        <Icon name="arrow-square-out" size={PROMPT_CARD_ICON_SIZE} color={theme.colors.text.secondary} />
                    </Pressable>
                ) : null}
            </View>

            {isPreviewVisible ? (
                <View style={styles.preview}>
                    <ToolInlineBody
                        mode="timeline"
                        tool={model.tool}
                        normalizedToolName={headerText.normalizedToolName}
                        metadata={props.metadata}
                        messages={[]}
                        sessionId={props.sessionId}
                        serverId={props.serverId}
                        interaction={{
                            canSendMessages: false,
                            canApprovePermissions: props.canApprovePermissions,
                            permissionDisabledReason: props.disabledReason,
                        }}
                        detailLevel={inlineDetailLevel === 'full' ? 'full' : 'summary'}
                        sectionSpacing="compact"
                        setHeaderActions={setHeaderActions}
                    />
                </View>
            ) : null}

            <View style={styles.actions}>
                <PermissionFooter
                    {...(props.executionRun === undefined
                        ? { sessionId: props.sessionId }
                        : { executionRun: props.executionRun })}
                    embedded={true}
                    alignFirstButtonToStart={true}
                    permission={{
                        id: props.request.id,
                        ...(props.request.turnId ? { turnId: props.request.turnId } : {}),
                        status: 'pending',
                        ...(typeof props.request.permissionSuggestions !== 'undefined'
                            ? { suggestions: props.request.permissionSuggestions }
                            : {}),
                    }}
                    serverId={props.serverId}
                    toolName={props.request.tool}
                    toolInput={props.request.arguments}
                    metadata={props.metadata || null}
                    canApprovePermissions={props.canApprovePermissions}
                    disabledReason={props.disabledReason}
                />
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        borderRadius: theme.parts.approvalCard.radius,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.elevated,
        overflow: 'hidden',
    },
    containerInline: {
        borderRadius: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: PROMPT_CARD_ICON_TEXT_GAP,
        paddingLeft: PROMPT_CARD_HORIZONTAL_PADDING,
        paddingRight: PROMPT_CARD_HORIZONTAL_PADDING,
        paddingTop: 12,
        paddingBottom: 8,
    },
    icon: {
        width: PROMPT_CARD_ICON_SIZE,
        height: PROMPT_CARD_ICON_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerText: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    title: {
        fontSize: 13,
        fontWeight: '700',
        color: theme.colors.text.primary,
    },
    subtitle: {
        fontSize: 12,
        color: theme.colors.text.secondary,
    },
    viewButton: {
        padding: 6,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    viewButtonPressed: {
        backgroundColor: theme.colors.surface.pressedOverlay,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    preview: {
        paddingLeft: PROMPT_CARD_TEXT_COLUMN_START,
        paddingRight: PROMPT_CARD_HORIZONTAL_PADDING,
        paddingBottom: 0,
    },
    actions: {
        paddingLeft: PROMPT_CARD_TEXT_COLUMN_START,
        paddingRight: PROMPT_CARD_HORIZONTAL_PADDING,
        paddingBottom: 12,
    },
}));
