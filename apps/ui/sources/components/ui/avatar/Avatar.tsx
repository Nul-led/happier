import * as React from "react";
import { View } from 'react-native';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { resolveHappierBrandFallback } from '@happier-dev/plugin-ui/presentation';
import { AvatarSkia } from "./AvatarSkia";
import { AvatarGradient } from "./AvatarGradient";
import { AvatarBrutalist } from "./AvatarBrutalist";
import { AgentIcon } from '@/agents/registry/AgentIcon';
import { SafeExpoImage } from '@/components/ui/media/SafeExpoImage';
import { useSetting } from '@/sync/domains/state/storage';
import { StyleSheet } from 'react-native-unistyles';
import { shadowLevelStyle } from '@/shadowElevation';
import {
    resolveAgentIdFromFlavor,
    getAgentAvatarOverlaySizes,
} from '@/agents/catalog/catalog';

interface AvatarProps {
    id: string;
    testID?: string;
    accessibilityLabel?: string;
    title?: boolean;
    square?: boolean;
    size?: number;
    monochrome?: boolean;
    flavor?: string | null;
    imageUrl?: string | null;
    thumbhash?: string | null;
    hasUnreadMessages?: boolean;
    unreadBadgeTestID?: string;
}

const styles = StyleSheet.create((theme) => ({
    container: {
        position: 'relative',
    },
    monogram: {
        position: 'absolute',
        inset: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    monogramText: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        textShadowColor: theme.colors.surface.base,
        textShadowRadius: 2,
        textShadowOffset: { width: 0, height: 0 },
    },
    flavorIcon: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        backgroundColor: theme.colors.surface.base,
        borderRadius: 100,
        padding: 2,
        ...shadowLevelStyle(theme.colors.shadowLevels[2]),
    },
    unreadBadge: {
        position: 'absolute',
        top: -2,
        right: -2,
        backgroundColor: theme.colors.text.link,
        borderRadius: 100,
        borderWidth: 1.5,
        borderColor: theme.colors.surface.base,
    },
}));

export const Avatar = React.memo((props: AvatarProps) => {
    const { flavor, size = 48, imageUrl, thumbhash, hasUnreadMessages, unreadBadgeTestID, testID, accessibilityLabel, ...avatarProps } = props;
    const avatarStyle = useSetting('avatarStyle');
    const showFlavorIcons = useSetting('showFlavorIcons');

    const agentId = resolveAgentIdFromFlavor(flavor);

    const unreadBadgeSize = Math.round(size * 0.4);
    const unreadBadgeElement = hasUnreadMessages ? (
        <View
            testID={unreadBadgeTestID}
            style={[styles.unreadBadge, { width: unreadBadgeSize, height: unreadBadgeSize }]}
        />
    ) : null;

    // Render custom image if provided
    if (imageUrl) {
        const imageElement = (
            <SafeExpoImage
                source={{ uri: imageUrl, thumbhash: thumbhash || undefined }}
                placeholder={thumbhash ? { thumbhash: thumbhash } : undefined}
                contentFit="cover"
                style={{
                    width: size,
                    height: size,
                    borderRadius: avatarProps.square ? 0 : size / 2,
                }}
            />
        );

        const overlayAgentId = showFlavorIcons ? agentId : null;
        if (overlayAgentId || hasUnreadMessages) {
            const { circleSize, iconSize } = getAgentAvatarOverlaySizes(overlayAgentId ?? '', size);

            return (
                <View testID={testID} accessible={Boolean(accessibilityLabel || props.title)} accessibilityRole="image" accessibilityLabel={accessibilityLabel ?? (props.title ? props.id : undefined)} style={[styles.container, { width: size, height: size }]}>
                    {imageElement}
                    {overlayAgentId && (
                        <View style={[styles.flavorIcon, {
                            width: circleSize,
                            height: circleSize,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }]}>
                            <AgentIcon agentId={overlayAgentId} size={iconSize} />
                        </View>
                    )}
                    {unreadBadgeElement}
                </View>
            );
        }

        return testID || accessibilityLabel || props.title ? (
            <View testID={testID} accessible={Boolean(accessibilityLabel || props.title)} accessibilityRole="image" accessibilityLabel={accessibilityLabel ?? (props.title ? props.id : undefined)}>
                {imageElement}
            </View>
        ) : imageElement;
    }

    // Original generated avatar logic
    // Determine which avatar variant to render
    const artwork = avatarStyle === 'pixelated' ? <AvatarSkia {...avatarProps} size={size} />
        : avatarStyle === 'brutalist' ? <AvatarBrutalist {...avatarProps} size={size} />
            : <AvatarGradient {...avatarProps} size={size} />;
    const firstGrapheme = props.title ? resolveHappierBrandFallback(props.id) : undefined;

    // An Agent the catalog carries no presentation for — an installed Agent, or a
    // session whose Agent is unreadable — has no mark to show. Wearing the default
    // Agent's mark would claim the session belongs to that Agent, so it stays bare.
    const overlayAgentId = showFlavorIcons ? agentId : null;
    const { circleSize, iconSize } = getAgentAvatarOverlaySizes(overlayAgentId ?? '', size);

    if (overlayAgentId || hasUnreadMessages || props.title || testID || accessibilityLabel) {
        return (
            <View testID={testID} accessible={Boolean(accessibilityLabel || props.title)} accessibilityRole="image" accessibilityLabel={accessibilityLabel ?? (props.title ? props.id : undefined)} style={[styles.container, { width: size, height: size }]}>
                {artwork}
                {firstGrapheme ? <View style={styles.monogram} pointerEvents="none" accessible={false}>
                    <Text testID="avatar-monogram" style={[styles.monogramText, { fontSize: size * 0.45, lineHeight: size * 0.6 }]}>{firstGrapheme}</Text>
                </View> : null}
                {overlayAgentId && (
                    <View style={[styles.flavorIcon, {
                        width: circleSize,
                        height: circleSize,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }]}>
                        <AgentIcon agentId={overlayAgentId} size={iconSize} />
                    </View>
                )}
                {unreadBadgeElement}
            </View>
        );
    }

    // Return avatar without wrapper when not showing flavor icons
    return artwork;
});
