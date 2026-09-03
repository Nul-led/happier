import {
    StructuredQuestionAnswersV1Schema,
    getActionSpec,
    resolveEffectiveActionInputFields,
    type ActionId,
} from '@happier-dev/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export type ApprovalStructuredAnswer = Readonly<{
    question: string;
    values: readonly string[];
}>;

/**
 * Why a structured payload cannot be shown exactly as it was sent. Each reason is
 * a presentation fact, not a diagnostic code: the payload itself never reaches the
 * screen, so nothing here can leak its content.
 */
export type ApprovalUnrepresentableReason =
    | 'malformed_entry'
    | 'duplicate_question'
    | 'exceeds_protocol_bounds';

export type ApprovalStructuredAnswersProjection =
    | Readonly<{ kind: 'valid'; answers: readonly ApprovalStructuredAnswer[] }>
    | Readonly<{ kind: 'unrepresentable'; reason: ApprovalUnrepresentableReason }>;

export type ApprovalActionFieldRow =
    | Readonly<{ kind: 'value'; path: string; title: string; value: string }>
    | Readonly<{ kind: 'structuredAnswers'; path: string; title: string; answers: readonly ApprovalStructuredAnswer[] }>
    | Readonly<{ kind: 'unrepresentable'; path: string; title: string; reason: ApprovalUnrepresentableReason }>;

export type ApprovalActionFieldsPresentation = Readonly<{
    rows: readonly ApprovalActionFieldRow[];
    /**
     * Set when a field could not be presented exactly. Approval is withheld while
     * it is set: consenting to content Happier could not show is not consent.
     */
    unrepresentable: Readonly<{ path: string; reason: ApprovalUnrepresentableReason }> | null;
}>;

/**
 * The one Action field whose JSON leaf has a semantic presentation. Every other
 * JSON object stays opaque, so an approval can never stringify an arbitrary
 * payload (and potentially expose secrets) merely because a field uses the JSON
 * widget.
 */
const STRUCTURED_ANSWER_FIELD_PATH_BY_ACTION_ID: Readonly<Record<string, string>> = {
    'session.user_action.answer': 'answers',
};

function visitSegments(value: unknown, segments: readonly string[], index: number, output: unknown[]): void {
    if (index >= segments.length) {
        output.push(value);
        return;
    }

    const segment = segments[index];
    if (!segment) return;

    if (segment === '[]') {
        if (!Array.isArray(value)) return;
        for (const entry of value) {
            visitSegments(entry, segments, index + 1, output);
        }
        return;
    }

    if (!isRecord(value)) return;
    visitSegments(value[segment], segments, index + 1, output);
}

export function getApprovalFieldValues(input: unknown, path: string): readonly unknown[] {
    if (path === 'answers.[].values' && isRecord(input) && Array.isArray(input.answers)) {
        // Approval artifacts written by the supported 0.2.2 preview used a scalar
        // `answer`. Present that released shape through the current `values` field
        // until the matching protocol compatibility window closes.
        return input.answers.flatMap((entry) => {
            if (!isRecord(entry)) return [];
            if (Array.isArray(entry.values)) return entry.values;
            return typeof entry.answer === 'string' ? [entry.answer] : [];
        });
    }

    const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) return [];

    const output: unknown[] = [];
    visitSegments(input, segments, 0, output);
    return output;
}

export function shouldHideApprovalField(path: string, allPaths: readonly string[]): boolean {
    if (!path) return true;
    if (path.endsWith('.[]')) return true;

    return allPaths.some((candidate) => candidate !== path && (candidate.startsWith(`${path}.`) || candidate.startsWith(`${path}.[`)));
}

export function formatApprovalFieldValues(values: readonly unknown[]): string | null {
    const flattened = values.flatMap((value) => (Array.isArray(value) ? value : [value]));
    const formatted = flattened
        .map((value) => {
            if (typeof value === 'string') return value.trim();
            if (typeof value === 'number' || typeof value === 'boolean') return String(value);
            return '';
        })
        .filter((value) => value.length > 0);

    if (formatted.length === 0) return null;
    return formatted.join(', ');
}

/**
 * Projects the one public `answers` JSON leaf into bounded, human-readable
 * question/answer pairs, or says explicitly that it cannot.
 *
 * There is no fourth outcome. A payload that is malformed, duplicated, or above
 * the canonical protocol bound is `unrepresentable` as a whole rather than
 * partially rendered: dropping the entries that failed would show a reader a
 * shorter question set than the one they are about to approve.
 */
export function projectApprovalStructuredAnswers(values: readonly unknown[]): ApprovalStructuredAnswersProjection {
    const entries = values.flatMap((value) => {
        // A field the arguments never carried is absent, not malformed; the Action
        // spec's own admission owns requiredness.
        if (value === undefined || value === null) return [];
        return Array.isArray(value) ? value : [value];
    });
    const candidate = Object.create(null) as Record<string, readonly string[]>;

    for (const entry of entries) {
        if (!isRecord(entry) || typeof entry.question !== 'string') {
            return { kind: 'unrepresentable', reason: 'malformed_entry' };
        }
        const question = entry.question;
        if (Object.hasOwn(candidate, question)) {
            return { kind: 'unrepresentable', reason: 'duplicate_question' };
        }

        const rawValues = Array.isArray(entry.values)
            ? entry.values
            : (entry.answer === undefined ? [] : [entry.answer]);
        if (rawValues.length === 0 || rawValues.some((value) => typeof value !== 'string')) {
            return { kind: 'unrepresentable', reason: 'malformed_entry' };
        }
        candidate[question] = rawValues as readonly string[];
    }

    const parsed = StructuredQuestionAnswersV1Schema.safeParse(candidate);
    if (!parsed.success) return { kind: 'unrepresentable', reason: 'exceeds_protocol_bounds' };
    return {
        kind: 'valid',
        answers: Object.entries(parsed.data).map(([question, answerValues]) => ({
            question,
            values: answerValues,
        })),
    };
}

/**
 * The canonical projection of an Action approval's arguments into what the detail
 * surface may show and whether the decision may be taken.
 *
 * The card renders this and the screen decides from this, so a field the reader
 * cannot see and the approve action the reader can press are never derived from
 * two different readings of the same payload.
 */
export function describeApprovalActionFields(input: Readonly<{
    actionId: string;
    actionArgs: unknown;
}>): ApprovalActionFieldsPresentation {
    let spec;
    try {
        spec = getActionSpec(input.actionId as ActionId);
    } catch {
        return { rows: [], unrepresentable: null };
    }

    const resolved = resolveEffectiveActionInputFields(spec, input.actionArgs);
    const paths = resolved.map((field) => field.path);
    const structuredAnswerPath = STRUCTURED_ANSWER_FIELD_PATH_BY_ACTION_ID[input.actionId];

    const rows: ApprovalActionFieldRow[] = [];
    let unrepresentable: ApprovalActionFieldsPresentation['unrepresentable'] = null;

    for (const field of resolved) {
        if (shouldHideApprovalField(field.path, paths)) continue;
        const fieldValues = getApprovalFieldValues(input.actionArgs, field.path);

        if (structuredAnswerPath !== undefined && field.path === structuredAnswerPath) {
            const projection = projectApprovalStructuredAnswers(fieldValues);
            if (projection.kind === 'unrepresentable') {
                unrepresentable ??= { path: field.path, reason: projection.reason };
                rows.push({ kind: 'unrepresentable', path: field.path, title: field.title, reason: projection.reason });
                continue;
            }
            if (projection.answers.length > 0) {
                rows.push({ kind: 'structuredAnswers', path: field.path, title: field.title, answers: projection.answers });
            }
            continue;
        }

        const value = formatApprovalFieldValues(fieldValues);
        if (value === null) continue;
        rows.push({ kind: 'value', path: field.path, title: field.title, value });
    }

    return { rows, unrepresentable };
}
