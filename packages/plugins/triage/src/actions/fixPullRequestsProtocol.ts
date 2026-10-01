import {
    defineProtocolArray,
    defineProtocolLiteral,
    defineProtocolNumber,
    defineProtocolObject,
    defineProtocolString,
    defineProtocolUnion,
} from '@happier-dev/plugin-sdk/protocol';
import {
    MAX_TRIAGE_LINKED_SESSIONS_PAGE_SIZE_V1,
    MAX_TRIAGE_TEXT_UTF8_BYTES_V1,
    TRIAGE_SINGLE_LINE_STRING_PATTERN_V1,
    TriageEntryRefV1Schema,
} from '@happier-dev/triage-protocol/v1';

/**
 * The strict contract of the two fix-PR Actions (`design/FIX-LINK.md`).
 *
 * They are the daemon transport for a mount without the Account Data client,
 * exactly like the two pin Actions, and are declared here rather than in
 * `@happier-dev/triage-protocol` for the same reason: the only caller family is
 * this plugin's own mounted detail, and a cross-plugin fix-link writer would be
 * a second authority over one `user-marks` row.
 */

const triageText = defineProtocolString({
    minLength: 1,
    maxLength: MAX_TRIAGE_TEXT_UTF8_BYTES_V1,
    pattern: TRIAGE_SINGLE_LINE_STRING_PATTERN_V1,
});

const TriageMarkDisplayV1Schema = defineProtocolObject({
    title: triageText,
    scopeLabel: triageText,
}, { policy: 'closed' });

const timestamp = defineProtocolNumber({ integer: true, minimum: 0 });
const PAGE = { maxItems: MAX_TRIAGE_LINKED_SESSIONS_PAGE_SIZE_V1 } as const;

export const TriageReadFixPullRequestsInputV1Schema = defineProtocolObject({
    v: defineProtocolLiteral(1),
    /** The issue or error group whose fix PRs are read. */
    entryRef: TriageEntryRefV1Schema,
}, { policy: 'closed' });
export type TriageReadFixPullRequestsInputV1 = ReturnType<typeof TriageReadFixPullRequestsInputV1Schema.parse>;

/**
 * The raw inputs of the resolution, not the resolution itself: which co-linked
 * entry is a pull request, and whether it is open, merged or closed, are facts
 * of the reader's admitted descriptors and projection, so the mounted caller
 * runs the one pure `resolveFixPullRequests` over this answer.
 */
export const TriageReadFixPullRequestsResultV1Schema = defineProtocolObject({
    v: defineProtocolLiteral(1),
    linked: defineProtocolArray(defineProtocolObject({
        entryRef: TriageEntryRefV1Schema,
        displayAtLink: TriageMarkDisplayV1Schema,
        linkedAtMs: timestamp,
    }, { policy: 'closed' }), PAGE),
    dismissed: defineProtocolArray(TriageEntryRefV1Schema, PAGE),
    coLinked: defineProtocolArray(defineProtocolObject({
        entryRef: TriageEntryRefV1Schema,
        displayPath: triageText,
        linkedAtMs: timestamp,
    }, { policy: 'closed' }), PAGE),
    incomplete: defineProtocolUnion([defineProtocolLiteral(true), defineProtocolLiteral(false)]),
}, { policy: 'closed' });
export type TriageReadFixPullRequestsResultV1 = ReturnType<typeof TriageReadFixPullRequestsResultV1Schema.parse>;

export const TriageSetFixPullRequestInputV1Schema = defineProtocolUnion([
    defineProtocolObject({
        v: defineProtocolLiteral(1),
        linked: defineProtocolLiteral(true),
        entryRef: TriageEntryRefV1Schema,
        displayAtMark: TriageMarkDisplayV1Schema,
        fixPullRequest: TriageEntryRefV1Schema,
        displayAtLink: TriageMarkDisplayV1Schema,
    }, { policy: 'closed' }),
    defineProtocolObject({
        v: defineProtocolLiteral(1),
        linked: defineProtocolLiteral(false),
        entryRef: TriageEntryRefV1Schema,
        displayAtMark: TriageMarkDisplayV1Schema,
        fixPullRequest: TriageEntryRefV1Schema,
    }, { policy: 'closed' }),
]);
export type TriageSetFixPullRequestInputV1 = ReturnType<typeof TriageSetFixPullRequestInputV1Schema.parse>;

export const TriageSetFixPullRequestResultV1Schema = defineProtocolObject({
    v: defineProtocolLiteral(1),
    status: defineProtocolUnion([
        defineProtocolLiteral('linked'),
        defineProtocolLiteral('unlinked'),
        defineProtocolLiteral('conflict'),
        defineProtocolLiteral('full'),
    ]),
}, { policy: 'closed' });
export type TriageSetFixPullRequestResultV1 = ReturnType<typeof TriageSetFixPullRequestResultV1Schema.parse>;

export const TRIAGE_READ_FIX_PULL_REQUESTS_ACTION_LOCAL_ID_V1 = 'marks/read-fix-pull-requests-v1';
export const TRIAGE_SET_FIX_PULL_REQUEST_ACTION_LOCAL_ID_V1 = 'marks/set-fix-pull-request-v1';
