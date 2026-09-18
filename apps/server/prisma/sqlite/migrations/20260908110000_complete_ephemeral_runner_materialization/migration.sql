ALTER TABLE "Machine" ADD COLUMN "runnerContentKeyBinding" JSONB;
ALTER TABLE "EphemeralRunnerActivation" ADD COLUMN "credentialSelection" JSONB;
ALTER TABLE "EphemeralRunnerActivation" ADD COLUMN "review" JSONB;
ALTER TABLE "EphemeralRunnerActivation" ADD COLUMN "consent" JSONB;
ALTER TABLE "EphemeralRunnerActivation" ADD COLUMN "readiness" JSONB;
ALTER TABLE "EphemeralRunnerActivation" ADD COLUMN "sealedBootstrap" JSONB;
