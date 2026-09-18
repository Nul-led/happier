-- Account-owned interest. No historical subscriptions are backfilled.

ALTER TABLE "Account" ADD COLUMN "sessionAutoFollowAssigned" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Account" ADD COLUMN "sessionAutoFollowDirect" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Account" ADD COLUMN "sessionAutoFollowTeam" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Account" ADD COLUMN "sessionAutoFollowGroup" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AccountSessionFollow" (
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "following" BOOLEAN NOT NULL DEFAULT true,
    "notificationLevel" TEXT NOT NULL DEFAULT 'important',
    "includeInVoice" BOOLEAN NOT NULL DEFAULT false,
    "voiceDeliveredFrontier" TEXT,
    PRIMARY KEY ("accountId", "sessionId"),
    CONSTRAINT "AccountSessionFollow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountSessionFollow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AccountSessionFollow_sessionId_idx" ON "AccountSessionFollow"("sessionId");
