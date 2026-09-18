-- CreateTable
CREATE TABLE "SessionDiscussion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "creationLocalId" TEXT NOT NULL,
    "creationEqualityEvidenceV1" JSONB NOT NULL,
    "createdByAccountId" TEXT,
    "titleContent" JSONB NOT NULL,
    "messageSeq" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionDiscussion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionDiscussionMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "discussionId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "requestEqualityEvidenceV1" JSONB NOT NULL,
    "seq" INTEGER NOT NULL,
    "authorAccountId" TEXT,
    "producerV1" JSONB,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionDiscussionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionDiscussionMessageMention" (
    "messageId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionDiscussionMessageMention_pkey" PRIMARY KEY ("messageId","accountId")
);

-- CreateTable
CREATE TABLE "SessionDiscussionReadState" (
    "discussionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lastReadSeq" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionDiscussionReadState_pkey" PRIMARY KEY ("discussionId","accountId")
);

-- CreateIndex
CREATE INDEX "SessionDiscussion_sessionId_archivedAt_lastMessageAt_id_idx" ON "SessionDiscussion"("sessionId", "archivedAt", "lastMessageAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SessionDiscussion_id_sessionId_key" ON "SessionDiscussion"("id", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDiscussion_sessionId_creationLocalId_key" ON "SessionDiscussion"("sessionId", "creationLocalId");

-- CreateIndex
CREATE INDEX "SessionDiscussionMessage_discussionId_seq_idx" ON "SessionDiscussionMessage"("discussionId", "seq" DESC);

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

-- AddForeignKey
ALTER TABLE "SessionDiscussion" ADD CONSTRAINT "SessionDiscussion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscussion" ADD CONSTRAINT "SessionDiscussion_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscussionMessage" ADD CONSTRAINT "SessionDiscussionMessage_discussionId_sessionId_fkey" FOREIGN KEY ("discussionId", "sessionId") REFERENCES "SessionDiscussion"("id", "sessionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscussionMessage" ADD CONSTRAINT "SessionDiscussionMessage_authorAccountId_fkey" FOREIGN KEY ("authorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscussionMessageMention" ADD CONSTRAINT "SessionDiscussionMessageMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SessionDiscussionMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscussionMessageMention" ADD CONSTRAINT "SessionDiscussionMessageMention_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscussionReadState" ADD CONSTRAINT "SessionDiscussionReadState_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "SessionDiscussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscussionReadState" ADD CONSTRAINT "SessionDiscussionReadState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

