-- CreateTable
CREATE TABLE "SessionFollowEdge" (
    "sourceSessionId" TEXT NOT NULL,
    "destinationSessionId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'next_turn',
    "deliveredTranscriptSeq" INTEGER NOT NULL DEFAULT 0,
    "deliveredReadyEventSeq" INTEGER NOT NULL DEFAULT 0,
    "deliveredAgentStateVersion" INTEGER NOT NULL DEFAULT 0,
    "deliveredTurnId" TEXT,
    "deliveredTurnStatus" TEXT,

    PRIMARY KEY ("destinationSessionId", "sourceSessionId"),
    CONSTRAINT "SessionFollowEdge_deliveredTurn_pair_check" CHECK (
        ("deliveredTurnId" IS NULL AND "deliveredTurnStatus" IS NULL)
        OR ("deliveredTurnId" IS NOT NULL AND "deliveredTurnStatus" IS NOT NULL)
    ),
    CONSTRAINT "SessionFollowEdge_deliveredTurn_status_check" CHECK (
        "deliveredTurnStatus" IS NULL
        OR "deliveredTurnStatus" IN ('completed', 'failed', 'cancelled')
    ),
    CONSTRAINT "SessionFollowEdge_distinct_sessions_check" CHECK (
        "sourceSessionId" <> "destinationSessionId"
    ),
    CONSTRAINT "SessionFollowEdge_mode_check" CHECK (
        "mode" IN ('next_turn', 'wake_on_human_change')
    ),
    CONSTRAINT "SessionFollowEdge_frontier_nonnegative_check" CHECK (
        "deliveredTranscriptSeq" >= 0
        AND "deliveredReadyEventSeq" >= 0
        AND "deliveredAgentStateVersion" >= 0
    ),
    CONSTRAINT "SessionFollowEdge_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionFollowEdge_destinationSessionId_fkey" FOREIGN KEY ("destinationSessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SessionFollowEdge_sourceSessionId_idx" ON "SessionFollowEdge"("sourceSessionId");
