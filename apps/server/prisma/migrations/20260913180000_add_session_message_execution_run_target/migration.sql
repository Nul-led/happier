-- Server-private immutable recipient binding copied from Pending custody.
ALTER TABLE "SessionMessage" ADD COLUMN "targetExecutionRunId" TEXT;
