/**
 * Shorten one display string to a code-point ceiling without splitting a
 * surrogate pair or leaving the surrounding whitespace strict schemas reject.
 * Identity and source/window coverage are deliberately outside this helper.
 */
export function boundTriageDisplayText(value: string, maxCodePoints: number): string {
    const trimmed = value.trim();
    const codePoints = Array.from(trimmed);
    if (codePoints.length <= maxCodePoints) return trimmed;
    const kept = codePoints.slice(0, maxCodePoints - 1).join('').trimEnd();
    return `${kept}…`;
}
