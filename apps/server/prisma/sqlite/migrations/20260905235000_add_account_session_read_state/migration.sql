-- CreateTable
CREATE TABLE "AccountSessionReadState" (
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "lastViewedSessionSeq" INTEGER NOT NULL,
    "unreadSince" DATETIME,

    PRIMARY KEY ("accountId", "sessionId"),
    CONSTRAINT "AccountSessionReadState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountSessionReadState_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AccountSessionReadState_sessionId_idx" ON "AccountSessionReadState"("sessionId");

-- Backfill the Session owner only. The shared cursor cannot prove which non-owner
-- ever saw the Session, so direct recipients, Team members and Group members get
-- no row: absence means quiet, and fabricating recipient baselines would either
-- invent history or erase somebody's manual unread. A NULL legacy cursor becomes
-- 0, preserving the incumbent owner rule that "never viewed" is unread.
-- Keep this one-time transition aligned with sessionTranscriptPublicationPolicy.
-- Unknown historical entry time remains NULL; caught-up owners have no unread entry.
INSERT INTO "AccountSessionReadState" ("accountId", "sessionId", "lastViewedSessionSeq", "unreadSince")
SELECT "accountId", "id", MIN(MAX(COALESCE("lastViewedSessionSeq", 0), 0), "visibleSeq"),
    CASE WHEN MAX(COALESCE("lastViewedSessionSeq", 0), 0) < "visibleSeq" THEN "unreadSince" ELSE NULL END
FROM (
    SELECT "accountId", "id", "lastViewedSessionSeq", "unreadSince",
        MAX(0, MIN("seq", CASE
        WHEN "currentStorageState" = 'hosted' THEN "seq"
        WHEN "currentStorageState" = 'server_partial'
            THEN MAX(COALESCE("acceptedThroughServerSeq", 0), 0)
        WHEN "currentStorageState" = 'snapshot_complete'
            AND LENGTH(TRIM("materializationPublicationId")) > 0
            AND "materializedThroughSourceAt" BETWEEN 0 AND 9007199254740991
            AND "publishedThroughServerSeq" BETWEEN 0 AND "seq"
            THEN "publishedThroughServerSeq"
        ELSE 0
    END)) AS "visibleSeq"
    FROM "Session"
) AS "ownerReadBaseline";

-- Session owners are implicitly tracked. Establish every existing Discussion
-- at its current ceiling in the same migration so an upgrade cannot turn
-- historical Discussion activity into unread work. Non-owners are deliberately
-- absent: readable access alone is not tracking entry.
INSERT INTO "SessionDiscussionReadState" ("discussionId", "accountId", "lastReadSeq", "updatedAt")
SELECT "SessionDiscussion"."id", "Session"."accountId", "SessionDiscussion"."messageSeq", CURRENT_TIMESTAMP
FROM "SessionDiscussion"
INNER JOIN "Session" ON "Session"."id" = "SessionDiscussion"."sessionId";
