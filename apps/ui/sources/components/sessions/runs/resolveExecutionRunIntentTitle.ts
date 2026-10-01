/**
 * The wire bound on `ExecutionRunDisplaySchema.title` (packages/protocol execution runs
 * `startRequest.ts`: `z.string().min(1).max(200)`); a longer title would make the start fail.
 */
const EXECUTION_RUN_DISPLAY_TITLE_MAX_CHARS = 200;

/**
 * A Run's intent in the person's words: the first line of what they asked, so the Run is titled
 * "Is 5 attempts enough during a deploy?" rather than "Run 7f3a…". Null when nothing was written
 * (an attachment-only first message), so the Run keeps its generic title.
 */
export function resolveExecutionRunIntentTitle(prompt: string | null | undefined): string | null {
    const firstLine = (prompt ?? '')
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .find((line) => line.length > 0);
    if (!firstLine) return null;
    if (firstLine.length <= EXECUTION_RUN_DISPLAY_TITLE_MAX_CHARS) return firstLine;
    return `${firstLine.slice(0, EXECUTION_RUN_DISPLAY_TITLE_MAX_CHARS - 1).trimEnd()}…`;
}
