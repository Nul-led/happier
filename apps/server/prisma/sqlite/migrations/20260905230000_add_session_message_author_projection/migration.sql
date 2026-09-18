-- Derived query projection of the immutable `SessionMessage.inputAdmissionReceipt`
-- actor. Additive and nullable: existing readers and writers keep working, and
-- rows without a valid authenticated-Account receipt stay NULL rather than
-- acquiring a guessed author.
--
-- SQLite cannot add a table-level FOREIGN KEY through ALTER TABLE, so the
-- reference is declared inline on the added column. This is the same additive
-- shape the other providers get and avoids an unnecessary table rebuild.
ALTER TABLE "SessionMessage" ADD COLUMN "authorAccountId" TEXT REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SessionMessage_authorAccountId_sessionId_idx" ON "SessionMessage"("authorAccountId", "sessionId");
