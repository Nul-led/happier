-- CreateEnum
CREATE TYPE "SessionFollowDeliveredTurnStatus" AS ENUM ('completed', 'failed', 'cancelled');
CREATE TYPE "SessionFollowMode" AS ENUM ('next_turn', 'wake_on_human_change');

-- CreateTable
CREATE TABLE "SessionFollowEdge" (
    "sourceSessionId" TEXT NOT NULL,
    "destinationSessionId" TEXT NOT NULL,
    "mode" "SessionFollowMode" NOT NULL DEFAULT 'next_turn',
    "deliveredTranscriptSeq" INTEGER NOT NULL DEFAULT 0,
    "deliveredReadyEventSeq" INTEGER NOT NULL DEFAULT 0,
    "deliveredAgentStateVersion" INTEGER NOT NULL DEFAULT 0,
    "deliveredTurnId" TEXT,
    "deliveredTurnStatus" "SessionFollowDeliveredTurnStatus",

    CONSTRAINT "SessionFollowEdge_pkey" PRIMARY KEY ("destinationSessionId","sourceSessionId"),
    CONSTRAINT "SessionFollowEdge_deliveredTurn_pair_check" CHECK (
        ("deliveredTurnId" IS NULL AND "deliveredTurnStatus" IS NULL)
        OR ("deliveredTurnId" IS NOT NULL AND "deliveredTurnStatus" IS NOT NULL)
    ),
    CONSTRAINT "SessionFollowEdge_distinct_sessions_check" CHECK (
        "sourceSessionId" <> "destinationSessionId"
    ),
    CONSTRAINT "SessionFollowEdge_frontier_nonnegative_check" CHECK (
        "deliveredTranscriptSeq" >= 0
        AND "deliveredReadyEventSeq" >= 0
        AND "deliveredAgentStateVersion" >= 0
    )
);

-- CreateIndex
CREATE INDEX "SessionFollowEdge_sourceSessionId_idx" ON "SessionFollowEdge"("sourceSessionId");

-- AddForeignKey
ALTER TABLE "SessionFollowEdge" ADD CONSTRAINT "SessionFollowEdge_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionFollowEdge" ADD CONSTRAINT "SessionFollowEdge_destinationSessionId_fkey" FOREIGN KEY ("destinationSessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
