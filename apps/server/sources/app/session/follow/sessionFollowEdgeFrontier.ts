import {
    normalizeSessionFollowFrontierV1,
    projectSessionFollowFrontierFromSourceV1,
    type SessionFollowFrontierV1,
} from "@happier-dev/protocol";

/**
 * Persistence adapter between the `SessionFollowEdge` columns and Protocol's
 * one logical `SessionFollowFrontierV1`.
 *
 * The comparison, seeding and progress rules live in Protocol so the Session
 * edge and the Account Voice frontier stay one decision-maker; this module only
 * translates column shapes.
 */

/** The delivered columns this Home persists; nothing else describes progress. */
export type SessionFollowDeliveredColumns = Readonly<{
    deliveredTranscriptSeq: number;
    deliveredReadyEventSeq: number;
    deliveredAgentStateVersion: number;
    deliveredTurnId: string | null;
    deliveredTurnStatus: string | null;
}>;

/** The canonical source Session facts the frontier is projected from. */
export type SessionFollowSourceFrontierRow = Readonly<{
    seq: number;
    latestReadyEventSeq: number | null;
    agentStateVersion: number;
    latestTurnId: string | null;
    latestTurnStatus: string | null;
}>;

export function readStoredSessionFollowFrontier(row: SessionFollowDeliveredColumns): SessionFollowFrontierV1 {
    return normalizeSessionFollowFrontierV1({
        transcriptSeq: row.deliveredTranscriptSeq,
        readyEventSeq: row.deliveredReadyEventSeq,
        agentStateVersion: row.deliveredAgentStateVersion,
        turn: { id: row.deliveredTurnId, status: row.deliveredTurnStatus },
    });
}

export function readCurrentSourceSessionFollowFrontier(row: SessionFollowSourceFrontierRow): SessionFollowFrontierV1 {
    return projectSessionFollowFrontierFromSourceV1(row);
}

/**
 * Writes a frontier back as columns. Turn identity and status are always
 * written together, so a partial terminal-turn state can never be persisted.
 */
export function writeSessionFollowFrontierColumns(frontier: SessionFollowFrontierV1): {
    deliveredTranscriptSeq: number;
    deliveredReadyEventSeq: number;
    deliveredAgentStateVersion: number;
    deliveredTurnId: string | null;
    deliveredTurnStatus: "completed" | "failed" | "cancelled" | null;
} {
    return {
        deliveredTranscriptSeq: frontier.transcriptSeq,
        deliveredReadyEventSeq: frontier.readyEventSeq,
        deliveredAgentStateVersion: frontier.agentStateVersion,
        deliveredTurnId: frontier.turn?.id ?? null,
        deliveredTurnStatus: frontier.turn?.status ?? null,
    };
}
