CREATE TABLE "SessionReportsTo" (
    "sessionId" TEXT NOT NULL,
    "leadSessionId" TEXT NOT NULL,
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredTranscriptSeq" INTEGER NOT NULL DEFAULT 0,
    "deliveredReadyEventSeq" INTEGER NOT NULL DEFAULT 0,
    "deliveredAgentStateVersion" INTEGER NOT NULL DEFAULT 0,
    "deliveredTurnId" TEXT,
    "deliveredTurnStatus" "SessionFollowDeliveredTurnStatus",
    CONSTRAINT "SessionReportsTo_pkey" PRIMARY KEY ("sessionId"),
    CONSTRAINT "SessionReportsTo_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionReportsTo_leadSessionId_fkey" FOREIGN KEY ("leadSessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SessionReportsTo_leadSessionId_idx" ON "SessionReportsTo"("leadSessionId");
