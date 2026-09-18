CREATE TYPE "MachineKind" AS ENUM ('persistent', 'ephemeral_session_runner');
ALTER TABLE "Machine" ADD COLUMN "kind" "MachineKind" NOT NULL DEFAULT 'persistent';
