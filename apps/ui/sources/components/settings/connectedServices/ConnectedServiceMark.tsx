import * as React from 'react';
import { SvgXml } from 'react-native-svg';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { resolveConnectedServiceBrandIconXml } from '@/agents/registry/resolveConnectedServiceBrandIconXml';
import { Icon } from '@/components/ui/icons/Icon';
import { t } from '@/text';

/** Mark box and logo size per place: the logo fills the box it used to sit in, so alignment holds. */
const MARK_SIZES = {
    page: { box: 44, logo: 36 },
    row: { box: 32, logo: 22 },
    card: { box: 24, logo: 18 },
    inline: { box: 16, logo: 16 },
} as const;

/**
 * A service's brand mark, bare (no tile, fill or border: `happier-ui-craft`, user ruling 2026-09-30).
 * Services without a contributed mark show a key glyph. `page` heads an entity page, `row` a service
 * block or an invitation, `card` a card or a rail row, `inline` sits beside text.
 */
export const ConnectedServiceMark = React.memo(function ConnectedServiceMark(props: Readonly<{
    legacyServiceId: string | null | undefined;
    size?: keyof typeof MARK_SIZES;
}>) {
    const { theme } = useUnistyles();
    // Brand aliases are a visual affordance only; only a generated legacy adapter can opt a qualified
    // owner into a built-in mark.
    const brandXml = resolveConnectedServiceBrandIconXml(props.legacyServiceId ?? undefined, theme);
    const size = MARK_SIZES[props.size ?? 'row'];
    const glyph = brandXml
        ? <SvgXml xml={brandXml} width={size.logo} height={size.logo} />
        : <Icon name="key" size={Math.min(size.logo, 18)} color={theme.colors.text.secondary} />;
    if (props.size === 'inline') return glyph;
    return <View style={[styles.box, { width: size.box, height: size.box }]}>{glyph}</View>;
});

/** "Claude Code, OpenCode and Pi": the agents that sign in with a service, as a sentence. */
export function formatAgentNames(names: readonly string[]): string {
    if (names.length <= 1) return names[0] ?? '';
    return t('connectedServicesSettings.namesAnd', {
        names: names.slice(0, -1).join(', '),
        last: names[names.length - 1]!,
    });
}


const styles = StyleSheet.create(() => ({
    box: {
        alignItems: 'center',
        justifyContent: 'center',
    },
}));
