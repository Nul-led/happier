/**
 * Composes an overlay accessible name from values the overlay model already projects for display.
 *
 * It derives no new Session context: callers pass the exact strings their surface already renders,
 * so the spoken name cannot drift from the visible row or disclose unprojected metadata.
 */
export function composeDesktopActivityOverlayAccessibilityLabel(
    parts: readonly (string | number | null | undefined)[],
): string | undefined {
    const label = parts
        .map((part) => (typeof part === 'number' ? String(part) : part))
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join('. ');

    return label.length > 0 ? label : undefined;
}
