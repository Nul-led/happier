import { HappierStatusCapsule, type HappierStatusCapsuleProps } from '@happier-dev/plugin-ui/presentation';
import * as React from 'react';

import { CORE_CAPSULE_HOST, useCoreCapsuleColors } from '@/components/ui/status/capsuleHost';

/**
 * Happier core's binding of the one status capsule (`HappierStatusCapsule` in
 * `@happier-dev/plugin-ui/presentation`, the same owner plugins draw): a small capsule over a page or
 * a stream, shown only while something is not normal ("This page is taking a while", "Showing the last
 * frame · reconnecting"), with the one way out beside it. This binding supplies only the app's leaves
 * (glass, type roles, round button, overlay motion) and its colour tokens.
 */
export function BrowserFrameStatusCapsule(
    props: Omit<HappierStatusCapsuleProps, 'colors' | 'host'>,
): React.ReactElement | null {
    const colors = useCoreCapsuleColors();
    return <HappierStatusCapsule {...props} colors={colors} host={CORE_CAPSULE_HOST} />;
}
