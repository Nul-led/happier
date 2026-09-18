/**
 * Copy for the shared Session Agent-activity summary.
 *
 * One module, spread into every locale, because these strings are read from ONE presentation
 * resolver: the roster row, the Details overview and a conversation's run reference must say the
 * same words about the same entry, and duplicating them per locale file is how two surfaces end up
 * calling the same state two different things.
 *
 * Status labels exist at all because surfaces previously rendered the raw
 * `AgentActivityStatusV1`/provider status token (`running`, `timedOut`) straight onto the screen.
 */
export const sessionAgentActivityTranslations = {
    sessionAgentActivity: {
        status: {
            queued: 'Queued',
            starting: 'Starting',
            running: 'Running',
            waiting: 'Waiting',
            blocked: 'Blocked',
            succeeded: 'Done',
            failed: 'Failed',
            timedOut: 'Timed out',
            cancelled: 'Stopped',
            unknown: 'Unknown',
        },
        attention: {
            /** A tool wants to run and someone has to approve it. */
            permission: 'Needs approval',
            /** The agent asked a question and is waiting on an answer. */
            userAction: 'Needs your answer',
            /**
             * Both at once. The badge stays one short phrase so a dense row does not grow a second
             * line; `bothDescription` is what a screen reader hears, and it names both facts.
             */
            both: 'Needs attention',
            bothDescription: 'Needs approval and needs your answer',
        },
        /** `<title>, <status>` — the spoken form of a row whose status is a badge beside the title. */
        summaryA11y: ({ title, status }: { title: string; status: string }) => `${title}, ${status}`,
        summaryAttentionA11y: ({ title, status, attention }: { title: string; status: string; attention: string }) =>
            `${title}, ${status}, ${attention}`,
    },
} as const;
