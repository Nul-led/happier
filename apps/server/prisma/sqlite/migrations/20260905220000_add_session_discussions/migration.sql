-- CreateTable
CREATE TABLE "SessionDiscussion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "creationLocalId" TEXT NOT NULL,
    "creationEqualityEvidenceV1" JSONB NOT NULL,
    "createdByAccountId" TEXT,
    "titleContent" JSONB NOT NULL,
    "messageSeq" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME NOT NULL,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionDiscussion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionDiscussion_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionDiscussionMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "discussionId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "requestEqualityEvidenceV1" JSONB NOT NULL,
    "seq" INTEGER NOT NULL,
    "authorAccountId" TEXT,
    "producerV1" JSONB,
    "content" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionDiscussionMessage_discussionId_sessionId_fkey" FOREIGN KEY ("discussionId", "sessionId") REFERENCES "SessionDiscussion" ("id", "sessionId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionDiscussionMessage_authorAccountId_fkey" FOREIGN KEY ("authorAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionDiscussionMessageMention" (
    "messageId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("messageId", "accountId"),
    CONSTRAINT "SessionDiscussionMessageMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SessionDiscussionMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionDiscussionMessageMention_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionDiscussionReadState" (
    "discussionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lastReadSeq" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("discussionId", "accountId"),
    CONSTRAINT "SessionDiscussionReadState_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "SessionDiscussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionDiscussionReadState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SessionDiscussion_sessionId_archivedAt_lastMessageAt_id_idx" ON "SessionDiscussion"("sessionId", "archivedAt", "lastMessageAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDiscussion_id_sessionId_key" ON "SessionDiscussion"("id", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDiscussion_sessionId_creationLocalId_key" ON "SessionDiscussion"("sessionId", "creationLocalId");

-- CreateIndex
CREATE INDEX "SessionDiscussionMessage_discussionId_seq_idx" ON "SessionDiscussionMessage"("discussionId", "seq");

-- CreateIndex
CREATE INDEX "SessionDiscussionMessage_authorAccountId_createdAt_idx" ON "SessionDiscussionMessage"("authorAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDiscussionMessage_discussionId_localId_key" ON "SessionDiscussionMessage"("discussionId", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDiscussionMessage_discussionId_seq_key" ON "SessionDiscussionMessage"("discussionId", "seq");

-- CreateIndex
CREATE INDEX "SessionDiscussionMessageMention_accountId_createdAt_idx" ON "SessionDiscussionMessageMention"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionDiscussionReadState_accountId_discussionId_idx" ON "SessionDiscussionReadState"("accountId", "discussionId");

